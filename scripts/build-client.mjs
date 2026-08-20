/**
 * build-client.mjs — minimal build for the browser half.
 *
 * Reproduces the exact artifact shape the DSH client module loader consumes,
 * the same shape `tsdown` emits for in-box client packages:
 *
 *     window.__ModuleLoader__.load({
 *       id: "<package-name>",
 *       factory: (require) => {
 *         var module = { exports: {} };
 *         var exports = module.exports;
 *         Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
 *         <src/client.js body, indent-normalized>
 *         return module.exports;
 *       }
 *     });
 *
 * The body must end I. `return module.exports` (it does). This script is a
 * deterministic, dependency-free stand-in for `tsdown bundle`: it produces the
 * same single-file `window.__ModuleLoader__.load(...)` envelope without a
 * bundler, which keeps the out-of-tree package buildable with plain Node.
 *
 * Usage:  node scripts/build-client.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const id = pkg.name;

// The stylesheet lives in src/client.css (plain CSS, no bundler needed) and is
// injected into the client source's CSS template literal at build time. The
// source carries a `const CSS = "__DSH_WE_CLIENT_CSS__";` placeholder.
const css = readFileSync(resolve(root, 'src', 'client.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')
  .replace(/\n+$/, '');

const src = readFileSync(resolve(root, 'src', 'client.js'), 'utf8')
  .replace(
    'const CSS = "__DSH_WE_CLIENT_CSS__";',
    'const CSS = `\n' + css + '\n`;',
  );
const body = stripHeader(src).replace(/\r\n/g, '\n').replace(/\n+$/, '');

const outline = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(id)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
];

// Indent the source body by two tabs. Preserve blank-line gaps; never indent
// an already-blank line.
const indented = body
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : '\t\t' + line))
  .join('\n');

outline.push(indented);
outline.push('\t},');
outline.push('});');
outline.push('');

const output = outline.join('\n');

const target = resolve(root, 'lib', 'client.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
console.log(`built ${target} (${output.length} bytes)`);

// Header comments in the source are preserved inside the factory, which is
// harmless, but strip the leading "this is not the artifact / edit src" banner
// so the emitted bundle reads as a compiled artifact.
function stripHeader(srcText) {
  const lines = srcText.split('\n');
  let codeStart = 0;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^\s*\/\*\*/.test(line)) inBlock = true;
    else if (inBlock && /\*\/\s*$/.test(line)) { codeStart = i + 1; break; }
  }
  return lines.slice(codeStart).join('\n');
}
