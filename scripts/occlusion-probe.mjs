#!/usr/bin/env node
/**
 * occlusion-probe.mjs — 遮挡生产端**实机探针**：真连 X11，把 hub 快照打到终端。
 *
 * 用途（人工 QA，规格 §8.5 的第一步）：在插件实例之外直接看「现在算出什么」——
 *   · 拖一个窗口盖住壁纸候选区 ⇒ `rects` 应实时变化（事件触发，不等下一跳）；
 *   · 最小化所有窗口 ⇒ `rects` 应只剩自身全屏外的少量残留或空；
 *   · 在 Wayland 会话下跑 ⇒ 应立即打印 not-candidate 并保持 backend=none。
 * 与 `test/verify-occlusion-hub.mjs` 的分工：那个守"契约不变"，这个答"这台机器
 * 现在算得对不对"。退出：Ctrl-C（dispose 走 process exit 钩子）。
 *
 * Usage:  DISPLAY=:1 node scripts/occlusion-probe.mjs [--interval-ms 1000]
 */

import process from 'node:process';
import { createOcclusionHub } from '../lib/occlusion/index.js';

const intervalIdx = process.argv.indexOf('--interval-ms');
const pollMs = intervalIdx !== -1 ? Number(process.argv[intervalIdx + 1]) || 1000 : 1000;
// --own-pid <pid>：把指定进程的窗口当作"自家窗"（探针进程不拥有 X 窗口，真实实例
// 不需要此参数 —— 宿主 pid 天然等于 Electron 主进程）。
const ownPidIdx = process.argv.indexOf('--own-pid');
const ownPid = ownPidIdx !== -1 ? Number(process.argv[ownPidIdx + 1]) : undefined;

/**
 * 日志回调。hub 的 `log` 形参**只从默认值 `= () => {}` 推出类型 `() => void`**
 * （`lib/occlusion/index.js:37`），但实现恒以 `log(msg)` 调用（同文件 `:64`）⇒ 把 msg 写成
 * 必填参数会被 tsc 判 TS2322（"Target signature provides too few arguments"）。
 * 这里把参数写成**可选**：声明契约（允许零参调用）与真实调用（总会传 msg）两边都成立；
 * 行为与原来逐字一致（零参时原本也打印 `# undefined`）。lib 侧那处过窄的形参类型见报告。
 * @param {string} [msg]
 */
const probeLog = (msg) => console.log(`# ${msg}`);

const hub = createOcclusionHub({
  log: probeLog,
  pollMs,
  ...(ownPid ? { ownPid } : {}),
});

process.on('SIGINT', () => {
  hub.dispose();
  process.exit(0);
});

await hub.start();
console.log('# occlusion-probe: Ctrl-C 退出；拖窗遮挡观察 rects 变化');
let last = '';
setInterval(() => {
  const s = hub.getSnapshot();
  const line = JSON.stringify(s);
  if (line === last) return; // 内容没变就别刷屏（ts 变化忽略）
  last = line;
  const secs = Math.round((s.own ? s.own.w * s.own.h : 0) / 1000) / 1000;
  const ratio = s.own && s.rects
    ? `visible≈${Math.max(0, 1 - s.rects.reduce((a, r) => a + r[2] * r[3], 0) / (s.own.w * s.own.h)).toFixed(2)}`
    : 'visible=1';
  console.log(`[${new Date().toISOString().slice(11, 23)}] backend=${s.backend} gen=${s.gen} own=${s.own ? `${s.own.w}x${s.own.h}(${secs}MP)` : 'null'} ${ratio} rects=${JSON.stringify(s.rects)}`);
}, 250);
