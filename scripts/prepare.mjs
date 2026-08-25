/**
 * prepare.mjs — npm `prepare` hook.
 *
 * Runs the client build when the source is present (a git checkout / local
 * link), and is a silent no-op otherwise (a published tarball, where `src/` is
 * excluded from `files` and `lib/client.js` is pre-built). This keeps
 * `npm install` working in both contexts without shipping the build inputs in
 * the published package.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasSource = existsSync(resolve(root, 'src', 'client.js')) &&
  existsSync(resolve(root, 'scripts', 'build-client.mjs'));

if (hasSource) {
  const r = spawnSync(process.execPath, [resolve(root, 'scripts', 'build-client.mjs')], {
    cwd: root, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
console.log('prepare: no client source present (published package) — skipped build');
