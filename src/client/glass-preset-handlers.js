/**
 * glass-preset-handlers.js — 玻璃预设的接线（渲染器只读 ctx、动作经 on*），从 `src/client.js`
 * 按族搬出，函数体逐字未改；store 与失败语义仍住 src/preset-store.js。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / busy / armConfirm / saveGlassPreset
 *      等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 3316–3540 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '3316,3540p'，与本文件去掉本头注释后 diff）。
 *   3) 本文件只有函数声明、无顶层状态：不读正文的 const、不挂监听 ⇒ 内联到顶部不撞 TDZ。
 *   4) 导出预设那条路会在 `document.body` 上挂一次性 <a>（宿主附件应答）：它是**下载锚点**，
 *      在 verify-layer-ownership 的 body 挂载白名单里单列为本文件的 1 处，与壁纸层无关。
 */
// ── 玻璃预设的接线（渲染器只读 ctx、动作经 on*；store 与失败语义见 src/preset-store.js）──
// 与 fontSetCtx 同形：清单/错误是宿主投影，busy 是在途标记，删除走 armConfirm 两步确认。
// 应用预设会**整机快照覆盖**（settings 段 + 勾选的资产段）⇒ 动作前先清掉挂着的删除确认
//（上下文切换必清，同字体集）。
/**
 * 保存对话框的**资产可用位 + 默认勾**（ADR-0011 D4，三态）：
 *   · 默认勾：字体 ✅ / 吉祥物 ✅ / 头像 ❌（头像体积翻倍、与"分享一份外观配置"关系最弱）；
 *   · available = 本机现在**有**那份资产 —— **只决定提示文案**（勾上是"带过去"还是"声明无"），
 *     **不再禁用开关、也不再把勾选钳成 false**（那样用户就没法声明"这一族是无"）：
 *     字体段的可带判据 = 活动字体集至少改过一个颜色角色（全默认的字体集没有个性）；
 *     吉祥物 = selection.mascotImage 非空；头像 = 两张任一非空。
 * 纯函数、零副作用：调用点（打开保存对话框时）把产物经 setTransient 存进 glassPresetAssetChecks。
 */
function presetAssetChecksNow() {
  const fontValues = (() => {
    const out = {};
    for (const key of FONTSET_KEYS) out[key] = selection[key];
    return sanitizeFontset(out);
  })();
  const fontAvailable = Boolean(fontValues.themeColors
    && typeof fontValues.themeColors === "object"
    && Object.keys(fontValues.themeColors).length > 0);
  const mascotAvailable = Boolean(selection.mascotImage);
  const avatarAvailable = Boolean(selection.avatarUserImage || selection.avatarAiImage);
  const prev = (selection.glassPresetAssetChecks && typeof selection.glassPresetAssetChecks === "object")
    ? selection.glassPresetAssetChecks : {};
  return {
    // 用户上一轮的勾选保留（重开对话框不丢他的选择）；available 位每次现算，**只决定提示文案**。
    // ⚠️ 勾选**不再**被 available 钳住：勾上 = "按本机现状声明这一族" —— 本机没有
    //    图 ⇒ 宿主落 `null`（**显式声明「无」**，套用它的人回到内置），这是用户有权做的声明；
    //    不勾 = 不动对方。**别把勾选钳成 false 或禁用行**：那会让用户自存预设永远无法声明「无」。
    font: prev.font !== false,
    mascot: prev.mascot !== false,
    avatar: prev.avatar === true,
    // 吉祥物族的**指向**（第四态）：`""` = 按本机现状，形态值 = 这一族只存"指向出厂自带的那一只"。
    // 与勾选同款：保留上一轮的选择（重开对话框不丢），值域由宿主再判一次（认不清就丢）。
    mascotPoint: typeof prev.mascotPoint === "string" ? prev.mascotPoint : "",
    fontAvailable,
    mascotAvailable,
    avatarAvailable,
  };
}

function glassPresetCtx() {
  const done = () => { setTransient("glassPresetBusy", false); emit(); };
  const busy = (promise) => { setTransient("glassPresetBusy", true); emit(); promise.then(done, done); };
  // 待确认的动作（应用 / 真保存 / 导入 / 删除）共用 busy；错误行由 store 内部的
  // setPresetError 收口。
  return {
    presets: selection.glassPresets,
    loading: selection.glassPresetBusy === true,
    error: selection.glassPresetError,
    note: selection.glassPresetNote,
    saving: selection.glassPresetSaving === true,
    // 对话框用途："save"（存进预设栏）/ "export"（导出为文件）/ ""（关着）。
    // 渲染器据此画名字行 + 勾选 +「保存预设」，或只画勾选 +「下载 .json」。
    saveTarget: selection.glassPresetSaveTarget,
    // 导出的目标预设 id（对话框里那个下拉的当前值）。与 saveTarget 同住一个瞬态字段组：
    // 保存用 ""，导出用"选中的那一份"。
    exportTargetId: selection.glassPresetTargetId,
    draftName: selection.glassPresetDraftName,
    armedId: armedIdOf("gpreset"),
    assetChecks: selection.glassPresetAssetChecks,
    // 勾选/取消只改视图态 —— 真正的名单在「保存预设」那一下才交给 store。
    onAssetToggle: (kind, on) => {
      const next = Object.assign({}, selection.glassPresetAssetChecks);
      next[kind] = on === true;
      setTransient("glassPresetAssetChecks", next);
      emit();
    },
    // 吉祥物族的**指向**（第四态）：`""` = 按本机现状；形态值 = "这一段只存指向出厂自带的那一只"。
    // 与勾选同住 glassPresetAssetChecks（内存 UI 瞬态，不进 settings schema）；值域外的值一律折成 ""。
    onMascotPoint: (value) => {
      const next = Object.assign({}, selection.glassPresetAssetChecks);
      next.mascotPoint = ROPE_FORM_VALUES.includes(value) ? value : "";
      setTransient("glassPresetAssetChecks", next);
      emit();
    },
    // #219 首次应用的引导：**只在"清单已加载 + 还没存过自己的预设 + 没点过不再提示"**
    // 三条同时成立时拦一次。自动路径（firstRunAdopt 直接调 applyPreset）不经过这里，
    // 所以首装自动采用不受影响。
    guideTargetId: selection.glassPresetGuideTargetId,
    hiddenBuiltin: selection.glassPresetHidden,
    onApply: (id) => {
      disarmConfirm();
      const rows = Array.isArray(selection.glassPresets) ? selection.glassPresets : [];
      // 清单没加载成功 ⇒ 判不了就不拦（应用本身马上会把宿主错误给出来）。
      const neverSaved = selection.glassPresetsLoaded === true
        && selection.presetGuideDismissed !== "1"
        && !rows.some((r) => r && r.origin === "user");
      if (neverSaved) {
        setTransient("glassPresetGuideTargetId", id);
        emit();
        return;
      }
      setTransient("glassPresetGuideTargetId", "");
      busy(applyPreset(id));
    },
    // 引导里的「先存一份再继续」：数据层直调 saveGlassPreset（不弹对话框），
    // 保存成功才应用原目标；保存失败留在引导行（用户仍可「仍然应用」）。
    onGuideSaveAndApply: () => {
      const target = selection.glassPresetGuideTargetId;
      const checks = presetAssetChecksNow();
      const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
      const stamp = new Date().toLocaleString();
      setTransient("glassPresetAssetChecks", checks);
      setTransient("glassPresetGuideTargetId", "");
      emit();
      busy(saveGlassPreset(weT("当前配置 {time}", { time: stamp }), embeds).then((savedId) => {
        if (savedId && target) return applyPreset(target);
        if (!savedId && target) {
          setTransient("glassPresetGuideTargetId", target);
          emit();
        }
        return false;
      }));
    },
    onGuideApplyAnyway: () => {
      const target = selection.glassPresetGuideTargetId;
      setTransient("glassPresetGuideTargetId", "");
      emit();
      if (target) busy(applyPreset(target));
    },
    // 「不再提示」= 永久关掉引导（设置键，宿主文件、与端口无关），并照常应用 ——
    // 用户点的是应用，不该被这个确认取消掉。
    onGuideDismiss: () => {
      setSetting("presetGuideDismissed", "1");
      const target = selection.glassPresetGuideTargetId;
      setTransient("glassPresetGuideTargetId", "");
      emit();
      if (target) busy(applyPreset(target));
    },
    onRestoreHidden: (id) => { disarmConfirm(); busy(restoreGlassPreset(id)); },
    onOpenSave: () => {
      setTransient("glassPresetSaving", true);
      setTransient("glassPresetSaveTarget", "save");
      setTransient("glassPresetTargetId", "");
      setTransient("glassPresetDraftName", "");
      setTransient("glassPresetError", "");
      setTransient("glassPresetNote", "");
      // 可用位在打开对话框那一刻现算（字体集/立绘/头像可能刚被改过）。
      setTransient("glassPresetAssetChecks", presetAssetChecksNow());
      disarmConfirm();
      emit();
    },
    // 导出（ADR-0011 D7 + 用户口径）：入口**独立成一行**（网格下方与
    // 保存 / 导入并列），不再逐格挂键 —— 所以这里不再收 id，默认选中清单里
    // **第一份读得出来的**（broken 的没有可导出的正文，宿主对它 422）。
    // 仍是"先弹同一组资产勾选对话框，确认后才发起下载"。
    onOpenExport: () => {
      const first = (Array.isArray(selection.glassPresets) ? selection.glassPresets : [])
        .find((r) => !r.broken);
      setTransient("glassPresetSaving", true);
      setTransient("glassPresetSaveTarget", "export");
      setTransient("glassPresetTargetId", first ? first.id : "");
      setTransient("glassPresetError", "");
      setTransient("glassPresetNote", "");
      // 可用位在这里现算，但**勾选默认重置**成 D4 默认值：导出的对象是"那一份预设"，
      // 不是当前 selection —— 沿用上一轮为"保存"勾过的状态反而容易带错东西。
      // 指向同理重置（导出的是"那一份"，别把上一轮为保存选过的指向带进去）。
      setTransient("glassPresetAssetChecks", Object.assign(presetAssetChecksNow(), { font: true, mascot: true, avatar: false, mascotPoint: "" }));
      disarmConfirm();
      emit();
    },
    // 换"导出哪一份"：只改目标 id。资产勾选与可用位**不动** —— 可用位回答的是
    // "本机现在有没有这份资产"，与选中的是哪一份预设无关。
    onExportTargetChange: (id) => {
      setTransient("glassPresetTargetId", String(id == null ? "" : id));
      emit();
    },
    // 导出的确认步：普通链接导航（宿主带 Content-Disposition: attachment 应答）——
    // 不引入 blob / showSaveFilePicker / window.confirm。勾选名单走 ?assets= 查询参数。
    onExportCommit: () => {
      const id = selection.glassPresetTargetId;
      if (!isGlassPresetId(id)) return;
      const checks = selection.glassPresetAssetChecks || {};
      const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
      // 指向出厂自带（第四态）：走 ?point=mascot:<形态> —— 与内嵌互斥（那一段没有字节可带），
      // 所以有指向时把 `mascot` 从内嵌名单里摘掉（否则宿主会照旧把本机那张图内嵌进去）。
      const point = ROPE_FORM_VALUES.includes(checks.mascotPoint) ? checks.mascotPoint : "";
      setTransient("glassPresetSaving", false);
      setTransient("glassPresetSaveTarget", "");
      setTransient("glassPresetTargetId", "");
      emit();
      const a = document.createElement("a");
      a.href = exportGlassPresetUrl(id, embeds.filter((k) => !(k === "mascot" && point)), point);
      a.download = id + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    onDraftName: (v) => { setTransient("glassPresetDraftName", String(v == null ? "" : v)); emit(); },
    // 对话框第一步的「下一步」/ 名字框里的 Enter：只做最小校验（名字非空 ——
    // 空名字在保存时也会被 store 拦，但提前拦能让错误行贴着输入框出现）。
    onSaveCommit: () => {
      if (!String(selection.glassPresetDraftName || "").trim()) {
        setPresetError(weT("先给预设起个名字"));
        return;
      }
      emit();
    },
    // 对话框第二步的「保存预设」：勾选名单此刻才交给 store（saveGlassPreset 内部会做
    // 资产前置校验 —— 勾了但本机没有的组合给可判定原因）。成功后收起对话框。
    onSaveCommit2: () => {
      const checks = selection.glassPresetAssetChecks || {};
      const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
      busy(saveGlassPreset(selection.glassPresetDraftName, embeds).then((id) => {
        if (id) { setTransient("glassPresetSaving", false); setTransient("glassPresetDraftName", ""); }
        emit(); // 收起输入行的分支写完 store 必须通知（渲染纪律判据）
      }));
    },
    onCancelSave: () => {
      setTransient("glassPresetSaving", false);
      setTransient("glassPresetSaveTarget", "");
      setTransient("glassPresetTargetId", "");
      setTransient("glassPresetDraftName", "");
      emit();
    },
    onArmDelete: (id) => armConfirm("gpreset:" + id),
    onDisarm: () => disarmConfirm(),
    onDelete: (id) => { disarmConfirm(); busy(deleteGlassPreset(id)); },
    // 导出对话框的确认步在上面（onExportCommit —— 普通链接，宿主附件应答）。
    onImportFile: (file) => { disarmConfirm(); busy(importGlassPreset(file)); },
  };
}
