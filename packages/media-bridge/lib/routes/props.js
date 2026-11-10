/**
 * routes/props.js — **壁纸属性**族路由：`/props/<token>`。
 *
 * 它回答一个问题：这张壁纸声明了哪些用户属性（`project.json` 的
 * `general.properties`），当前生效值是多少（默认值 ⊎ 本机覆盖值），以及
 * `file` / `directory` 类属性可选的候选文件。
 *
 * 另带一份**只读**的 `we`（issue #341）：WE 安装根 `config.json` 里这张壁纸的用户
 * 当前值（`wproperties.<路径>.<MonitorN>.*`），供面板「从 WE 导入当前值」。它**不参与**
 * 上面的默认值/覆盖值合并 —— 导入是用户的显式动作，落进 `userProps` 后才生效。
 * 读不到（没装 WE / 没这张壁纸 / 坏 JSON）就给 `{ ok:false, reason }`，不影响本族其余部分。
 *
 * **写入不在这一族** —— 覆盖值随设置一起 `PUT /settings`（`userProps` 键，按 token 存标量），
 * 与其它设置共用同一套持久化与白名单校验；刷新 / 重启后依旧生效。把这层"读在这里、写在那里"
 * 的关系放在文件头，是因为它是本族最容易看漏的一半（改本族时别顺手加一条 PUT）。
 *
 * 契约：`registerPropsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`    ← 清理句柄数组（卸载 / HMR 时注销路由）
 *   · `base`         ← `/wallpaper-engine` 前缀
 *   · `mediaMap`     ← token → 磁盘绝对路径（**同一张 Map 实例**：apply 建、teardown
 *                      `clear()` ⇒ 传值即可，因为它是原地改写而非重新赋值）
 *   · `userPropsFor` ← 读 `config.json` 里这张壁纸的覆盖值（`{}` 为无覆盖）
 * 纯函数 `parseUserPropDefs` / `entryDirPrefix` / `filterKnownOverrides` 经调用点显式给的
 * `schema` 面拿（主包纯符号视图，见 `lib/subpackage-boot.js` 的 `SCHEMA_VIEW`）——
 * 本文件不再 import 主包；库函数自足的口径不变，只是来路从静态 import 改成注入面。
 *
 * 不变量：
 *   · 覆盖值只认 `project.json` 里**仍声明着**的属性名（作者删掉的属性，陈旧覆盖忽略）——
 *     这是 `filterKnownOverrides` 的职责，不能绕过。
 *   · 候选清单是**尽力而为**：`project.json` 缺失或目录读不到都退回空列表（面板回落文本输入），
 *     **绝不**因此让整条路由失败。
 *   · 未带 token / token 未知 ⇒ 400 / 404，不抛。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readWeConfigValues } from '../we-wproperties.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaMap', 'userPropsFor', 'parseUserPropDefs', 'entryDirPrefix', 'filterKnownOverrides', 'http'];

export function registerPropsRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, userPropsFor,
    parseUserPropDefs, entryDirPrefix, filterKnownOverrides, http,
  } = c;

  // 3c-3c. 壁纸属性（WE 用户属性，project.json `general.properties`）：给「壁纸
  //        属性」面板读当前生效值（默认值 ⊎ 用户覆盖）与候选文件。
  //        写入不在这里 —— 覆盖值随设置一起 PUT（/settings），与其它设置共用同一
  //        套持久化与白名单校验，刷新/重启后依旧生效。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/props`,
    handler: (req, res) => {
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js（默认带 no-store）。
      const json = (code, payload) => http.sendJson(res, code, payload);
      if ((req.method || 'GET').toUpperCase() !== 'GET') { json(405, { ok: false, error: 'method-not-allowed' }); return; }
      let token;
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/props/`.length)).replace(/\/+$/, '');
      } catch { json(400, { ok: false, error: 'bad-request' }); return; }
      const abs = token ? mediaMap.get(token) : null;
      if (!abs) { json(404, { ok: false, error: 'unknown-token' }); return; }
      const dir = dirname(abs);
      let pj = null;
      try { pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')); } catch { /* 无 project.json：仍回空列表 */ }
      // 覆盖值只认 project.json 里还声明着的属性名（作者删掉的属性，陈旧覆盖忽略）
      const overrides = filterKnownOverrides(pj, userPropsFor(token));
      // 候选文件 / 子目录：面板把 file / directory 渲染成下拉，比手打相对路径可靠
      const files = [];
      const dirs = [];
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          if (ent.name.startsWith('.')) continue;
          if (ent.isDirectory()) { if (dirs.length < 60) dirs.push(`${ent.name}/`); }
          else if (files.length < 400) files.push(ent.name);
        }
      } catch { /* 读不到就退回文本输入 */ }
      const props = parseUserPropDefs(pj, overrides, {
        filePrefix: entryDirPrefix(String((pj && pj.file) || '')),
        listFiles: files,
      }).map((d) => ((d.ptype === 'directory' && dirs.length) ? { ...d, files: dirs } : d));
      // issue #341：WE 安装根 config.json 里这张壁纸的用户当前值（只读导入用）。
      // 读不到只是这一项缺席：绝不因此让面板/路由失败。
      let we;
      try { we = readWeConfigValues(dir); } catch { we = { ok: false, reason: 'unexpected' }; }
      json(200, { ok: true, token, props, overrides, hasProject: Boolean(pj), we });
    },
  }));
}
