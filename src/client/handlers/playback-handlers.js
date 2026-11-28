/**
 * playback-handlers.js — 播放控制处理器（模块级），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / syncLayers / emitAudio 等自由名
 *      由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 3059–3193 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '3059,3193p'，与本文件去掉本头注释后 diff）。
 *   3) 本文件只有函数声明、**无顶层状态**：不读正文的 const、不挂监听 ⇒ 内联到 bundle 顶部不会撞 TDZ。
 *   4) 滑块档口径留在原地未改：live 档不 emit（回显由控件就地更新），抬手那一次走完整路径；
 *      onVideoVolume 的这一形态在 verify-client ①i 的豁免表里有记录。
 */

// ── 播放控制处理器（模块级）─────────────────────────────────────────────────
// 设置页与快捷播放面板（quick-panel.js，官方侧栏 tab 与低版本抽屉共用）调用**同一份实现**
// （语义唯一真源，不是两份手抄）—— 它们改的也是同一批设置键。
function playbackIsVideoLike(selLike) {
  const isLiveScene = (selLike.type === "scene" || selLike.type === "web") && liveRenderEnabled(selLike);
  return !isLiveScene && (selLike.type === "video"
    || (selLike.type === "scene" && Boolean(selLike.sceneVideo)));
}
// 播放/暂停: 意图 =「播放」但元素并没有真的在播时（被拒 / 解码失败 /
// 被浏览器暂停），点击必须【重试播放】而不是把意图翻成 false —— 否则这个
// 按钮在冻住状态下等于没反应，用户没有可用的「继续」。
function onTogglePlay() {
  if (selection.playing && playbackIsVideoLike(selection) && !selection.videoPlaying) {
    const layer = document.getElementById(LAYER_ID);
    const v = layer && layer.querySelector("video");
    if (v && v.dataset) delete v.dataset.wePlayRefused; // 清掉拒绝标记才能重试
    setTransient("videoError", "");
    emit(); // syncLayers → applyVideoPlayback 会重新 play()
    return;
  }
  setTransient("playing", !selection.playing);
  emit();
}
// 音乐开关：只翻总开关，不动 videoVolume —— 关掉再打开能恢复原音量。
// 例外：**开启时若音量为 0**（默认值），自动提到默认可听音量 —— 否则开关
// 打开了却依然无声，用户把这条读作「音量开/关都不生效」（实测）。
function onToggleAudio() {
  const enabling = selection.videoAudioEnabled === false;
  selection.videoAudioEnabled = enabling;
  if (enabling && clampNum(selection.videoVolume, 0, 1, 0) <= 0) {
    selection.videoVolume = DEFAULT_AUDIO_VOLUME;
  }
  const layer = document.getElementById(LAYER_ID);
  const v = layer && layer.querySelector("video");
  if (v) weApplyAudio(v);
  syncSceneAudio(selection);
  if (sceneAudioEl && selection.videoAudioEnabled !== false && weAudioVolume() > 0) {
    const p = sceneAudioEl.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
  }
  persistSelection();
  emit();
}
// 音量滑块（0–100%）：视频 / 场景内嵌 MP4 / 场景包内音频共用同一 videoVolume。
// 拖动档（live）照样即时改音量（听得见），只是不 emit —— 见 commitLiveSetting。
function onVideoVolume(pct, live) {
  selection.videoVolume = clampNum(Number(pct) / 100, 0, 1, 0);
  const layer = document.getElementById(LAYER_ID);
  const vid = layer && layer.querySelector("video");
  if (vid) weApplyAudio(vid);
  syncSceneAudio(selection);
  if (sceneAudioEl && selection.videoAudioEnabled !== false && weAudioVolume() > 0) {
    const p = sceneAudioEl.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
  }
  persistSelection();
  if (!live) emit();
}
function onClear() {
  // 清掉壁纸 = 这张的属性面板也失去对象：顺手把「壁纸属性」收起来。不收的话开关会
  // 「挂着」，下次随便选一张带属性的壁纸时面板会**自动弹开**（用户没点过它）。
  propsPanelOpen = false;
  applySelection("");
}
// 手动点开一张壁纸 = 明确想看它：作废它的 live 失败记忆（sceneLiveFailures，持久
// 降级），让实时渲染重试一次（真失败会自动回退并重新记账）。没有这条路时，一张
// 「某次首帧超时」的壁纸会被**永久**降级到无音频桥形态 —— 音频驱动的壁纸（如
// 音域回响）就此黑屏且用户无路可走（实测）。只清手动路径：轮换提交不清。
function clearLiveFailure(id) {
  const k = String(id || "");
  const m = selection.sceneLiveFailures;
  if (!k || !m || !m[k]) return;
  const next = Object.assign({}, m);
  delete next[k];
  setSetting("sceneLiveFailures", next);
}
function onGroupChange(e) {
  // 换列表 ⇒ 清掉待确认（不变量 3）：否则"删除「A」？"会跟着新选中的 B 一起显示。
  disarmConfirm();
  const nextGroupId = e.target.value;
  selection.rotationGroupId = nextGroupId;
  // 选「— 选择轮播列表 —」（空值）= 不轮播：停在当前壁纸、停掉轮转、取消进行中的准备，
  // **不切图**。原来空值也会走下面的 applySelection(候选第一张)，而空列表时 candidates 退化成
  // "全部可播放" ⇒ 一选空就被当成"换了一组"，壁纸当场被换掉。
  if (!nextGroupId) {
    selection.rotationEnabled = false;
    cancelRotationPrepare();
    persistSelection();
    syncRotationTimer();
    emit();
    return;
  }
  if (selection.rotationEnabled) {
    const first = rotationCandidates()[0];
    if (first) applySelection(first.id);
    else applySelection("");
    return;
  }
  persistSelection();
  syncRotationTimer();
  emit();
}
function onToggleRotation() {
  selection.rotationEnabled = !selection.rotationEnabled;
  // 关闭轮换：进行中的准备（staging/探测元素）一并取消，不再落实切换。
  if (!selection.rotationEnabled) cancelRotationPrepare();
  if (selection.rotationEnabled) {
    if (!selection.rotationGroupId) {
      const usable = firstUsableGroup();
      if (usable) selection.rotationGroupId = usable.id;
    }
    if (!rotationCandidates().some((w) => w.id === selection.id)) {
      const first = rotationCandidates()[0];
      if (first) {
        applySelection(first.id);
        return;
      }
    }
  }
  persistSelection();
  syncRotationTimer();
  emit();
}
// 「下一张」（快捷面板）：轮播开着按活动列表推进、关着按可播放网格推进；
// 锚点是【实际显示】的那张（与轮换同一锚点判定，避免 A→B→A 乒乓）。
function onNextWallpaper() {
  const list = selection.rotationEnabled ? rotationCandidates() : rotationPoolAll();
  if (list.length < 2) return;
  const anchor = rotationAnchorWallpaper();
  const anchorId = anchor ? anchor.id : selection.id;
  const cur = list.findIndex((w) => w.id === anchorId);
  const next = list[(cur + 1 + list.length) % list.length];
  if (next && next.id !== anchorId) applySelection(next.id, { fromManual: true });
}

