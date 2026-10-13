/**
 * system-fonts.js — **本机字体清单**的客户端通道：拿一次宿主枚举的族名清单，缓存住，
 * 供「全局字体 / 终端字体」两个下拉里那一组「本机字体」用。
 *
 * 为什么另立一条通道（而不是塞进 client.js 正文）：它有自己的**真源**（宿主那次进程扫描，
 * 不是设置也不是字体集）、自己的**失败语义**（取不到就只能给内置族键，界面上必须说出来）、
 * 和自己的**缓存**（localStorage 只是缓存：首帧就能把已选中的本机字体显示成名字，而不是
 * 一个空下拉）。与 `fontset-store.js` 同一形态、同一纪律。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   selection            ← 共享 store（本文件只写清单自己的那几个瞬态字段：systemFonts /
 *                          systemFontsAt / systemFontsApproximate / systemFontsLoading /
 *                          systemFontsError）
 *   apiFetch             ← src/api-client.js（宿主 API 唯一出入口；BASE 只在调用期读）
 *   hostFailureReason    ← src/client.js（"失败到底哪一步不对"的通用文案）
 *   systemFontKeyOf      ← lib/settings-schema.js（**名字的值域**：进不了族键的名字这里就丢掉）
 *   emit                 ← 单向重渲染
 * 提供：
 *   readCachedSystemFonts()   同步读本地缓存（**client.js 的 store 初始化要用**）
 *   ensureSystemFonts(force)  拉一次清单（TTL 内是空操作；force = 面板上的「重新扫描」）
 *   systemFontKeyList()       当前清单 → `sys:` 族键数组（面板的选项由 client.js 拼）
 *
 * 不变量：
 *   · **扫描是宿主的活，本文件不猜**：只信宿主回的 `fonts`；`approximate` 原样透传
 *     （面板据此显示"按文件名推测"），不因为"看起来不对"就自己改名单。
 *   · **进下拉的名字必须是"能用"的**：拼得出 `sys:` 族键（值域在共享内核），且不是 `.` 开头的
 *     私有族。缓存是不受信副本 ⇒ 这一层过滤在客户端也要做（见 `systemFontKeyList`）。
 *   · **清单是瞬态**：只进 `selection` 与 localStorage 缓存，**不落 config.json**、
 *     不进字体集（字体集里存的是**选中的那个键**，不是这份清单）。
 *   · **localStorage 只是缓存**：启动时先同步读它（已选中的本机字体首帧就显示成名字），
 *     宿主回了真值再覆盖；读不出来/存不进都不影响主路径。
 *   · **在途 GET 不覆盖用户的新选择**：清单只写自己那四个字段，从不碰字体值 —— 这条
 *     不需要计数器（与字体集那条通道的差别正在这里）。
 *   · 本文件必须浏览器安全（无 import / Node API），且**不得有顶层可执行语句**读外层 const
 *     （会被内联到 bundle 顶部，撞 TDZ）—— 因此 BASE 只在函数体里读。
 */

/** 清单的本地缓存键（与设置/字体集的缓存分开：三者真源不同，混在一起会互相顶掉）。 */
const SYSTEM_FONTS_CACHE_KEY = "we-system-fonts";
/** 客户端侧的"别每次开面板都问"窗口：宿主那边有更长的 TTL，这里只是省一次请求。 */
const SYSTEM_FONTS_TTL_MS = 10 * 60 * 1000;

/**
 * 失败文案：**裸状态码 = 请求没到本族**（与字体集通道同一条洞察的本地化版本）。
 * "宿主里没有这条路由"最常见的原因就是宿主没重挂（宿主模块只在启动时
 * 加载一次，而浏览器里的 bundle 每次刷新都重新取）—— 这种话必须说出来，否则用户只能看到
 * "宿主返回 404"。有信封时一律用宿主给的原话。
 */
function systemFontsFailureReason(res) {
  const bare = !res || !res.data || typeof res.data !== "object" || !res.data.error;
  if (bare && (res.status === 404 || res.status === 405)) {
    return weT("宿主里没有本机字体路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）");
  }
  return hostFailureReason(res);
}

function systemFontsUrl() { return BASE + "/system-fonts"; }

/** 读本地缓存那份（形状不合就当作没有）；返回**族名数组**。 */
function readCachedSystemFonts() {
  try {
    const raw = localStorage.getItem(SYSTEM_FONTS_CACHE_KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.fonts)) return [];
    return systemFontKeyList(doc.fonts);
  } catch {
    return [];
  }
}
function writeSystemFontsCache(fonts, approximate) {
  try {
    localStorage.setItem(SYSTEM_FONTS_CACHE_KEY, JSON.stringify({ fonts, approximate: approximate === true }));
  } catch { /* 缓存写失败不影响真源 */ }
}

/**
 * 清单本身（或缓存里那份）→ 只留**能进界面的**名字：
 *   · 拼得出 `sys:` 族键（值域判据在共享内核，与本文件同一条）；
 *   · **不是 `.` 开头的私有族**（`.Apple Color Emoji UI` 这类是系统内部字体）。
 * 第二条在宿主那边也有一份（枚举时滤掉）—— 这里再做一次不是重复劳动：缓存是 localStorage 里
 * 的一份**不受信副本**，而"要不要把私有族摆进下拉"是**界面规则**，不该依赖上游有没有滤干净。
 */
function systemFontKeyList(names) {
  return (Array.isArray(names) ? names : [])
    .filter((n) => typeof n === "string" && !n.trim().startsWith(".") && systemFontKeyOf(n) !== "");
}

/**
 * 拉一次清单。TTL 内、或正在途中，都不重复发请求（`force` 跳过 TTL，给面板上的重新扫描用）。
 * 失败**不清空**已有清单（"上次拿到的那份"比空下拉有用），只把原因写进 `systemFontsError`。
 */
async function ensureSystemFonts(force) {
  if (selection.systemFontsLoading) return;
  if (!force && selection.systemFontsAt && Date.now() - selection.systemFontsAt < SYSTEM_FONTS_TTL_MS) return;
  selection.systemFontsLoading = true;
  selection.systemFontsError = "";
  emit();
  try {
    const res = await apiFetch(systemFontsUrl() + (force ? "?refresh=1" : ""), { parse: "always" });
    if (res.ok && res.data && Array.isArray(res.data.fonts)) {
      const fonts = systemFontKeyList(res.data.fonts);
      selection.systemFonts = fonts;
      selection.systemFontsAt = Date.now();
      selection.systemFontsApproximate = res.data.approximate === true;
      selection.systemFontsError = "";
      writeSystemFontsCache(fonts, res.data.approximate === true);
    } else {
      // 宿主说"一个都没读到"也是一种结果（不是故障）：清单留空，但原因照说。
      selection.systemFontsError = res.ok
        ? weT("没读到本机字体清单")
        : systemFontsFailureReason(res);
    }
  } catch {
    selection.systemFontsError = weT("宿主不可达（请求未完成）");
  } finally {
    selection.systemFontsLoading = false;
    emit();
  }
}

/** 探针量文字：只有拉丁字母与数字（**必须**这样 —— 见 `probeUsableFamilies` 的手法）。 */
const FONT_PROBE_TEXT = 'Hamburgefonstiv 0123456789';
/** 探针结果的记忆位（按清单数组的**身份**）：清单整体替换时重量一次。 */
let sysFontProbeFor = null;
let sysFontProbeResult = { fonts: [], skipped: 0, measured: false };

/**
 * 本浏览器**能不能匹配**这个族名 —— 匹配不上时，选它等于什么都没发生。
 *
 * 为什么必须有这道筛（**现场缺陷**：用户报"控制台切换了字体，部分特殊文字还是显示成口"）：
 * 宿主那份清单来自操作系统，而**系统列出的族名 ≠ 浏览器能匹配的族名**。本机实测 309 个名字里
 * 有 63 个匹配不上，其中恰好包括"为了修口最会去挑的那几个" ——
 *   · **系统保留字体**：`Apple Color Emoji` / `Symbol` / `Zapf Dingbats` / `Apple Braille` /
 *     `GB18030 Bitmap`，以及阿拉伯 / 希伯来 / 天城文那些（macOS 不让应用按族名取它们，
 *     但 `system_profiler` 照样列）；
 *   · **同一字体的另一种写法**：`苹方-繁` / `苤方-港` / `黑体-繁` …（规范名 `PingFang TC` 能匹配）。
 * 把它们摆在"可选字体"里是**界面在撒谎**：用户选了、看着没反应，只会以为功能坏了。
 *
 * 手法（不依赖任何字体度量假设）：同一个名字分别配 `monospace` 与 `serif` 量**同一段拉丁文字** ——
 * 名字生效时两次都用它（宽度必然相同）；名字不生效时一次走 monospace、一次走 serif（宽度不同）。
 * 一次布局量完所有名字（每个两个 span，读完宽度再统一取走）—— 逐个
 * `getBoundingClientRect()` 会强制 309 次同步布局。
 *
 * 退化是**刻意**的：量不到（没有 document / 没有布局 / 宽度为 0 —— 守卫的替身 DOM 就是这种）
 * 就**原样返回**，绝不因为"测不出来"把用户的字体名丢掉。
 */
function probeUsableFamilies(doc, list) {
  const none = { fonts: list, skipped: 0, measured: false };
  if (!doc || typeof doc.createElement !== 'function') return none;
  try {
    const host = doc.body || doc.documentElement;
    if (!host || typeof host.appendChild !== 'function') return none;
    const box = doc.createElement('div');
    box.style.position = 'absolute';
    box.style.left = '-99999px';
    box.style.top = '0';
    box.style.visibility = 'hidden';   // 仍然参与布局（`display:none` 量不出宽度）
    box.style.whiteSpace = 'pre';
    box.style.fontSize = '32px';
    const rows = [];
    for (const name of list) {
      const a = doc.createElement('span');
      a.style.fontFamily = '"' + name + '", monospace';
      a.textContent = FONT_PROBE_TEXT;
      const b = doc.createElement('span');
      b.style.fontFamily = '"' + name + '", serif';
      b.textContent = FONT_PROBE_TEXT;
      box.appendChild(a);
      box.appendChild(b);
      rows.push([name, a, b]);
    }
    host.appendChild(box);
    const fonts = [];
    let skipped = 0;
    let measured = false;
    for (const [name, a, b] of rows) {
      const wa = a.getBoundingClientRect ? a.getBoundingClientRect().width : 0;
      const wb = b.getBoundingClientRect ? b.getBoundingClientRect().width : 0;
      if (!(wa > 0) || !(wb > 0)) { fonts.push(name); continue; } // 量不到 ⇒ 不筛
      measured = true;
      if (Math.abs(wa - wb) < 0.01) fonts.push(name); else skipped++;
    }
    if (typeof box.remove === 'function') box.remove();
    else if (typeof host.removeChild === 'function') host.removeChild(box);
    return { fonts, skipped, measured };
  } catch {
    return none;
  }
}

/**
 * 清单 → 只留**本浏览器能匹配**的名字（按数组**身份**记忆：清单整体替换时才重量一次）。
 * 调用点：面板渲染（`src/panel-tabs.js` 的 `familyOptions` / `sysFontNote`）—— 那是"用户真的要挑
 * 字体"的时刻，首帧不付这笔测量钱。
 */
function filterUsableSystemFonts(names) {
  const list = Array.isArray(names) ? names : [];
  if (sysFontProbeFor === list) return sysFontProbeResult;
  sysFontProbeResult = probeUsableFamilies(typeof document !== "undefined" ? document : null, list);
  sysFontProbeFor = list;
  return sysFontProbeResult;
}

export {
  readCachedSystemFonts, ensureSystemFonts,
  filterUsableSystemFonts,
};
