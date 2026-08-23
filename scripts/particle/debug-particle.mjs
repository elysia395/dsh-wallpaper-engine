import { SceneRenderer, parseVec3 } from '../lib/scene-renderer.js';

console.log('parseVec3("-37 -90 0"):', parseVec3('-37 -90 0'));
console.log('parseVec3("200 1400 0"):', parseVec3('200 1400 0'));
console.log('parseVec3("95 98 100"):', parseVec3('95 98 100'));
const r = new SceneRenderer('c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg', { width: 3840, height: 2160, time: 3, log: () => {} });
const o = r.objects.find(x => x.name === '沙砾');
const def = r.pkg.readJson(o.particle);
const init = def.initializer.find(i => i.name === 'velocityrandom');
console.log('velocity min raw:', JSON.stringify(init.min), 'max:', JSON.stringify(init.max));
const sys = r._buildParticleSystem(o, def);
// 手动 spawn 一个
const p0 = r._spawnParticle(sys, sys.emitters[0]);
console.log('spawn 后 pos:', p0.pos, 'size:', p0.size);
// 模拟
r._simulateParticleSystem(sys, 3);
console.log('粒子数:', sys.particles.length);
if (sys.particles.length) {
  const p = sys.particles[0];
  console.log('p0 pos:', p.pos, 'vel:', p.vel, 'life:', p.life, 'size:', p.size);
}
