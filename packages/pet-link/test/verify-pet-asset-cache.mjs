#!/usr/bin/env node
/** 执行真实 switchTo：模拟已缓存旧素材，验证更新后的素材进入视频槽。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as patcher from '../tools/patch-pet-client.mjs';
const input = readFileSync(process.argv[2], 'utf8');
const source = process.argv.includes('--installed') ? input : patcher.applyAssetCacheEdits(input);
const start = source.indexOf('\t\tconst switchTo = (next, nextOnce) => {');
const end = source.indexOf('\n\t\tuseEffect(() => {', start);
assert.ok(start >= 0 && end > start);
async function play(name) {
  const video = { addEventListener() {}, load() {} };
  let request;
  const env = {
    pendingRef: { current: null }, pendingSquashRef: { current: false },
    frontRef: { current: 0 }, genRef: { current: 0 }, linkPlaybackRef: { current: { id: 0, name: '', phase: 'idle' } },
    videoARef: { current: {} }, videoBRef: { current: video },
    petAnims: { events: {} }, isEventAnim: () => false,
    cfg: { id: 'main' }, THUMB_EXT: '.webm',
    inflightRef: { current: [] }, mountedRef: { current: true },
    blobUrlRef: { current: { a: null, b: null } },
    AbortController, window: { setTimeout: () => 1, clearTimeout() {} },
    URL: { createObjectURL: blob => 'blob:' + blob, revokeObjectURL() {} },
    handleEnded() {},
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, blob: async () => options.cache === 'reload' ? 'modified' : 'cached-old' };
    },
  };
  const switchTo = new Function('env', `with (env) { ${source.slice(start, end)}; return switchTo; }`)(env);
  switchTo(name, true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  return { request, video };
}
const modified = await play('吉祥物-跳抓眩晕落地起身-dshwe');
assert.equal(modified.request.options.cache, 'reload', '替换过的跳抓动画必须重新向服务器取素材');
assert.equal(modified.video.src, 'blob:modified', '真实视频槽必须加载新素材');
assert.ok(modified.request.url.endsWith(encodeURIComponent('吉祥物-跳抓眩晕落地起身-dshwe') + '.webm'));
const ordinary = await play('idle');
assert.equal(ordinary.request.options.cache, 'default', '其他动画保持原缓存行为');
assert.equal(ordinary.video.src, 'blob:cached-old');
console.log('PASS 跳抓素材绕过旧缓存并进入真实视频槽，其他动画缓存行为不变');
