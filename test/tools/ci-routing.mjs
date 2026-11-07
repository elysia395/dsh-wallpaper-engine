#!/usr/bin/env node
/**
 * ci-routing.mjs — **CI 变更分类 + 文档快通道**的判据库（纯函数：不读盘、不写盘、无副作用）。
 *
 * ## 守的是什么实害
 * 以前 `.github/workflows/verify.yml` 对**每一次** push / PR 都跑同一套重活：装依赖、静态棘轮、
 * 构建、结构守卫、media-bridge 端到端、冒烟 —— 改一个 README 错别字也要在 Windows +
 * Ubuntu 两个平台上把整条链走一遍。真正的代价不是慢，而是**排队**：文档改动与代码改动争同一
 * 份 runner，文档作者等的是与自己无关的门。
 *
 * 于是要"只改文档 ⇒ 只跑文档检查"。这条捷径的**实害**在分类判据上：
 *   · 白名单写宽了（一句 `assets/**`）—— 把运行时素材或代码当成文档，门禁静默少跑；
 *   · 只看最后一笔提交（`git diff HEAD^`）—— 一个 PR 里前几笔改代码、最后一笔改 README，
 *     按最后一笔分类 ⇒ 代码改动不受任何运行时判据约束；
 *   · 删除 / 重命名被当成"修改"—— 删掉 `lib/index.js` 在差异里是 `D`，分类成文档 ⇒ 放行；
 *   · 分类失败时默认走文档 —— 判据一崩，门禁就变成"什么都不做"。
 * 本文件把"哪些改动算纯文档"变成机器事实，且每条判断都 **fail-closed**（不确定 ⇒ full）。
 *
 * ## 三条硬约束（与 `test/verify-ci-steps.mjs` 一致）
 *   ① 文档白名单**小且明确**，不用 `assets/**` 代表文档；
 *   ② `docs/TOKEN-CONTRACT.md`、`docs/ROUTE-INDEX.md` 这类**机器派生契约不豁免**（改了它们
 *      等于改了判据本身，判据自己给自己免检就是假牙）；
 *   ③ 删除 / 重命名 / 未知状态 / 差异过大 / 取不到差异，一律 **full** 或**阻断**。
 *
 * ## 为什么分类与文档检查共用一个库
 * 两件事共用同一份"变更条目"与同一份白名单：分开写就会长出两套白名单，改一处漏一处。
 * CLI 在 `scripts/ci-routing.mjs`（薄：`check` 分类 / `docs` 文档检查），判据全在这里。
 */

/** 三种验证路径（CI 的 `ci/result` 只认这三个值）。 */
export const MODE_DOCS = 'docs';
export const MODE_DOCS_ASSETS = 'docs-assets';
export const MODE_NOTICE = 'notice';
export const MODE_FULL = 'full';
export const MODES = [MODE_DOCS, MODE_DOCS_ASSETS, MODE_NOTICE, MODE_FULL];

/** 公告区块的起止标记（逐字出现在 `src/client.js` 与 `src/i18n/i18n-copy-ext.js` 里）。 */
export const NOTICE_MARK_BEGIN = 'UPDATE NOTICE COPY（begin）';
export const NOTICE_MARK_END = 'UPDATE NOTICE COPY（end）';

/** 允许被公告快通道覆盖的文件（**只允许这两个**；多了就是放行了别的代码）。 */
export const NOTICE_FILES = ['src/client.js', 'src/i18n/i18n-copy-ext.js'];

/** 差异条目超过这个数就直接 full（防"大范围改动被分类成文档"）。 */
export const DIFF_FLOOR = 300;

/**
 * 根目录里明确属于"纯文档"的文件（白名单必须**小且明确**：逐个列，不用 `*.md` 通配）。
 *
 * 三个 README 都要列：它们是同一个对外门面的三个语种/难度版本，漏一个就等于
 * "改那个版本的错别字要跑双平台全链" —— 与漏判同样都是错的判据。
 */
export const DOC_ROOT_FILES = ['README.md', 'README.en.md', 'README.beginner.md', 'CONTRIBUTING.md'];

/** 文档目录（普通 Markdown；机器派生契约见 `GENERATED_CONTRACTS`）。 */
export const DOC_DIRS = ['docs/'];

/**
 * 文档展示素材目录（图片与排版源稿；运行期素材**不**在此列）。
 *
 * ⚠️ 目录前缀**不是**白名单（D10）：`assets/readme/**` 里还躺着字体、许可正文、
 * 以及将来可能出现的任何二进制。前缀放行会把它们当成"文档" ⇒ 改字体不跑构建。
 * 因此这里只认**两类**：图片后缀（`ASSET_EXT`）与逐个列出的排版源稿（`ASSET_TEXT_FILES`）。
 * "随 npm 包发布" ≠ "运行期资源"，判据按**用途**分类，不按打包清单分类。
 */
export const ASSET_DIRS = ['assets/readme/'];

/** `assets/readme/` 里逐个人工确认过的**文本**源稿（可做 UTF-8 / 结构检查）。 */
export const ASSET_TEXT_FILES = [
  'assets/readme/SOURCES.md',
  'assets/readme/metadata.json',
  'assets/readme/hero.html',
  'assets/readme/creative-corner-source.json',
];

/**
 * 机器派生契约：内容由工具生成、且被判据当作事实读。
 * 改了它们等于改了判据本身 ⇒ 不享受文档豁免（否则"改判据"自称"改文档"）。
 */
export const GENERATED_CONTRACTS = [
  'docs/TOKEN-CONTRACT.md', 'docs/ROUTE-INDEX.md', 'docs/GUARD-MAP.md',
];

/** 一律完整验证的路径前缀 / 文件（包清单、锁文件、CI 接线本身）。 */
export const FULL_ALWAYS = ['package.json', 'package-lock.json'];
export const FULL_ALWAYS_DIRS = ['.github/'];

/** 文档快通道要核对引用的"素材"后缀。 */
export const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** 链接 / 引用里**不需要**在磁盘上核对的前缀（外链、站内锚点、绝对路径、data URI）。 */
const SKIP_LINK = /^(?:https?:|mailto:|tel:|data:|#|\/)/i;

const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '');
const startsIn = (p, dirs) => dirs.some((d) => p.startsWith(d));

/** 普通 Markdown 文档（白名单内）。 */
export function isDocFile(p) {
  const path = norm(p);
  if (!/\.md$/i.test(path)) return false;
  if (DOC_ROOT_FILES.includes(path)) return true;
  return startsIn(path, DOC_DIRS);
}

/** 文档展示素材（白名单内：`assets/readme/**` 里的**图片**与**逐个列出的文本源稿**）。 */
export function isDocAsset(p) {
  const path = norm(p);
  if (!startsIn(path, ASSET_DIRS)) return false;
  return ASSET_EXT.test(path) || ASSET_TEXT_FILES.includes(path);
}

/** 图片类素材（二进制：只查存在与大小，绝不按 UTF-8 扫文本）。 */
export function isImageAsset(p) {
  return ASSET_EXT.test(norm(p));
}

/**
 * 可以按文本检查的后缀。
 *
 * 判据：**先看类型，再看字节**。图片后缀直接算二进制（PNG 不一定含 NUL，靠"含不含 NUL"猜类型会漏）；
 * 已知文本后缀**永远**按文本查（`.md` / `.json` 里塞了 NUL 不能因此免检，反而要报 `nul`）。
 * 只有未知后缀才退回字节嗅探（`looksBinary`）。
 */
export const TEXT_EXT = /\.(?:md|markdown|json|txt|html?|ya?ml|css|js|mjs|cjs|ts|tsx)$/i;

/** 未知后缀的兜底嗅探：NUL 或解码替换字符（非法 UTF-8 的痕迹）⇒ 当二进制。 */
export function looksBinary(text) {
  return /[\u0000\uFFFD]/.test(String(text == null ? '' : text));
}

/** 该路径是否按文本检查（`text` / `binary`）。 */
export function textKind(p, text) {
  const path = norm(p);
  if (isImageAsset(path)) return 'binary';
  if (TEXT_EXT.test(path)) return 'text';
  return looksBinary(text) ? 'binary' : 'text';
}

/** 机器派生契约（命中 ⇒ full）。 */
export function isGeneratedContract(p) {
  return GENERATED_CONTRACTS.includes(norm(p));
}

/** 包清单 / 锁文件 / CI 接线（命中 ⇒ full）。 */
export function isPinnedPath(p) {
  const path = norm(p);
  return FULL_ALWAYS.includes(path) || startsIn(path, FULL_ALWAYS_DIRS);
}

/**
 * 把 `git diff --name-status -z` 的原始输出解析成条目 `[{ status, path, oldPath }]`。
 *
 * `-z` 形态：`R100\0old\0new\0M\0path\0…`（重命名 / 复制占**三段**）。不用 `-z` 的话，
 * 路径里的空格或引号会被 git 加引号转义 —— 那是"看起来解析对了，其实漏了带空格的路径"。
 */
export function parseNameStatus(raw) {
  const parts = String(raw == null ? '' : raw).split('\0').filter((s) => s !== '');
  const out = [];
  let i = 0;
  while (i < parts.length) {
    const status = String(parts[i]).trim().charAt(0).toUpperCase();
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      if (oldPath == null || path == null) break;
      out.push({ status, path: norm(path), oldPath: norm(oldPath) });
      i += 3;
      continue;
    }
    const path = parts[i + 1];
    if (path == null) break;
    out.push({ status, path: norm(path), oldPath: '' });
    i += 2;
  }
  return out;
}

/**
 * 把 `git diff --raw -z` 的原始输出解析成条目，**连模式位一起**：
 * `:<oldMode> <newMode> <oldSha> <newSha> <status>\0<path>\0…`（重命名 / 复制占**两个路径**）。
 *
 * 为什么非要 `--raw`：`--name-status` 只说"改了什么"，不说"改成了什么类型的文件"。
 * 一个 `docs/sneaky.md` 若是**符号链接**（mode `120000`），`--name-status` 里与普通 Markdown
 * 毫无区别 —— 而符号链接的内容指向仓库外，把它当文档就是让门禁去看一个它控制不了的目标。
 */
export function parseRawDiff(raw) {
  const parts = String(raw == null ? '' : raw).split('\0');
  const out = [];
  let i = 0;
  while (i < parts.length) {
    const head = parts[i];
    if (head == null || head === '') { i += 1; continue; }
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Za-z])\d*$/.exec(head.trim());
    if (!m) { i += 1; continue; }
    const status = m[5].toUpperCase();
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      if (oldPath == null || path == null) break;
      out.push({ status, path: norm(path), oldPath: norm(oldPath), oldMode: m[1], newMode: m[2] });
      i += 3;
      continue;
    }
    const path = parts[i + 1];
    if (path == null) break;
    out.push({ status, path: norm(path), oldPath: '', oldMode: m[1], newMode: m[2] });
    i += 2;
  }
  return out;
}

/** 符号链接的模式位（git 只认这一个值）。 */
export const SYMLINK_MODE = '120000';

/**
 * 分类本体（纯函数）：变更条目 → `{ mode, reasons, files }`。
 *
 * 顺序即 fail-closed 的顺序：**任何一条不放心就 full**，绝不因为"看起来主要是文档"而放行。
 */
export function classify(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((e) => ({
    status: String((e && e.status) || '').trim().charAt(0).toUpperCase(),
    path: norm(e && e.path),
    oldPath: norm(e && e.oldPath),
    oldMode: String((e && e.oldMode) || '').trim(),
    newMode: String((e && e.newMode) || '').trim(),
  }));
  const files = list.map((e) => e.path);
  const reasons = [];

  // ① 取不到差异 ⇒ 阻断（不是"按文档放行"）。
  if (!list.length) {
    return { mode: MODE_FULL, reasons: ['差异为空：取不到完整差异时不给文档豁免（fail-closed）'], files };
  }
  // ② 差异过大：分类的收益（省一次重活）远小于"漏判一个代码文件"的代价。
  if (list.length > DIFF_FLOOR) {
    reasons.push('差异 ' + list.length + ' 个文件 > 地板 ' + DIFF_FLOOR + ' 个：大范围改动一律完整验证');
  }
  // ③ 删除 / 重命名 / 未知状态：路径边界不可信（删掉一个 lib 文件也是"改文档"吗？）。
  const risky = list.filter((e) => e.status !== 'A' && e.status !== 'M');
  if (risky.length) {
    const kinds = [...new Set(risky.map((e) => e.status))].join('');
    reasons.push('含非新增/修改状态（' + kinds + '：删除 / 重命名 / 复制 / 未知 ⇒ 一律完整验证）'
      + '：' + risky.slice(0, 5).map((e) => e.path).join(' '));
  }
  // ④ 符号链接：名字像文档，内容是"另一个路径"。名字可信、指向不可信 ⇒ 不给豁免。
  const links = list.filter((e) => e.newMode === SYMLINK_MODE || e.oldMode === SYMLINK_MODE);
  if (links.length) {
    reasons.push('含符号链接（mode ' + SYMLINK_MODE + '）：' + links.slice(0, 5).map((e) => e.path).join(' '));
  }
  // ⑤ 机器派生契约：判据给自己免检就是假牙。
  const contracts = list.filter((e) => isGeneratedContract(e.path));
  if (contracts.length) reasons.push('改动机器派生契约（判据的事实来源）：' + contracts.map((e) => e.path).join(' '));
  // ⑥ 包清单 / 锁文件 / CI 接线：改了它们就改变了"门禁跑什么"这件事本身。
  const pinned = list.filter((e) => isPinnedPath(e.path));
  if (pinned.length) reasons.push('改动包清单 / 锁文件 / CI 接线：' + pinned.slice(0, 5).map((e) => e.path).join(' '));
  // ⑦ 公告快通道的**候选**：改动文件全都落在 NOTICE_FILES 里（至少一个）。
  // ⚠️ 这条必须在"白名单外"之前判：那两个文件本来就不在文档白名单里，先落到 ⑦ 就永远
  // 走不到这里。同时它只判"候选"，**不判内容** —— 分类层拿不到文件内容（纯函数、不读盘）。
  // 真正的放行由 `notice` 作业调 `judgeNoticeEdit()` 做内容级判定；内容不通过 ⇒ 该作业
  // 退出码 1 ⇒ `ci/result` 不放行。
  // ⚠️ **允许只改一个**：改中文正文时英文译文常常原样可用（措辞/数字微调）。漏译由
  // `judgeNoticeEdit` 的译文覆盖检查抓（它读当前词表族，不需要那个文件也被改）。
  const noticeSet = new Set(NOTICE_FILES);
  const isPureNoticeSet = list.length > 0 && list.every((e) => noticeSet.has(norm(e.path)));
  if (isPureNoticeSet && !reasons.length) {
    return {
      mode: MODE_NOTICE,
      reasons: ['改动全部落在公告快通道登记的文件（' + NOTICE_FILES.join(' / ') + '）⇒ 交 notice 作业做**内容级**判定'
        + '（区块外逐字节一致 · 区块内代码骨架一致 · 区块内译文覆盖完整；结构一变即判红）'],
      files,
    };
  }

  // ⑧ 白名单外的一切。
  const outside = list.filter((e) => !isDocFile(e.path) && !isDocAsset(e.path));
  if (outside.length) {
    const shown = outside.slice(0, 8).map((e) => e.path).join(' ');
    reasons.push('白名单外的路径（' + outside.length + ' 个）：' + shown + (outside.length > 8 ? ' …' : ''));
  }

  if (reasons.length) return { mode: MODE_FULL, reasons, files };

  const hasAsset = list.some((e) => isDocAsset(e.path));
  const hasDoc = list.some((e) => isDocFile(e.path));
  return {
    mode: hasAsset ? MODE_DOCS_ASSETS : MODE_DOCS,
    reasons: ['全部 ' + list.length + ' 个改动都在文档白名单内（'
      + (hasAsset ? '含展示素材 ⇒ 追加图片尺寸与引用检查' : '仅普通 Markdown')
      + '）· 文档 ' + list.filter((e) => isDocFile(e.path)).length + ' / 素材 '
      + list.filter((e) => isDocAsset(e.path)).length + (hasDoc ? '' : '（无 .md）')],
    files,
  };
}

/** 从 Markdown / HTML 里抽"要核对的本地相对引用"（`[x](p)`、`![x](p)`、`src="p"`、`href="p"`）。 */
export function docReferences(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  const md = /!?\[[^\]]*\]\(\s*([^)\s]+)/g;
  let m = md.exec(src);
  while (m !== null) {
    out.push({ spec: m[1], at: m.index });
    m = md.exec(src);
  }
  const html = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  m = html.exec(src);
  while (m !== null) {
    out.push({ spec: m[1], at: m.index });
    m = html.exec(src);
  }
  return out.filter((r) => !SKIP_LINK.test(r.spec)).map((r) => r.spec.split('#')[0].split('?')[0]).filter(Boolean);
}

/**
 * 冲突标记行（合入没解决完的 diff 残骸）。
 *
 * 只认**两侧**的 `<<<<<<<` / `>>>>>>>`：`=======` 在 Markdown 里是 setext 标题的下划线
 * （`标题\n=======`），把它当冲突标记会误伤正常文档 —— 与 `.github/workflows/verify.yml`
 * 里那条 `git grep` 判据保持同一条口径，两处不许各写一套。
 */
export function conflictMarkers(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (/^(?:<<<<<<< |>>>>>>> )/.test(line)) out.push({ line: i + 1, text: line.slice(0, 40) });
  });
  return out;
}

/** 尾随空白行（Markdown 的行尾双空格是换行语义 ⇒ 由调用方决定是否扫 .md）。 */
export function trailingWhitespace(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (/[ \t]+$/.test(line)) out.push({ line: i + 1 });
  });
  return out;
}

/** 仓库相对路径的所在目录（`docs/a/b.md` → `docs/a`；根目录文件 → `''`）。 */
export function dirOf(p) {
  const path = norm(p);
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** 每条路径**必须真跑过并成功**的作业（`changes` 是分类本身，四条路径都要它）。 */
export const REQUIRED_JOBS = {
  [MODE_DOCS]: ['changes', 'docs'],
  [MODE_DOCS_ASSETS]: ['changes', 'docs'],
  [MODE_NOTICE]: ['changes', 'notice'],
  [MODE_FULL]: ['changes', 'full'],
};

/** 各作业的中文职责名（理由文字用，避免把 `docs` 说成"文档检查"）。 */
const JOB_LABEL = {
  changes: '变更分类（changes）',
  docs: '文档快通道（docs）',
  notice: '公告快通道（notice）',
  full: '完整验证（full）',
};

/**
 * `ci/result` 汇总判据（纯函数）：`{ mode, jobs }` → `{ ok, reasons }`。
 *
 * 这是整条 CI 里**唯一**该被分支保护要求的那颗勾，所以它的失败方式必须是最严的那种：
 * 只有"这次路径要求的作业**真的跑过并 success**"才放行，其余一律不放行 ——
 * 失败、取消、缺失、**意外跳过**、以及 `mode` 为空/未登记（outputs 没接上）都不行。
 *
 * 为什么"跳过"也不能放行：`if:` 写错一个表达式，作业就静默不跑；而 `skipped` 在
 * 分支保护里和 success 一样是绿的。把"没跑"当成"过了"，正是这套分流最贵的错法。
 * 反过来，**按设计该跳过**的那条腿（docs 路径下的 full）必须放行 —— 判据认的是
 * `REQUIRED_JOBS[mode]` 这张表，而不是"所有作业都 success"。
 */
export function judgeResult(input) {
  const src = input || {};
  const mode = String(src.mode || '').trim();
  const jobs = (src.jobs && typeof src.jobs === 'object') ? src.jobs : {};
  const reasons = [];
  const conclusion = (name) => String(jobs[name] == null ? '' : jobs[name]).trim().toLowerCase();

  if (!MODES.includes(mode)) {
    reasons.push('分类模式未登记（mode=' + (mode || '空') + '）：outputs 没接上或分类器异常，不能默认放行');
    return { ok: false, reasons };
  }

  for (const name of REQUIRED_JOBS[mode]) {
    const got = conclusion(name);
    const label = JOB_LABEL[name] || name;
    if (!got) { reasons.push('必需作业结果缺失：' + label + '（没跑到 / 名字写错 / 汇总没拿到）'); continue; }
    if (got === 'success') continue;
    if (got === 'skipped') { reasons.push('必需作业被跳过（跳过不等于通过）：' + label); continue; }
    reasons.push('必需作业未成功（' + got + '）：' + label);
  }

  // 非必需的那条腿按设计应是 skipped；若它其实跑起来并失败/取消，说明状态自相矛盾，同样不放行。
  for (const name of Object.keys(jobs)) {
    if (REQUIRED_JOBS[mode].includes(name)) continue;
    const got = conclusion(name);
    if (got === 'failure' || got === 'cancelled' || got === 'timed_out') {
      reasons.push('非必需作业实际执行但未成功（' + got + '）：' + (JOB_LABEL[name] || name));
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * 文档快通道判据（纯函数）：`{ entries, read, exists, sizeOf }` → `{ findings, counts }`。
 *
 * 三个探针都**注入**（不读盘），于是负对照可以喂合成输入证明它真的有牙。
 * `findings` 非空 ⇒ 文档检查失败（快通道不是"跑跑看"，它有硬判据）。
 *
 * 两条容易写错的地方，都在这里钉住：
 *   · **引用按文档所在目录解析**（`exists(spec, baseDir)`）：`docs/README.md` 里的
 *     `[x](CHANGELOG.md)` 指的是 `docs/CHANGELOG.md`，不是仓库根的 `CHANGELOG.md`。
 *     按仓库根解析会让每一份子目录文档都"引用缺失" —— 误报多了，真报就没人看了。
 *   · **二进制不按 UTF-8 扫**：PNG 解成字符串必然出现替换字符与"尾随空白"，
 *     那是解码噪声不是缺陷。图片只看存在与大小；`.md` / `.json` 这类文本后缀
 *     **不因含 NUL 而免检**（含 NUL 本身就是 `nul` 发现）。
 */
export function auditDocs(input) {
  const src = input || {};
  const entries = Array.isArray(src.entries) ? src.entries : [];
  const read = typeof src.read === 'function' ? src.read : () => null;
  const exists = typeof src.exists === 'function' ? src.exists : () => false;
  const sizeOf = typeof src.sizeOf === 'function' ? src.sizeOf : () => 0;
  const findings = [];
  const counts = { files: 0, refs: 0, skippedRefs: 0, missingRefs: 0, binarySkipped: 0 };
  const push = (file, kind, detail) => findings.push({ file, kind, detail });

  for (const entry of entries) {
    const path = norm(entry && entry.path);
    if (!path) continue;
    // 图片类素材：只查存在与大小（下面的素材段落），文本检查一律不做。
    if (isImageAsset(path)) continue;
    // 只查**还在盘上**的那一侧：删除件由分类层判 full，这里没有可读内容 ⇒ 不重复判。
    const text = read(path);
    if (text == null) continue;
    if (textKind(path, text) === 'binary') { counts.binarySkipped += 1; continue; }
    counts.files += 1;
    const isMd = /\.md$/i.test(path);
    const baseDir = dirOf(path);

    if (String(text).includes('\u0000')) {
      push(path, 'nul', '文本文件里有 NUL 字节（不是可读文本；不接受"含 NUL 就跳过检查"）');
    }
    for (const marker of conflictMarkers(text)) {
      push(path, 'conflict', '第 ' + marker.line + ' 行有冲突标记：' + marker.text.trim());
    }
    if (!isMd) {
      for (const ws of trailingWhitespace(text)) push(path, 'trailing-ws', '第 ' + ws.line + ' 行尾随空白');
    }
    if (path.endsWith('.json')) {
      try {
        JSON.parse(text);
      } catch (err) {
        push(path, 'json', '不是合法 JSON：' + String(err && err.message ? err.message : err));
      }
    }

    for (const spec of docReferences(text)) {
      counts.refs += 1;
      if (SKIP_LINK.test(spec)) { counts.skippedRefs += 1; continue; }
      if (exists(spec, baseDir)) continue;
      counts.missingRefs += 1;
      push(path, 'missing-ref', '引用了不存在的相对路径：' + spec
        + (baseDir ? '（相对 ' + baseDir + '/ 解析）' : '（相对仓库根解析）'));
    }
  }

  // 素材模式追加：白名单里的图片必须**非空**（0 字节的 PNG 在 README 上就是裂图）。
  const assetMode = entries.some((e) => isDocAsset(norm(e && e.path)));
  if (assetMode) {
    for (const entry of entries) {
      const path = norm(entry && entry.path);
      if (!isImageAsset(path)) continue;
      if (!exists(path)) { push(path, 'asset-missing', '展示素材不在盘上'); continue; }
      if (sizeOf(path) <= 0) push(path, 'asset-empty', '展示素材是 0 字节（README 上会裂图）');
    }
  }

  return { findings, counts, assetMode };
}

// ══ ④ 公告快通道（notice）：只改公告文案的提交绕过全量链 ══════════════════════
//
// ## 守的是什么实害（以及为什么这条捷径比文档通道更危险）
// 更新公告是**每版必改**的一小块文案，改一句错别字也要跑双平台全链（装依赖 / 构建 /
// 全量守卫 / 媒体桥 / 冒烟）。但公告住在 `src/client.js`（整份浏览器半边）与
// `src/i18n/i18n-copy-ext.js`（词表域）里 —— **按文件名放行等于让整份客户端免检**。
// 因此这条通道**不认文件名**，只认**内容级事实**：
//   ① 两个文件里被 `UPDATE NOTICE COPY` 标记圈出的区块**之外**，逐字节完全一致；
//   ② 区块**之内**，把字符串字面量的内容挖空、注释剥掉后得到的「代码骨架」逐字节一致。
// 也就是说：只允许"改引号里的字"。增删一个键、改一个 props、加一个分支都会让骨架变
// ⇒ 回落 `full`。结构变更永远拿不到豁免。
//
// ## 为什么骨架挖空字符串内容而不只剥注释
// 公告的可变面**就是**字符串内容（标题 / 每条正文 / 英文译文）。只剥注释的话，改一个字
// 都判红，通道没用；连字符串一起保留又等于不判。挖空内容却保留**引号/逗号/括号/键位**
// 恰好是"只有值可变、形状不可变"的机器表达 —— 增删一条键会改变引号与逗号的位置。
//
// ## fail-closed
// 标记缺失 / 重复 / 顺序颠倒、区块外任何字节差异、骨架任何差异、旧版本读不到 —— 一律 full。

/**
 * 从一份源码里切出公告区块：`{ before, block, after }`，标记行本身**计入区块**
 * （标记行的增删同样属于"形状"变化）。找不到 / 重复 / 顺序颠倒 ⇒ `null`（调用方 fail-closed）。
 * @param {string} src
 * @returns {{before:string, block:string, after:string}|null}
 */
export function sliceNoticeBlock(src) {
  const text = String(src == null ? '' : src);
  const b = text.indexOf(NOTICE_MARK_BEGIN);
  if (b < 0) return null;
  if (text.indexOf(NOTICE_MARK_BEGIN, b + NOTICE_MARK_BEGIN.length) >= 0) return null;
  const e = text.indexOf(NOTICE_MARK_END, b);
  if (e < 0) return null;
  if (text.indexOf(NOTICE_MARK_END, e + NOTICE_MARK_END.length) >= 0) return null;
  // 区块从 begin 标记**所在行的行首**开始，到 end 标记**所在行的行尾**结束 ——
  // 这样区块外不会残留半行注释（否则改标记行的缩进会被算成"区块外改动"）。
  const lineStart = text.lastIndexOf('\n', b) + 1;
  const endLineBreak = text.indexOf('\n', e);
  const blockEnd = endLineBreak < 0 ? text.length : endLineBreak + 1;
  return { before: text.slice(0, lineStart), block: text.slice(lineStart, blockEnd), after: text.slice(blockEnd) };
}

/**
 * 把一段 JS 源码化成「骨架」：注释换空格、**字符串/模板字面量的内容换空格**
 * （引号保留、换行保留 ⇒ 行号与行数不变）。
 *
 * 与 `test/tools/js-text.mjs` 的 `stripComments` / `blankStringLiterals` 同一套字符扫描
 * 语义（字符串感知：`https://x` 里的 `//`、正则里的 `[/*]` 都不当注释）。本文件保持零依赖，
 * 故就地实现；两条实现对同一批输入的逐字节一致性由 `test/verify-notice-routing.mjs` 的自检钉住。
 *
 * ⚠️ 模板字面量的 `${…}` 里是**代码**不是文案：挖空整段会把"插值被改掉"也放过 ⇒
 * 只挖空静态段，`${…}` 原样保留（其内容不递归求骨架，但那是**更严**的方向：改了插值就判红）。
 *
 * @param {string} src
 * @returns {string}
 */
export function noticeSkeleton(src) {
  const text = String(src == null ? '' : src);
  const n = text.length;
  const out = [];
  let i = 0;
  let prev = '';
  const isValueEnd = (ch) => ch !== '' && /[\w$)\]}'"`]/.test(ch);
  const blank = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const blankKeepStructure = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '/' && c2 === '/') {                       // 行注释
      while (i < n && text[i] !== '\n') { blank(text[i]); i += 1; }
      continue;
    }
    if (c === '/' && c2 === '*') {                       // 块注释
      blank(c); blank(c2); i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { blank(text[i]); i += 1; }
      if (i < n) { blank(text[i]); blank(text[i + 1]); i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {           // 字符串 / 模板
      const quote = c;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        j += 1;
        if (d === quote) { closed = true; break; }
      }
      const end = Math.min(j, n);
      const inner = text.slice(i + 1, closed ? end - 1 : end);
      out.push(quote);
      if (quote === '`' && /\$\{/.test(inner)) {
        // 模板只挖静态段：`${…}`（含嵌套花括号）原样保留。
        let k = 0;
        let seg = '';
        const flush = () => { if (seg) { out.push(blankKeepStructure(seg)); seg = ''; } };
        while (k < inner.length) {
          if (inner[k] === '$' && inner[k + 1] === '{') {
            flush();
            let depth = 1;
            let m = k + 2;
            while (m < inner.length && depth > 0) {
              if (inner[m] === '{') depth += 1;
              else if (inner[m] === '}') depth -= 1;
              m += 1;
            }
            out.push(inner.slice(k, m));
            k = m;
            continue;
          }
          seg += inner[k];
          k += 1;
        }
        flush();
      } else {
        out.push(blankKeepStructure(inner));
      }
      if (closed) out.push(quote);
      prev = quote;
      i = end;
      continue;
    }
    if (c === '/' && !isValueEnd(prev)) {                // 正则字面量：整段原样保留
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j += 1; closed = true; break; }
        j += 1;
      }
      out.push(text.slice(i, Math.min(j, n)));
      prev = closed ? '/' : c;
      i = Math.min(j, n);
      continue;
    }
    out.push(c);
    if (!/[\s]/.test(c)) prev = c;
    i += 1;
  }
  return out.join('');
}

/** 首个差异的位置与两侧上下文（日志可读；不做完整 diff）。 */
function firstDiff(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x[i] === y[i]) i += 1;
  const line = x.slice(0, i).split('\n').length;
  const col = i - (x.lastIndexOf('\n', i) + 1) + 1;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 50));
  return '首个差异在第 ' + line + ' 行第 ' + col + ' 列；旧=' + ctx(x) + ' 新=' + ctx(y);
}

/**
 * 公告快通道判定（纯函数）：内容快照 + 改动文件集 → `{ ok, reasons }`。
 *
 * `before` / `after` 是 `{ [relPath]: content|null }` —— **两个文件的快照都要给**
 * （`null` = 该侧读不到），因为译文覆盖检查需要读**未改动**那一侧的当前内容。
 * `changed` 是本次**真正改动**的路径列表（缺省取 `after` 的键，便于负对照直喂）。
 * `dictionary` 是整个**词表族**的拼接文本（可选；缺省用 `after[i18n-copy-ext.js]`）。
 * 传全族的理由：公告里的「知道了」等词条住在别的域文件（`i18n-copy-core.js`），
 * 只查单文件会误判成漏译。
 *
 * 放行条件：改动文件 ⊆ `NOTICE_FILES`；每个改动文件的公告区块外逐字节一致、区块内骨架一致；
 * 且公告区块里每个 `weT("原文")` 在词表里有对应键。
 * 失败时的 `reasons` 直接进 CI 日志，说明**为什么回落 full**。
 *
 * @param {{before?: Record<string,string|null>, after?: Record<string,string|null>,
 *   changed?: string[], dictionary?: string}} input
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function judgeNoticeEdit(input) {
  const src = input || {};
  const before = src.before || {};
  const after = src.after || {};
  const changed = (Array.isArray(src.changed) ? src.changed : Object.keys(after)).map((p) => norm(p));
  const reasons = [];
  const fail = (r) => ({ ok: false, reasons: reasons.concat([r]) });

  if (!changed.length) return fail('公告快通道：差异为空');
  const extra = changed.filter((p) => !NOTICE_FILES.includes(p));
  if (extra.length) {
    return fail('公告快通道只覆盖 ' + NOTICE_FILES.join(' / ') + '，本次还改了：'
      + extra.slice(0, 5).join(' ') + (extra.length > 5 ? ' …共 ' + extra.length : ''));
  }
  // ⚠️ **允许只改一个文件**：改中文正文时英文译文常常原样可用（措辞微调、改个数字），
  // 强制两个文件同改只会逼人为凑数去改译文。但"只改中文、英文漏了"仍是真缺陷，
  // 所以下面 ③ 单独核一次**公告区块内**的译文覆盖（只查这一段，不跑整条 i18n 守卫）。
  for (const rel of changed) {
    const b = before[rel];
    const a = after[rel];
    if (a == null) return fail('公告快通道：' + rel + ' 新版读不到（删除 / 读失败）');
    if (b == null) return fail('公告快通道：' + rel + ' 旧版读不到（新增文件 / 读失败）');
    const sb = sliceNoticeBlock(b);
    const sa = sliceNoticeBlock(a);
    if (!sb) return fail(rel + ' 旧版缺少唯一的公告区块标记（' + NOTICE_MARK_BEGIN + ' / ' + NOTICE_MARK_END + '）');
    if (!sa) return fail(rel + ' 新版缺少唯一的公告区块标记（' + NOTICE_MARK_BEGIN + ' / ' + NOTICE_MARK_END + '）');
    // ① 区块外逐字节一致 —— 整条捷径的安全性全在这两行。
    if (sb.before !== sa.before) {
      return fail(rel + ' 公告区块**之前**的内容有改动（这已不是"只改公告文案"）：' + firstDiff(sb.before, sa.before));
    }
    if (sb.after !== sa.after) {
      return fail(rel + ' 公告区块**之后**的内容有改动（这已不是"只改公告文案"）：' + firstDiff(sb.after, sa.after));
    }
    // ② 区块内骨架一致：只许改引号里的字。
    const kb = noticeSkeleton(sb.block);
    const ka = noticeSkeleton(sa.block);
    if (kb !== ka) {
      return fail(rel + ' 公告区块内的**代码骨架**有改动（增删条目 / 改 props / 加分支不走这条捷径）：'
        + firstDiff(kb, ka));
    }
  }
  // ③ 公告区块内的**译文覆盖**：区块里每个 `weT("原文")` 都必须能在那份词表里找到键。
  //    只核这一段 —— 不动整条 i18n 守卫（它管全仓 700+ 条，那是 full 链的事）。
  //    读的是**当前**内容（未改的那个文件也读），所以"只改中文、漏译文"照样能被抓到。
  //
  //    ⚠️ 两个范围限制，都有实测理由：
  //      · 查**整份词表文件**而不是只查它的公告区块 —— 配图 caption / 求星入口这几条的
  //        词条**故意住在公告区块外**（它们不随公告换血，是稳定面）；
  //      · 「知道了」的词条住在**另一个域文件**（`src/i18n/i18n-copy-core.js`）⇒ 调用方必须把
  //        整个词表族的内容拼起来传进来（`scripts/ci-routing.mjs` 那边按 DICT_FAMILY 拼）。
  //        只传 `i18n-copy-ext.js` 会把它误判成漏译（实测：1 条假红）。
  const clientText = after[NOTICE_FILES[0]];
  const dictText = after[NOTICE_FILES[1]];
  if (clientText == null || dictText == null) {
    return fail('公告快通道：两个文件的当前内容都要可读（client=' + (clientText == null ? '缺失' : 'ok')
      + ' dict=' + (dictText == null ? '缺失' : 'ok') + '）—— 译文覆盖检查需要两份');
  }
  const clientBlock = sliceNoticeBlock(clientText).block;
  const missing = noticeKeysWithoutTranslation(clientBlock, src.dictionary == null ? dictText : String(src.dictionary));
  if (missing.length) {
    return fail('公告区块里有 ' + missing.length + ' 句缺少英文词条（漏译 ⇒ 英文界面会原样露中文）：'
      + missing.slice(0, 4).map((k) => JSON.stringify(k.slice(0, 28))).join(' ')
      + (missing.length > 4 ? ' …' : ''));
  }
  reasons.push(changed.length === NOTICE_FILES.length ? '两个文件的' : '单个文件的'
    + '公告区块外逐字节一致 · 区块内代码骨架一致 · 区块内译文覆盖完整 ⇒ 只改了公告文案');
  return { ok: true, reasons };
}

/**
 * 公告区块内的**译文覆盖**：抽 `weT("原文")` 的字面量，逐个查词表区块里有没有键。
 *
 * 只做"有没有这条键"，不判译文质量/占位符 —— 那些是 `test/verify-i18n.mjs` 的职责，
 * 在这条**绕过全链**的捷径上重复实现一遍只会多一份会漂的判据。
 * 不含 CJK 的键（如 `⭐ 去 GitHub 点亮 Star` 这类纯符号/英文混排）同样要求有词条：
 * 词表双向对账在 full 链上不分语种，这里保持同一口径（少一条就判红）。
 *
 * @param {string} clientBlock `src/client.js` 的公告区块原文
 * @param {string} dictBlock   `src/i18n/i18n-copy-ext.js` 的公告区块原文
 * @returns {string[]} 缺词条的原文
 */
export function noticeKeysWithoutTranslation(clientBlock, dictBlock) {
  const keys = [];
  const re = /\bweT\("((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(String(clientBlock == null ? '' : clientBlock))) !== null) {
    // 转义还原（`\"` / `\\`），与 JS 字面量语义一致。
    let key = m[1];
    try { key = JSON.parse('"' + key + '"'); } catch { /* 保持原样 */ }
    if (key && !keys.includes(key)) keys.push(key);
  }
  const dict = String(dictBlock == null ? '' : dictBlock);
  const has = (key) => {
    const esc = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return dict.includes('"' + esc + '":') || dict.includes('"' + esc + '" :');
  };
  return keys.filter((k) => !has(k));
}
