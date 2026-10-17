import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** 本项目素材名的统一后缀（标明独立创作，且不与用户目录里的旧同名素材冲突）。
 *  也用来**区分"我们的名字"与"用户自加的名字"**，见 buildAnimPool。 */
const OUR_SUFFIX = '-dshwe';
/** 动作协议全表（与 wallpaper 的 src/pet-link-actions.json 一致）；素材可能还没生成。
 *  ⚠️ 这份表**不是**扩展池的内容：池里只放**真有素材**的名字，见 buildAnimPool。
 *  **导出**它是为了让判据读同一份（单一真源）—— 测试里另抄一份必然漂移（实测踩过）。
 *
 *  v5（2026-10-15 交付，9 段）：**整批素材换代** —— 旧的 18 段 `拉侧栏-*` 全部作废（见 RETIRED），
 *  命名体系也不再是 `拉侧栏-*` 一族，改成**按场景分族**：`通用-*`（走位）/ `侧边栏-*`（拉侧栏主线）/
 *  `吉祥物-*`（吉祥物交互）/ `彩蛋-*`（彩蛋）。顺序即权威顺序（走位 → 主线 → 吉祥物 → 彩蛋）。
 *
 *  ⚠️ **旁支两段不进本表**：`彩蛋-吉祥物-远程吸入planA-dshwe` / `planB-dshwe` 是素材方交付的
 *  备选方案（用户明确要求「暂不接入协议表」），文件放在 `assets/_alternates/`（见其 README）。
 *  它们**既不在 NAMES、也不在 RETIRED** —— 不进表、不进池、不参与校验计数。 */
export const NAMES = [
  '通用-右侧螃蟹步-dshwe',
  '通用-左侧螃蟹步-dshwe',
  '侧边栏-蓄力准备往后拉-dshwe',
  '侧边栏-后拉接疲态结束-dshwe',
  '吉祥物-跳抓眩晕落地起身-dshwe',
  '彩蛋-侧边栏-半身转向踢腿-dshwe',
  '彩蛋-侧边栏-被弹飞-dshwe',
  '彩蛋-侧边栏-落地-dshwe',
  '彩蛋-吉祥物-哈气-dshwe',
];
/**
 * **已退休**的动作名：一律不得出现在扩展池里，见到就删。
 *
 * v5 整批换代后，这里 = **旧的全部 18 段 `拉侧栏-*`** + **更早的 5 个历史名**。
 * 为什么整批退休：素材方把 18 段全部重做了，命名体系也从「`拉侧栏-*` 一族」换成按场景分族
 * （`通用-*` / `侧边栏-*` / `吉祥物-*` / `彩蛋-*`）—— 旧名不是"少了几段"，而是**一族都不存在了**，
 * 所以一条都不能漏，漏一条就在池里留一段永不点播的死动画。
 *
 * ⚠️ 为什么不能只靠「带不带我们的后缀」判归属（踩过两次，现在仍然成立）：
 *
 *   1. `拉侧栏-拉吉祥物-dshwe`——**带**后缀，但协议表里已删（死代码清理），旧判据把它
 *      当成"用户自加的名字"永久保留，池里留了一段永不点播的死动画。
 *   2. `拉侧栏-抓握` / `拉侧栏-拉拽` / `拉侧栏-松手`——**没有**后缀。它们是我方
 *      v1 注入时的名字，后来统一改名加 `-dshwe`（见 `_pet-link-backup-20261013-implementation/rename-dshwe.mjs`），
 *      但改名脚本的文件清单没覆盖当时已存在的扩展池 ⇒ 旧名被当成"用户自加"留了下来。
 *      实测后果：右键菜单的 `DSHWE` 分类里多出这三个旧名（用户报的"还有三个不是
 *      dshwe 的动作"），且 `lib/client.js` 的点播也还指着旧名 ⇒ **动作静默不动**。
 *
 * 本次换代正好把两类的坑各又踩了一遍：带后缀的旧名（`拉侧栏-抓握-dshwe` 等 15 个）和
 * 不带后缀的历史名（`拉侧栏-抓握` 等 3 个）**同时**存在于旧池里，所以两条都要显式列出。
 *
 * 所以判据要显式：**退休名单是权威**，无论带不带后缀、无论在不在协议表里，见到即从池里移除。 */
export const RETIRED = [
  // ── 旧的全部 18 段（v4 协议表，带 `-dshwe` 后缀）—— 整批换代，全部作废
  '拉侧栏-走-dshwe',
  '拉侧栏-走-向右-dshwe',
  '拉侧栏-转身-正转右-dshwe',
  '拉侧栏-转身-右转正-dshwe',
  '拉侧栏-落地转正-dshwe',
  '拉侧栏-抓握-dshwe',
  '拉侧栏-拉拽-dshwe',
  '拉侧栏-松手-dshwe',
  '拉侧栏-摔坐-dshwe',
  '拉侧栏-眩晕-侧-dshwe',
  '拉侧栏-眩晕-吉祥物-dshwe',
  '拉侧栏-眩晕-弹飞-dshwe',
  '拉侧栏-叉腰喘气-dshwe',
  '拉侧栏-踢-dshwe',
  '拉侧栏-被弹飞-dshwe',
  '拉侧栏-捂头走回-dshwe',
  '拉侧栏-跳抓-dshwe',
  '拉侧栏-下拉-dshwe',
  // ── 更早的 5 个历史名
  // 其中三个**不带**后缀：它们是我方 v1 的名字，改名脚本漏掉了已存在的扩展池（见上「坑 2」）。
  // ⚠️ `拉侧栏-抓握` 与 `拉侧栏-抓握-dshwe` 必须**同时**在名单里，两条都不能删。
  '拉侧栏-抓握',
  '拉侧栏-拉拽',
  '拉侧栏-松手',
  // 这两个带后缀：`拉吉祥物` 是死代码清理删掉的；`眩晕` 是 v4 拆成三段后作废的。
  '拉侧栏-拉吉祥物-dshwe',
  '拉侧栏-眩晕-dshwe',
];
/** 联动气泡的表情包（文件名 = main-config 里 memes 池的键）。
 *  描述写给模型看（碎碎念/对话选图用），与 wallpaper 的三条气泡一一对应。
 *
 *  ⚠️ 这份表是**手写的权威名单**，不是 `assets/memes/` 的目录扫描 —— 因为每个名字都
 *  **必须配一句给模型看的描述**，扫描目录产不出描述。目录里多出来的 png（用户自己丢进去的）
 *  不归本工具管，也不该被注入。
 *  **导出**它是为了让判据读同一份（单一真源）—— 与 NAMES / RETIRED 同理。
 *  （实测：曾有判据用"目录里的 png 数"预测注入文件数，目录多一张 png 就假警报。） */
export const MEMES = {
  '累瘫鲸鱼的两碗饭': '累瘫在地、端着两碗白饭求投喂，适合喊累、要饭、干完苦活',
  '蓝发鲸尾女仆拒绝换壁纸': '双手合十卖萌说「可以换壁纸了」，旁边打了××√，适合推荐换壁纸',
  '暴怒鲸尾女仆贴纸': '气得冒火、满脸十字青筋，适合发怒、被惹毛、暴走',
  '吓哭了': '受惊吓哭、眼泪汪汪，适合被弹飞、惊慌和委屈',
  // 彩蛋二专用（2026-10-15）：逻辑二第 3 次触发时那句「？！欺负一只肥鱼！？」的配图。
  // 这张 png 一度只在目录里而没进本名单（全工作区零引用），于是彩蛋二没有配图可用；
  // 排播定稿后它有了明确归属，补登记。
  '？！欺负一只肥鱼！？': '抱着尾巴委屈抗议「欺负一只肥鱼」，适合被欺负、撒娇式抗议、卖惨',
};

/** 剥 JSONC 注释得到纯 JSON 文本（与 dsh-pet 的 stripJsonc 同口径：行注释 + 块注释）。
 *  只用于**读**既有配置做合并；写回时统一产出无注释的规范 JSON（宿主自己也这么写）。 */
function stripJsonc(src) {
  let out = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (quoted) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) out += src[++i];
      else if (ch === '"') quoted = false;
    } else if (ch === '"') { quoted = true; out += ch; }
    else if (ch === '/' && next === '/') {
      out += ' ';
      while (i + 1 < src.length && src[i + 1] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      out += ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      if (i >= src.length) throw new Error('JSONC 块注释未闭合');
      i++;
    } else out += ch;
  }
  return out.replace(/^\uFEFF/, '');
}

/** 把表情包登记进 main-config.jsonc 的 memes 池（**保留既有字段**）。
 *  为什么必须保留：`memes` 不在宿主的 GLOBAL_DEFAULT_KEYS 白名单里，设置页保存时会
 *  把非白名单字段从磁盘原对象透传保留 —— 我们同样不能把用户手写的人设/其它表情包抹掉。
 *
 *  幂等：**只在需要新登记时才产出写入项**。已登记齐了就不碰配置 —— 否则第二次运行时
 *  我们会拿"重新序列化过的全文"去和用户原文件比，必然不等，于是把幂等误判成冲突。
 *  @returns 新登记的键（已存在且描述非空的不重复登记） */
function mergeMemesConfig(mainPath, files) {
  let existing = {};
  if (existsSync(mainPath)) {
    const raw = readFileSync(mainPath, 'utf8');
    try {
      const parsed = JSON.parse(stripJsonc(raw));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置根必须是对象');
      existing = parsed;
    } catch (e) {
      throw new Error('main-config.jsonc 不是可解析的 JSONC，请先手工修好再注入：' + mainPath);
    }
  }
  const memes = existing.memes && typeof existing.memes === 'object' && !Array.isArray(existing.memes)
    ? { ...existing.memes } : {};
  const added = [];
  for (const [name, desc] of Object.entries(MEMES)) {
    if (typeof memes[name] === 'string' && memes[name].trim()) continue; // 已有描述：尊重用户，不覆盖
    memes[name] = desc;
    added.push(name);
  }
  if (!added.length) return added; // 已就绪 ⇒ 不产写入项（幂等的关键）
  const next = { ...existing, memes };
  const text = JSON.stringify(next, null, 2) + '\n';
  files.push({ path: mainPath, data: Buffer.from(text), kind: 'config' });
  return added;
}

/** 算出该写进扩展文件的动画池。
 *
 *  ⚠️ 池里**只能放真有素材的名字** —— 这是踩出来的坑：
 *  dsh-pet 的 `decideAnim` 只校验「名字在配置池里」，**不校验 `.webm` 是否存在**；
 *  而 wallpaper 浏览器半的降级判据是「名字**不在**池里」（见 src/pet-link.js 的 PET_FALLBACK）。
 *  两者一交错，若把没素材的名字也登记进池：点播被判"合法"、精灵却载不到文件 ⇒ **静默不动**，
 *  而降级永远不会触发。所以登记表 = `协议全表 ∩ 有素材` ∪ `既有池内容`（不抹用户加的名字）。
 *
 *  ⚠️ **退休的名字要清掉**（踩过两次，见 `RETIRED` 的说明）：既有池里的名字分两种——
 *   · **退休名单里的**（无论带不带 `-dshwe` 后缀、无论在不在协议表里）：**必须移除**。
 *     v5 换代后名单很长（旧 18 段 + 5 个历史名），正是因为它不再是"漏了几段"，
 *     而是**整个旧命名族都没了**；早先只按"带不带后缀"判归属，于是「带后缀但已退休」
 *     （拉吉祥物）和「不带后缀的旧版我方名字」（抓握/拉拽/松手）都被误当成"用户加的"
 *     永久保留，池里于是留着永不点播的死名字，右键菜单也能看到。
 *   · **用户自己加的**（不在退休名单、也不在我们的协议表里）：保留，不该替用户删。
 *
 *  @param extPath 扩展文件路径（不存在则视为空池）
 *  @returns 按协议表权威顺序排列的名字数组（用户自加的名字并到后面） */
function buildAnimPool(parsed, assetsRoot) {
  const hasAsset = (name) => existsSync(join(assetsRoot, 'webm', name + '.webm'));
  const kept = [];
  const pool = parsed?.animations?.events?.DSHWE;
  if (Array.isArray(pool)) {
    for (const n of pool.flat()) {
      if (typeof n !== 'string' || !n || RETIRED.includes(n)) continue;
      if (n.endsWith(OUR_SUFFIX)) {
        if (NAMES.includes(n) && hasAsset(n)) kept.push(n);
      } else kept.push(n);
    }
  }
  const out = [];
  const push = (n) => { if (!out.includes(n)) out.push(n); };
  // 有素材的按协议表顺序（顺序即权威顺序）
  for (const n of NAMES) if (hasAsset(n)) push(n);
  // 再并既有内容（用户自加的排后面）
  for (const n of kept) push(n);
  return out;
}

/** 先核对全部目标；任何冲突都在落盘前失败。绝不覆盖已有同名文件。
 *  素材按"本地存在才拷"处理：新动作的素材还没生成时先跳过，素材到位后重跑本工具即可补上。 */
export function planAssets({ dshHome, assetsRoot = join(ROOT, 'assets'), requireComplete = true } = {}) {
  const home = resolve(dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'));
  const user = join(home, 'dsh-pet');
  // ⚠️ **文件名保持 `leash-bridge-ext.json` 不改**，尽管里面的分类键已改名为 `DSHWE`。
  //    原因：dsh-pet 会把 `animation-ext/` 下所有 `*-ext.json` **全部加载**，按文件里的
  //    `target` + 池键合并。若把文件名也改掉，旧文件不会被覆盖 ⇒ 磁盘上同时存在两个扩展，
  //    一个带旧键 `leashBridge`、一个带新键 `DSHWE` ⇒ 右键菜单里会冒出**两个**分类。
  //    文件名是纯实现细节（菜单标签来自**键**），不值得为整洁冒"重复分类"的风险。
  const extPath = join(user, 'animation-ext', 'leash-bridge-ext.json');
  let existingExt = {};
  if (existsSync(extPath)) {
    try { existingExt = JSON.parse(readFileSync(extPath, 'utf8')); }
    catch { throw new Error('动画扩展不是合法 JSON：' + extPath); }
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!object(existingExt) || (existingExt.target && existingExt.target !== 'main')
        || (existingExt.animations && !object(existingExt.animations))
        || (existingExt.animations?.events && !object(existingExt.animations.events)))
      throw new Error('动画扩展结构或目标不兼容，保留原文件：' + extPath);
  }
  const pool = buildAnimPool(existingExt, assetsRoot);
  const ext = { ...existingExt, target: 'main', animations: { ...existingExt.animations,
    events: { ...existingExt.animations?.events, DSHWE: pool } } };
  const files = [];
  const missing = [];
  for (const name of NAMES) {
    const src = join(assetsRoot, 'webm', name + '.webm');
    if (!existsSync(src)) { missing.push(name); continue; }
    files.push({ path: join(user, 'main-animation', 'webm', name + '.webm'), data: readFileSync(src) });
  }
  files.push({ path: extPath, data: Buffer.from(JSON.stringify(ext, null, 2) + '\n'), kind: 'ext' });
  // 表情包：png 落到用户表情包根（`$DSH_HOME/dsh-pet/memes/`）。
  // 为什么不用 `pet/<素材根>-memes/`：那条链存在时**只认它**，会让别的主宠物也看不到这几张图；
  // 用户根是目录链的第二段，对所有宠物都可见（见 dsh-pet 的 memeDirsFor）。
  const memesDir = join(user, 'memes');
  const memes = [];
  for (const name of Object.keys(MEMES)) {
    const src = join(assetsRoot, 'memes', name + '.png');
    if (!existsSync(src)) { missing.push(name + '.png'); continue; }
    files.push({ path: join(memesDir, name + '.png'), data: readFileSync(src) });
    memes.push(name);
  }
  // 配置合并要读既有文件，放在预检**之前**算好最终内容。
  // ⚠️ 配置文件**不走**下面的"同名冲突即中止"规则：它的自然状态就是"已存在且和我们的
  //    序列化结果不同"（用户手写过注释/别的字段）。它的语义是"确保 memes 池里有这三条描述"，
  //    幂等性由 mergeMemesConfig 保证（已齐 ⇒ 不产写入项）。
  const configPath = join(user, 'main-config.jsonc');
  const added = mergeMemesConfig(configPath, files);
  const pending = [];
  for (const file of files) {
    // 配置与扩展文件都按**语义**合并（幂等性由各自的 merge 函数保证：内容已齐 ⇒ 不产写入项
    // 或产出的内容与磁盘语义相同）。它们不走"同名冲突即中止"——那条规则是给**素材文件**
    // （webm/png）用的：素材是用户可能自己放过的二进制，字节不同就必须停下来问人。
    if (file.kind === 'config') { pending.push(file); continue; }
    if (file.kind === 'ext') { pending.push(file); continue; }
    if (!existsSync(file.path)) { pending.push(file); continue; }
    const existing = readFileSync(file.path);
    if (!existing.equals(file.data)) throw new Error('同名文件冲突，未写入任何文件：' + file.path);
  }
  if (requireComplete && missing.length) throw new Error('缺少完整安装所需素材：' + missing.join('、'));
  return { files, pending, missing, memes, memesAdded: added, pool };
}

export function injectAssets({ dshHome, assetsRoot, partial = false } = {}) {
  const { files, pending, missing, memes, memesAdded, pool } = planAssets({ dshHome, assetsRoot, requireComplete: !partial });
  const created = [];
  for (const file of pending) {
    mkdirSync(dirname(file.path), { recursive: true });
    // 覆盖类文件（配置 / 扩展）写前先备份用户原件：可回滚，且出事时能人工比对
    if ((file.kind === 'config' || file.kind === 'ext') && existsSync(file.path)) {
      if (readFileSync(file.path).equals(file.data)) continue; // 内容一致 ⇒ 不动它（保持 mtime 与幂等）
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(file.path + '.bak-' + stamp, readFileSync(file.path));
    }
    // 覆盖类（config/ext）用 'w'（可覆盖），素材用 'wx'（已存在即失败，防误覆盖）
    writeFileSync(file.path, file.data, { flag: (file.kind === 'config' || file.kind === 'ext') ? 'w' : 'wx' });
    created.push(file.path);
  }
  return { created, checked: files.map(file => file.path), missing, memes, memesAdded, pool };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--dsh-home');
  const result = injectAssets({ dshHome: index >= 0 ? args[index + 1] : undefined, partial: args.includes('--partial') });
  console.log(`素材与扩展已就绪：新建 ${result.created.length} 个文件；已有文件校验一致。`);
  if (result.memes.length) console.log(`表情包：${result.memes.join('、')}（本次新登记 ${result.memesAdded.length} 条描述）`);
  if (result.missing.length) console.log(`缺素材（跳过，补上后重跑）：${result.missing.join('、')}`);
}
