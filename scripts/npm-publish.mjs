#!/usr/bin/env node
// Assemble + publish the macOS fork as its own npm package
// (dsh-plugin-wallpaper-engine-mac), so market/npm users get updates
// directly from this fork instead of the upstream Windows package.
// The upstream package name (dsh-plugin-wallpaper-engine) stays untouched
// in this repo — the local DSH profile binds to it via link:.
// Usage: node scripts/npm-publish.mjs [--dry-run]
import { readFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const out = new URL('.npm/', import.meta.url).pathname;

rmSync(out, { recursive: true, force: true });
mkdirSync(out + 'lib', { recursive: true });
cpSync(root + 'lib', out + 'lib', { recursive: true });
for (const f of ['cordis.patch.yml', 'README.md', 'README.zh.md']) {
  cpSync(root + f, out + f);
}

const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
writeFileSync(out + 'package.json', JSON.stringify({
  name: 'dsh-plugin-wallpaper-engine-mac',
  version: pkg.version,
  description: 'macOS-enhanced fork of dsh-plugin-wallpaper-engine: WaifuX + loose-media support on top of the original Windows Wallpaper Engine implementation by elysia395.',
  type: 'module',
  main: 'lib/index.js',
  repository: { type: 'git', url: 'git+https://github.com/ruijiaang-lab/dsh-wallpaper-engine.git' },
  keywords: pkg.keywords,
  publishConfig: pkg.publishConfig,
  exports: pkg.exports,
  files: pkg.files,
  dsh: pkg.dsh,
  peerDependencies: pkg.peerDependencies,
  peerDependenciesMeta: pkg.peerDependenciesMeta,
  license: pkg.license,
}, null, 2) + '\n');

execSync(`npm publish ${out} ${process.argv.includes('--dry-run') ? '--dry-run' : ''}`, { stdio: 'inherit' });
