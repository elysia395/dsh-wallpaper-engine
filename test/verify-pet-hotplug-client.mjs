import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performerFixture } from './tools/official-performer.mjs';

const source = readFileSync(new URL('../packages/pet-link/src/official-pet.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../packages/pet-link/src/pet-link-performer.js', import.meta.url), 'utf8');
const create = new Function(source + ';return createOfficialPetPerformer;')();
const fixture = options => performerFixture({ ...options, create });
const h = fixture();
assert.equal(await h.api.warmup(), true);
h.service(false);
assert.equal(await h.api.warmup(), false);
const before = h.calls.length;
await h.api.mascot.tap();
assert.equal(h.calls.slice(before).filter(call => call.op === 'start').length, 0);
assert.ok(h.calls.some(call => call.sidebar === 'toggle'));
h.service(true);
assert.equal(await h.api.warmup(), true, '官方服务重新装载后可恢复');
await h.api.tuner.run('egg2');
h.api.dispose();
assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.nodes.length, 0);

let release;
let held = false;
const gate = new Promise(resolve => { release = resolve; });
const race = fixture({ wait: async () => { if (!held) { held = true; await gate; } } });
const old = race.api.tuner.run('sidebar');
await race.flush();
race.api.tuner.cancel();
const newer = race.api.tuner.run('egg2');
release();
await old;
const result = await newer;
assert.equal(result.phase, 'done', '旧排播清理不能终止取消后发起的新运行');
race.api.dispose();
assert.equal(race.timers.size, 0); assert.equal(race.frames.size, 0);
let positions = 0;
const failedReturn = fixture({ request: async input => {
  if (input.action?.kind === 'position' && ++positions === 2) return { ok: false, reason: 'lock-lost' };
} });
assert.equal((await failedReturn.api.tuner.run('sidebar')).phase, 'cancelled');
assert.ok(failedReturn.calls.some(call => call.sidebar === 'open'));
assert.equal(failedReturn.calls.some(call => call.sidebar === 'toggle'), false, '侧栏已打开，回程失败不能再次 toggle 把它关闭');
failedReturn.api.dispose();
console.log('PASS 官方热插拔：失效无写入、重新恢复、旧 finally 不伤新运行、无计时器残留');
