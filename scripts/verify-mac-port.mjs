#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const clientSource = read('src/client.js');
const clientBundle = read('lib/client.js');
const hostSource = read('lib/index.js');

function expectPattern(label, source, pattern) {
  assert.ok(pattern.test(source), `${label}: expected ${pattern}`);
  console.log(`PASS | ${label}`);
}

// Upstream v0.6.5 parity: the mac branch must receive the current mascot
// controls and one-time update notice in both source and generated output.
for (const [label, source] of [
  ['client source', clientSource],
  ['generated client bundle', clientBundle],
]) {
  expectPattern(`${label} persists mascot visibility`, source, /ropeShown/);
  expectPattern(`${label} includes mascot forms`, source, /const ROPE_FORMS\s*=/);
  expectPattern(`${label} persists mascot scale`, source, /ropeScale/);
  expectPattern(`${label} includes the update notice`, source, /function UpdateNotice\s*\(/);
}
expectPattern('host sanitizes mascot forms', hostSource, /const ROPE_FORM_VALUES\s*=\s*\['maid', 'whale'\]/);

// macOS invariants: WaifuX and directory-driven discovery must survive every
// upstream merge, including nested steamcmd workshop layouts and loose files.
expectPattern('host defines macOS content roots', hostSource, /const MAC_DEFAULT_CONTENT_DIRS\s*=/);
expectPattern('host scans WaifuX Wallpapers', hostSource, /Application Support', 'WaifuX', 'Wallpapers/);
expectPattern('host scans WaifuX Media', hostSource, /Application Support', 'WaifuX', 'Media/);
expectPattern('host scans nested WaifuX workshop content', hostSource, /const nested = join\(dir, 'steamapps', 'workshop', 'content', WE_APPID\)/);
expectPattern('host accepts loose media files', hostSource, /LOOSE_MEDIA\.test\(entry\)/);
expectPattern('host keeps bounded async scanning', hostSource, /const SCAN_CHUNK = 24/);

for (const [label, source] of [
  ['client source', clientSource],
  ['generated client bundle', clientBundle],
]) {
  expectPattern(`${label} accepts 0.25x playback`, source, /clampNum\(o\.playbackRate, 0\.25, 2/);
  expectPattern(`${label} keeps the free playback slider`, source, /SliderRow\("播放速度", 0\.25, 2, "any"/);
  expectPattern(`${label} passes current.media to vinyl fallback`, source, /current\s*&&\s*current\.media/);
  expectPattern(`${label} keeps thumbnail load reveal`, source, /onLoad:\s*\(e\)\s*=>\s*\{\s*e\.target\.style\.opacity\s*=\s*"1"/);
}

// The host persists shared settings. Its clamp must match the mac client's
// 0.25x lower bound or a saved 0.25x–0.49x value silently returns as 0.5x.
expectPattern('host preserves 0.25x playback settings', hostSource, /playbackRate:\s*clampNum\(o\.playbackRate, 0\.25, 2, 1\)/);

console.log('\nALL MAC PORT CHECKS PASSED');
