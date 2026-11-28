#!/usr/bin/env node
/**
 * verify-resume-repaint.mjs —— 遮挡恢复后的重绘契约（issue #274）。
 *
 * 真机长尾：遮挡恢复后最多 8.4s 看不到画面。根因链：
 *   ① 上一次微推的 `we-layer--repaint` 可能在遮挡期 rAF 停摆时**没收干净**（drop 永不执行）；
 *   ② 微推只给层加 transform，媒体叶子没有任何重新布局/提交；
 *   ③ `onscreen` 诊断只报 VIDEO 的固有尺寸（永远 1920×1080），看不出"层满屏但画面没出"。
 * 本守卫在 mock DOM 上跑**真 `nudgeWallpaperRepaint` 源码**，钉住：
 *   · 先摘类再加（旧残留在也能触发本次微推）；
 *   · 媒体叶子被强制一次布局（内联 object-fit 指定值 + 读几何），两帧后撤回且最终样式复原；
 *   · 帧末类必须摘净；
 *   · `onScreenBrief` 带**实际盒**（box=），能区分几何问题与出帧问题；
 *   · 变异体（去掉摘类 / 去掉叶子面 / 去掉 box）必须让同一判据判红。
 */
import { readFileSync } from 'node:fs';
import { createCheck } from './tools/assert-harness.mjs';

const { check, stats } = createCheck();
const RAW = readFileSync(new URL('../src/wallpaper/layer-core.js', import.meta.url), 'utf8');
const BODY = RAW.replace(/export\s*\{[\s\S]*?\};?/g, ' ');

/** 在 mock DOM 上跑真 nudge/onScreenBrief。 */
function runNudge() {
  const ops = [];
  const classes = new Set();
  classes.add('we-layer--repaint'); // 模拟"上一次微推没收干净"
  const classList = {
    add: (c) => { classes.add(c); ops.push('add:' + c); },
    remove: (c) => { classes.delete(c); ops.push('remove:' + c); },
    contains: (c) => classes.has(c),
  };
  const styleMap = new Map();
  let layoutReads = 0;
  const leaf = {
    tagName: 'VIDEO',
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 4,
    paused: false,
    style: {
      setProperty(k, v) { styleMap.set(k, v); ops.push('set:' + k); },
      getPropertyValue(k) { return styleMap.get(k) || ''; },
      removeProperty(k) { styleMap.delete(k); ops.push('del:' + k); },
    },
    getBoundingClientRect() { layoutReads += 1; return { width: 1280, height: 822, left: 0, top: 0 }; },
  };
  const node = {
    classList,
    querySelector: () => leaf,
    getBoundingClientRect: () => ({ width: 1280, height: 822, left: 0, top: 0 }),
  };
  const raf = [];
  const requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
  const fakeDocument = { getElementById: () => node, hidden: false };
  const getComputedStyle = () => ({ getPropertyValue: () => 'cover' });
  const factory = new Function(
    'LAYER_ID', 'document', 'requestAnimationFrame', 'getComputedStyle', 'mediaFramesOf', 'window',
    BODY + '\nreturn { nudgeWallpaperRepaint, onScreenBrief };');
  const api = factory('dsh-wallpaper-engine-layer', fakeDocument, requestAnimationFrame, getComputedStyle, () => 7, undefined);
  api.nudgeWallpaperRepaint();
  const opsAfterCall = ops.slice();
  for (let guard = 0; guard < 20 && raf.length; guard += 1) { const cb = raf.shift(); cb(); }
  return { ops: opsAfterCall, leaf, layoutReads, classes, styleMap, brief: api.onScreenBrief(node) };
}

// ① 先摘后加（旧残留也能触发本次微推）。
const r = runNudge();
const firstRemove = r.ops.indexOf('remove:we-layer--repaint');
const firstAdd = r.ops.indexOf('add:we-layer--repaint');
check('R1 nudge drops a stale repaint class before adding it again',
  firstRemove >= 0 && firstAdd > firstRemove, JSON.stringify(r.ops.slice(0, 4)));

// ② 叶子被强制一次真实布局，且两帧后内联样式复原。
check('R2 the media leaf gets a forced layout (inline object-fit write) and is restored after two frames',
  r.ops.includes('set:object-fit') && r.layoutReads >= 1 && r.leaf.style.getPropertyValue('object-fit') === ''
    && !r.styleMap.has('object-fit'),
  'ops=' + JSON.stringify(r.ops) + ' layoutReads=' + r.layoutReads);

// ③ 帧末类摘净（行为面）。
check('R3 the repaint class is gone after the rAF frames', !r.classes.has('we-layer--repaint'));

// ④ onscreen 诊断带实际盒。
check('R4 onScreenBrief reports the leaf actual box (box=1280x822@0,0), not only intrinsic size',
  /box=1280x822@0,0/.test(r.brief) && /leaf=VIDEO 1920x1080/.test(r.brief), r.brief);

// ⑤ 静态契约：源码里这三处都在（行为判据的覆盖面；变异体证明判据有牙）。
function sourceViolations(text) {
  const out = [];
  const nudge = /function\s+nudgeWallpaperRepaint\s*\([\s\S]*?\n\}/.exec(text);
  if (!nudge) return ['定位不到 nudgeWallpaperRepaint'];
  const body = nudge[0];
  const iRemove = body.indexOf('classList.remove("we-layer--repaint")');
  const iAdd = body.indexOf('classList.add("we-layer--repaint")');
  if (iRemove < 0 || iAdd < 0 || iRemove > iAdd) out.push('微推没有"先摘类再加"');
  if (!/setProperty\(\s*"object-fit"/.test(body)) out.push('媒体叶子没有被强制一次布局');
  if (!/getBoundingClientRect\(\)/.test(body)) out.push('媒体叶子没有读一次几何');
  if (!/requestAnimationFrame\(\(\) => requestAnimationFrame\(/.test(body)) out.push('没有两帧后撤回');
  if (!/ box=" \+/.test(text)) out.push('onScreenBrief 没有实际盒 box=');
  return out;
}
check('R5 source contract holds (remove-before-add / leaf layout / two-frame restore / box=)',
  sourceViolations(RAW).length === 0, sourceViolations(RAW).join('；'));
check('R6 negative control: removing the stale-class drop is flagged',
  sourceViolations(RAW.replace('classList.remove("we-layer--repaint");', '')).some((v) => /先摘类/.test(v)));
check('R7 negative control: removing the leaf forced layout is flagged',
  sourceViolations(RAW.replaceAll('setProperty("object-fit"', 'setProperty("object-fit-x"')).some((v) => /叶子/.test(v)));
check('R8 negative control: removing box= from the diagnostic is flagged',
  sourceViolations(RAW.replace(' box=" +', ' leafbox=" +')).some((v) => /box=/.test(v)));

if (stats.failed) {
  console.error('RESUME REPAINT CHECKS FAILED — ' + stats.failed + ' failed, ' + stats.passed + ' passed');
  process.exitCode = 1;
} else {
  console.log('ALL RESUME REPAINT CHECKS PASSED (' + stats.passed + ')');
}
