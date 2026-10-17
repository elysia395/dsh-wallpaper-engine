import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { NAMES, MEMES } from '../tools/inject-assets.mjs';

const module = await import('../tools/install-bridge.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('install-bridge.mjs')) return {};
  throw error;
});
assert.equal(typeof module.installBridge, 'function', '需要完整安装事务入口，而不是部分注入成功');
const { installBridge } = module;
const base = fileURLToPath(new URL('../../../.artifacts', import.meta.url));
const original = resolve(process.argv[2] || join(base, 'hotplug-upstream/package'));
assert.ok(existsSync(join(original, 'lib/client.js')), '须先准备已核验的受支持原版夹具');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(root) {
  const out = {};
  const scan = dir => { if (!existsSync(dir)) return; for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scan(path); else out[relative(root, path)] = hash(readFileSync(path));
  } };
  scan(root); return out;
}
function fixture() {
  const root = mkdtempSync(join(base, 'install-transaction-'));
  const packageRoot = join(root, 'profile/node_modules/dsh-pet');
  mkdirSync(join(packageRoot, 'lib'), { recursive: true });
  for (const file of ['package.json', 'lib/client.js', 'lib/index.js']) {
    writeFileSync(join(packageRoot, file), readFileSync(join(original, file)));
  }
  const dshHome = join(root, 'home');
  mkdirSync(join(dshHome, 'dsh-pet'), { recursive: true });
  writeFileSync(join(dshHome, 'dsh-pet/main-config.jsonc'), '{"userField":{"url":"https://a/b", "literal":"/*保留内容*/"},"memes":{"我的图":"保留描述"}}\n');
  return { root, packageRoot, dshHome };
}
let f = fixture();
const before = snapshot(f.root);
const missing = join(f.root, 'missing-assets');
mkdirSync(missing);
assert.throws(() => installBridge({ ...f, assetsRoot: missing }), /缺少|missing/);
assert.deepEqual(snapshot(f.root), before, '缺资源须在首个目标写入之前拒绝');
console.log('PASS 全部资源缺失时预检拒绝，无部分注入');
f = fixture();
writeFileSync(join(f.packageRoot, 'lib/client.js'), '用户改过的未知构建');
const unknown = snapshot(f.root);
assert.throws(() => installBridge(f), /指纹/);
assert.deepEqual(snapshot(f.root), unknown);
console.log('PASS 未知指纹保持所有文件不动');
f = fixture();
mkdirSync(join(f.dshHome, 'dsh-pet/animation-ext'));
const extPath = join(f.dshHome, 'dsh-pet/animation-ext/leash-bridge-ext.json');
writeFileSync(extPath, '{不是合法 JSON');
const broken = snapshot(f.root);
assert.throws(() => installBridge(f), /扩展|JSON/);
assert.deepEqual(snapshot(f.root), broken);
writeFileSync(extPath, JSON.stringify({ target: 'main', customField: '保留', animations: { events: { userEvent: ['用户动作'], DSHWE: ['用户自建'] } } }));
installBridge(f);
const mergedExt = JSON.parse(readFileSync(extPath));
assert.equal(mergedExt.customField, '保留');
assert.deepEqual(mergedExt.animations.events.userEvent, ['用户动作']);
assert.ok(mergedExt.animations.events.DSHWE.includes('用户自建'));
console.log('PASS 损坏扩展写前拒绝，其他事件和自定义字段保留');
f = fixture();
writeFileSync(join(f.dshHome, 'dsh-pet/main-config.jsonc'), '[]');
const invalidConfig = snapshot(f.root);
assert.throws(() => installBridge(f), /配置|JSON|对象/);
assert.deepEqual(snapshot(f.root), invalidConfig);
console.log('PASS 非对象配置写前拒绝');
f = fixture();
const pristine = snapshot(f.root);
const result = installBridge({ ...f, check: true });
assert.equal(result.status, 'ready');
assert.deepEqual(snapshot(f.root), pristine);
console.log('PASS 完整只读预检不创建备份或目标文件');
for (const failAfter of [1, 2, 5, 16, 18, 19]) {
  f = fixture(); const saved = snapshot(f.root);
  let error;
  try { installBridge({ ...f, afterWrite(index) { if (index === failAfter) throw new Error('模拟中途失败'); } }); }
  catch (e) { error = e; }
  assert.match(String(error), /模拟中途失败/);
  const after = snapshot(f.root);
  for (const [path, sha] of Object.entries(saved)) assert.equal(after[path], sha, '恢复原件 ' + path);
  for (const path of Object.keys(after)) if (!Object.hasOwn(saved, path)) assert.match(path, /pet-link-backups/, '新增资源必须回滚 ' + path);
  assert.ok(error.backup && existsSync(join(error.backup, 'manifest.json')), '失败时保留可核验备份');
}
console.log('PASS 写入中途失败跨客户端、宿主、配置、素材、凭据回滚');
for (const editWritten of [false, true]) {
  f = fixture();
  const client = join(f.packageRoot, 'lib/client.js');
  const host = join(f.packageRoot, 'lib/index.js');
  const originalClient = readFileSync(client);
  const originalHost = readFileSync(host);
  const changed = editWritten ? client : host;
  const foreign = Buffer.from('外部并发编辑必须保留');
  let error;
  try { installBridge({ ...f, afterWrite(index) {
    if (index !== 1) return;
    writeFileSync(changed, foreign);
    if (editWritten) throw new Error('模拟并发后失败');
  } }); } catch (e) { error = e; }
  assert.ok(error && error.backup);
  assert.deepEqual(readFileSync(changed), foreign);
  const report = JSON.parse(readFileSync(join(error.backup, 'manifest.json')));
  assert.equal(report.status, editWritten ? 'rollback-conflict' : 'rolled-back');
  if (!editWritten) assert.deepEqual(readFileSync(client), originalClient);
  else assert.deepEqual(readFileSync(host), originalHost);
  assert.equal(existsSync(join(f.dshHome, 'dsh-pet/pet-link-install.json')), false);
}
console.log('PASS 写后冲突和未写目标并发修改均不覆盖外部内容，失败不发安装凭据');
f = fixture();
const installed = installBridge(f);
assert.equal(installed.status, 'installed');
assert.ok(existsSync(join(installed.backup, 'manifest.json')));
const prepared = JSON.parse(readFileSync(join(f.dshHome, 'dsh-pet/pet-link-install.json')));
assert.equal(prepared.protocol, 1);
assert.equal(prepared.version, '0.3.6');
assert.equal(Object.keys(prepared.files).length, NAMES.length + Object.keys(MEMES).length + 1);
for (const [path, sha] of Object.entries(prepared.files)) assert.equal(hash(readFileSync(join(f.dshHome, 'dsh-pet', path))), sha);
const cfg = JSON.parse(readFileSync(join(f.dshHome, 'dsh-pet/main-config.jsonc')));
assert.deepEqual(cfg.userField, { url: 'https://a/b', literal: '/*保留内容*/' });
assert.equal(cfg.memes['我的图'], '保留描述');
const once = snapshot(f.root);
assert.equal(installBridge(f).status, 'already-installed');
assert.deepEqual(snapshot(f.root), once, '重复安装逐字节幂等且不累积备份');
console.log('PASS 原版完整安装、配置字段保留、写后指纹与重复安装');
console.log(JSON.stringify({ preparedPackage: f.packageRoot, preparedHome: f.dshHome }));
