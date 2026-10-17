import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { preparePetClient } from './patch-pet-client.mjs';
import { preparePetHost } from './repatch-pet.mjs';
import { planAssets } from './inject-assets.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const current = path => existsSync(path) ? readFileSync(path) : null;
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);

/** 先准备所有字节，再备份、逐项提交；安装凭据最后写入，失败恢复已提交的原件。 */
export function installBridge({ dshHome, packageRoot, assetsRoot, check = false, afterWrite } = {}) {
  const home = resolve(dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'));
  const pkg = resolve(packageRoot || join(process.env.DSH_PROFILE_DIR || join(home, 'profiles/desktop'), 'node_modules/dsh-pet'));
  const data = join(home, 'dsh-pet');
  // 此处均为只读：未知构建、缺资源和同名冲突在创建备份之前失败。
  const client = preparePetClient({ packageRoot: pkg });
  const host = preparePetHost({ packageRoot: pkg });
  const assets = planAssets({ dshHome: home, assetsRoot, requireComplete: true });
  const manifest = { protocol: 1, version: '0.3.6', clientHash: client.hash, hostHash: host.hash, files: {} };
  for (const file of assets.files) {
    if (file.kind === 'config') continue;
    manifest.files[relative(data, file.path).replaceAll('\\', '/')] = sha(file.data);
  }
  const files = [
    { path: client.target, data: client.patched },
    { path: host.target, data: host.patched },
    ...assets.files,
    { path: join(data, 'pet-link-install.json'), data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
  ].map(file => ({ ...file, before: current(file.path) }));
  const changes = files.filter(file => !same(file.before, file.data));
  if (check) return { status: changes.length ? 'ready' : 'already-installed', changes: changes.map(file => file.path), manifest };
  if (!changes.length) return { status: 'already-installed', manifest };

  const backup = join(data, 'pet-link-backups', new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomUUID());
  mkdirSync(backup, { recursive: true });
  const record = changes.map((file, i) => ({ path: file.path, existed: file.before !== null,
    beforeHash: file.before === null ? null : sha(file.before), afterHash: sha(file.data), original: `${i}.original` }));
  for (let i = 0; i < changes.length; i++) {
    const file = changes[i];
    if (file.before !== null) writeFileSync(join(backup, `${i}.original`), file.before, { flag: 'wx' });
    writeFileSync(join(backup, `${i}.prepared`), file.data, { flag: 'wx' });
    if (sha(readFileSync(join(backup, `${i}.prepared`))) !== sha(file.data)) throw new Error('暂存校验失败：' + backup);
  }
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ status: 'prepared', files: record }, null, 2) + '\n', { flag: 'wx' });
  const committed = [];
  const atomicWrite = (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true });
    const temp = path + '.pet-link-' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, bytes, { flag: 'wx' });
      if (!readFileSync(temp).equals(bytes)) throw new Error('临时文件写后校验失败：' + temp);
      renameSync(temp, path);
    } finally {
      // 仅清理本次生成的、明确位于目标旁的随机临时文件。
      if (existsSync(temp)) unlinkSync(temp);
    }
  };
  try {
    for (const file of changes) {
      if (!same(current(file.path), file.before)) throw new Error('安装期间目标被其他写入者修改，拒绝覆盖：' + file.path);
      atomicWrite(file.path, file.data);
      committed.push(file);
      if (!readFileSync(file.path).equals(file.data)) throw new Error('安装写后校验失败：' + file.path);
      if (afterWrite) afterWrite(committed.length, file.path);
    }
    for (const file of files) if (!same(current(file.path), file.data)) throw new Error('最终完整性核验失败：' + file.path);
    writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ status: 'installed', files: record }, null, 2) + '\n');
    return { status: 'installed', backup, manifest, changed: changes.map(file => file.path) };
  } catch (cause) {
    const conflicts = [];
    for (const file of committed.reverse()) {
      try {
        if (!same(current(file.path), file.data)) { conflicts.push(file.path); continue; }
        if (file.before !== null) atomicWrite(file.path, file.before);
        else {
          // path 来自固定安装清单，且刚核对内容仍由本次事务持有。
          unlinkSync(file.path);
        }
      } catch (error) { conflicts.push(file.path + ': ' + error.message); }
    }
    writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ status: conflicts.length ? 'rollback-conflict' : 'rolled-back', files: record, conflicts }, null, 2) + '\n');
    const error = new Error('安装失败：' + cause.message + (conflicts.length ? '；回滚冲突，请用备份核对：' : '；已回滚，备份：') + backup, { cause });
    error.backup = backup;
    error.conflicts = conflicts;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = key => { const at = args.indexOf(key); if (at < 0) return undefined;
    if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error('缺少参数值：' + key);
    return args[at + 1]; };
  console.log(JSON.stringify(installBridge({ dshHome: value('--dsh-home'), packageRoot: value('--pet-package'),
    assetsRoot: value('--assets-root'), check: args.includes('--check') }), null, 2));
}
