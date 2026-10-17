import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ORIGINAL = 'cbb6edee55b9520b58a42df4981406a913e786d1be461f8ba2cd4d1a6a4b2714';
const PATCHED = 'fab68075a40c844d996c168f3b3109e00bc6e1cd1b7a16e2dd6e1ed1e20ab903';
const hash = data => createHash('sha256').update(data).digest('hex');
/** 仅支持已经复算的 0.3.6 官方构建，未知版本或用户改动拒绝写入。 */
export function preparePetHost({ packageRoot } = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const root = resolve(packageRoot || join(process.env.DSH_PROFILE_DIR || join(dshHome, 'profiles', 'desktop'), 'node_modules', 'dsh-pet'));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== '0.3.6') throw new Error('不支持该版本：' + manifest.version + '；需要先复算上游补丁。');
  const target = join(root, 'lib', 'index.js');
  const original = readFileSync(target);
  if (hash(original) === PATCHED) return { status: 'already-patched', target, original, patched: original, hash: PATCHED };
  if (hash(original) !== ORIGINAL) throw new Error('构建指纹不符，保留现有代码：' + target);
  const replacement = readFileSync(new URL('./patch-data/dsh-pet-0.3.6-index.txt', import.meta.url));
  if (hash(replacement) !== PATCHED) throw new Error('补丁载体指纹不符，拒绝写入。');
  return { status: 'ready', target, original, patched: replacement, hash: PATCHED };
}

export function patchPet({ packageRoot, dryRun = false } = {}) {
  const plan = preparePetHost({ packageRoot });
  const { target, original, patched: replacement } = plan;
  if (plan.status === 'already-patched') return { status: 'already-patched', target };
  if (dryRun) return { status: 'ready', target };
  // 单文件操作；先备份，再写。完全不涉及删除目录或创建 junction。
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(dirname(target), 'pet-link-backups', stamp, 'index.js');
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, original, { flag: 'wx' });
  writeFileSync(target, replacement);
  if (hash(readFileSync(target)) !== PATCHED) throw new Error('补丁写入后校验失败；备份：' + backup);
  return { status: 'patched', target, backup };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--pet-package');
  const result = patchPet({ packageRoot: at >= 0 ? args[at + 1] : undefined, dryRun: args.includes('--check') });
  console.log(JSON.stringify(result, null, 2));
}
