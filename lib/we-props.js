/**
 * WE 壁纸用户属性解析（`project.json` 的 `general.properties`）。
 *
 * 这是上游 webwallgl `host/we-props.ts`（其本身又是主项目 Rust 侧
 * `we_props.rs` 的 TS 复刻）的裁剪版，只保留「属性面板 + 热更新」需要的那部分。
 * 下面几条语义都是上游按上千个真实属性校准出来的**反直觉结论**，实现里别顺手
 * "简化"掉：
 *
 *  - `order` 按**浮点**读（真实壁纸用 32.5 / 1151.0022 做细分排序键），并列时按
 *    **码位**比较 —— localeCompare 会做大小写不敏感的整理，与 WE 侧字节序不一致，
 *    实测会让同 order 的属性换位；
 *  - `combo` 选项值保留声明的 JSON 类型：整数/字符串/布尔混用是常态，统一字符串化
 *    会让壁纸里的 `===` / `switch` 全部失配；
 *  - 文案取壁纸自带 `general.localization`，按 zh-chs → zh-cht → en-us **逐键**
 *    回退（表是残缺的，逐语言回退会漏键）；
 *  - `text` 类型是静态说明 / 分节标题，不是输入框（大量 text 属性连 value 都没有）；
 *  - `condition` 只影响本面板的显隐，**下发时绝不按它过滤** —— WE 里被隐藏的属性
 *    照样要下发给壁纸，过滤会让壁纸读不到值而异常；
 *  - `editable: false` 是作者在 WE 编辑器里标记的「用户不可编辑」（典型是壁纸脚本自读自写的
 *    工作变量，作者不希望用户动它）。WE 的语义是**属性照样下发给壁纸**，只是编辑器里不显示。
 *    **本实现与旧版不同（2026-11-10 起，issue #341 顺带修）：不再整条丢弃。**
 *    `parseUserPropDefs` 现在把这类条目**留在返回里**并标记 `hidden: true`，由面板侧过滤；
 *    仍走同一条通道下发（`buildSeedScript` 吃的就是这份返回），所以壁纸脚本拿到的是
 *    `project.json` 里写的值，与 WE 一致。旧实现的后果是壁纸拿到自己的默认值（场景快照里
 *    那份），两者不一致时行为会与 WE 不同。
 *    判据：`test/verify-scene-live.mjs` Level C5（属性表里 `internal.hidden === true` 且
 *    值照常出现在下发面里）。

/** 支持的语言标签（按序逐键回退）；表里大小写不敏感 */
const LANG_ORDER = ['zh-chs', 'zh-cht', 'en-us'];

/** 属性类型 → 上游 ptype 名（未知类型落 other） */
const KNOWN_TYPES = new Set([
  'color', 'bool', 'slider', 'combo', 'text', 'textinput',
  'file', 'directory', 'group', 'other',
]);

/** 文件类属性的扩展名分类（`fileType` 声明 image/video/audio 时用来筛候选文件） */
const FILE_EXT = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.apng', '.svg'],
  video: ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'],
  audio: ['.mp3', '.ogg', '.oga', '.wav', '.m4a', '.flac', '.aac'],
};

function orderOf(def) {
  const n = Number(def && def.order);
  return Number.isFinite(n) ? n : 0;
}

/** 非空字符串字段 */
function strField(v, key) {
  const s = v && v[key];
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t === '' ? undefined : t;
}

/** 去标签 + 解常见实体（WE 属性文案里带 HTML 是常态） */
function stripHtml(raw) {
  if (typeof raw !== 'string' || raw === '') return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** localization 查表：{ lang: { key: text } }，语言标签大小写不敏感 */
function lookupLocalization(project, key) {
  const table = project && project.general && project.general.localization;
  if (!table || typeof table !== 'object') return undefined;
  // 表里的语言名大小写不一（zh-CHS / en-US 都出现过）：先做一次小写索引
  const byLang = {};
  for (const k of Object.keys(table)) byLang[k.toLowerCase()] = table[k];
  for (const lang of LANG_ORDER) {
    const entry = byLang[lang];
    if (entry && typeof entry === 'object' && typeof entry[key] === 'string') return entry[key];
  }
  return undefined;
}

/** 属性/选项文案：localization → 原文（已去标签）→ 回退值 */
function resolveText(project, raw, key, fallback) {
  const loc = lookupLocalization(project, key);
  const src = typeof loc === 'string' && loc.trim() !== '' ? loc : raw;
  const clean = stripHtml(src);
  return clean !== '' ? clean : fallback;
}

/** project.json 属性值 → WE 线格式；无值（如未选文件的 file）返回 undefined */
function wireValue(ptype, def) {
  if (!def || !('value' in def)) return undefined;
  const raw = def.value;
  if (raw === null || raw === undefined) return undefined;
  switch (ptype) {
    case 'color':
      return typeof raw === 'string' ? raw : undefined;
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'slider': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'combo':
      // 保留声明类型（数字 / 字符串 / 布尔混用）
      return raw;
    default:
      return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
}

/** 只有带 `type` 的条目算真属性（跳过 tip / ui_* 之类的纯显示项） */
function rawProps(project) {
  const props = project && project.general && project.general.properties;
  if (!props || typeof props !== 'object') return [];
  const out = Object.entries(props).filter(([, v]) => v && typeof v === 'object' && typeof v.type === 'string');
  // order 浮点升序；并列按码位（不是 localeCompare，见文件头）
  out.sort((a, b) => orderOf(a[1]) - orderOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

/**
 * 解析成面板用的属性列表。
 *
 * @param project  壁纸目录下的 project.json（对象；读不到就传 null）
 * @param overrides 用户覆盖值 `{name: wireValue}`（来自插件设置）
 * @param {object} [opts] 可选注入面
 * @param {string} [opts.filePrefix]  file/directory 值的目录前缀（网页壁纸按入口所在目录补，
 *                        与上游 effectiveProps 的语义一致）；scene 传空串
 * @param {string[]} [opts.listFiles] 目录里按 fileType 筛出的候选文件（file/directory 用）
 */
export function parseUserPropDefs(project, overrides, opts = {}) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const filePrefix = typeof opts.filePrefix === 'string' ? opts.filePrefix : '';
  const out = [];
  for (const [name, def] of rawProps(project)) {
    // 作者标记「用户不可编辑」：面板隐藏，但值照常下发（WE 语义；见文件头）
    const hidden = def.editable === false;
    const ptype = String(def.type || 'other');
    const kind = KNOWN_TYPES.has(ptype) ? ptype : 'other';
    const dflt = wireValue(kind, def);
    const overridden = Object.prototype.hasOwnProperty.call(ov, name);
    let value = overridden ? ov[name] : dflt;
    // file：值相对壁纸根存储，下发时按入口目录补前缀（空值不补，否则凭空指向目录）
    if (kind === 'file' && typeof value === 'string' && value !== '' && filePrefix) value = `${filePrefix}${value}`;
    const entry = {
      name,
      ptype: kind,
      text: resolveText(project, typeof def.text === 'string' ? def.text : '', name, name),
      order: orderOf(def),
      value: value === undefined ? null : value,
      default: dflt === undefined ? null : dflt,
      overridden,
    };
    const cond = strField(def, 'condition');
    if (cond) entry.condition = cond;
    if (hidden) entry.hidden = true;
    if (Array.isArray(def.options)) {
      const options = def.options
        .filter((o) => o && typeof o.label === 'string' && 'value' in o)
        .map((o) => {
          const opt = {
            label: resolveText(project, o.label, o.label,
              typeof o.value === 'string' ? o.value : JSON.stringify(o.value)),
            value: o.value,
          };
          const oc = strField(o, 'condition');
          if (oc) opt.condition = oc;
          return opt;
        });
      if (options.length) entry.options = options;
    }
    if (Number.isFinite(Number(def.min))) entry.min = Number(def.min);
    if (Number.isFinite(Number(def.max))) entry.max = Number(def.max);
    if (Number.isFinite(Number(def.step))) entry.step = Number(def.step);
    if (Number.isFinite(Number(def.precision))) entry.precision = Number(def.precision);
    const ft = strField(def, 'fileType');
    if (ft) entry.fileType = ft;
    // 文件类属性：把候选文件一并给出（面板渲染成下拉，比手打路径可靠）
    if ((kind === 'file' || kind === 'directory') && Array.isArray(opts.listFiles)) {
      const exts = FILE_EXT[ft] || null;
      const files = opts.listFiles.filter((f) => {
        if (exts === null) return true;
        const lower = f.toLowerCase();
        return exts.some((e) => lower.endsWith(e));
      });
      if (files.length) entry.files = files.slice(0, 200);
    }
    out.push(entry);
  }
  return out;
}

/** 入口文件的目录前缀（相对壁纸根，带末尾 /；根入口为空串） */
export function entryDirPrefix(entryRel) {
  if (typeof entryRel !== 'string') return '';
  const rel = entryRel.trim().replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('/') || rel.split('/').includes('..')) return '';
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i + 1);
}

/** 只保留 project.json 里声明过的覆盖值（属性被作者删掉后，陈旧覆盖值忽略） */
export function filterKnownOverrides(project, overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const declared = new Set(rawProps(project).map(([name]) => name));
  const out = {};
  for (const [name, v] of Object.entries(ov)) if (declared.has(name)) out[name] = v;
  return out;
}
