/**
 * multi-source-mutants.mjs —— **多源变异体加载器**（守卫共用的基础设施）。
 *
 * 为什么要有它：本仓的负对照主流形态是"把**被测源码文本**里的某个锚点改坏，落盘后再 import"，
 * 以证明判据真的会红。当一个被测能力在活侧**分居多个模块**时（例如资产路径族分居
 * `lib/upload-dir.js` / `lib/media/media-dirs.js` / `lib/we-assets.js`），变异体必须：
 *   · 知道每条编辑该打在**哪个源**上（否则会改错文件、或改了半天没改到）；
 *   · 在**该源**的文本里做字面替换，并**自检命中**（锚点落空即抛 —— "锚点落空 ⇒ 变异体 = 原版
 *     ⇒ 负对照假绿"是本仓被咬过多次的形态）；
 *   · 落盘后仍能被 import：源码先归一成 LF（锚点写的是 `\n`，CRLF 检出会全不命中）、
 *     相对说明符改写成绝对 `file:` URL（变异体住 `.test-cache/`，`../x.js` 相对它会解析失败）。
 * 这三件事此前在各守卫里各抄一份（`verify-config-store` / `verify-host-diag` 各自处理过 EOL，
 * `verify-asset-paths` 从单源改成多源）。抽到这里之后，**同一套语义**服务所有守卫。
 *
 * 用法：
 * ```js
 * import { makeMultiSourceMutants } from './tools/multi-source-mutants.mjs';
 * const { loadMutant, mutantCount } = makeMultiSourceMutants({
 *   sources: { uploadDir: join(ROOT, 'lib', 'upload-dir.js'), … },   // 源键 → 文件
 *   factories: { uploadDir: 'createUploadDirResolution', … },        // 源键 → 该模块的工厂导出名
 *   outDir: join(ROOT, '.test-cache', 'my-guard', 'mutants'),
 * });
 * const mods = await loadMutant('label', [['uploadDir', find, replace], …]);
 * // ⇒ { uploadDir: <变异体工厂>, … }（只含被改过的源；未改的源由守卫用真源工厂）
 * ```
 * `loadMutant` 的返回面刻意做成"源键 → 工厂"：调用方把它与真源工厂并起来即可（本仓两个消费者
 * —— `verify-asset-paths` / `verify-cache-prune` —— 都按这个形状装配）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 把源码里的**相对说明符**改写成绝对 `file:` URL（只改"从哪解析"，被 import 的仍是真源模块）。
 * @param {string} baseDir 该源文件所在目录
 * @param {string} text
 */
const absolutizeSpecifiers = (baseDir, text) => text.replace(
  /(from\s*|import\s*\(\s*|require\s*\(\s*)(['"])(\.[^'"]+)\2/g,
  (m, head, q, spec) => head + q + pathToFileURL(join(baseDir, spec)).href + q);

/**
 * 建一个多源变异体加载器。
 *
 * @param {object} cfg
 * @param {Record<string, string>} cfg.sources    源键 → 绝对路径
 * @param {Record<string, string>} cfg.factories  源键 → 该模块要取的工厂导出名
 * @param {string} cfg.outDir                     变异体落盘目录（`mkdirSync recursive`）
 * @returns {{ loadMutant: (label: string, edits: Array<[string, string, string]>) => Promise<Record<string, Function>>, mutantCount: () => number }}
 */
export function makeMultiSourceMutants({ sources, factories, outDir }) {
  for (const [key, name] of Object.entries(factories)) {
    if (!sources[key]) throw new Error(`multi-source-mutants: factories 里的源键没有对应的 sources：${key}`);
    if (typeof name !== 'string' || !name) throw new Error(`multi-source-mutants: ${key} 的工厂导出名非法：${JSON.stringify(name)}`);
  }
  const textCache = new Map();     // 源键 → 归一化后的原始文本（同一次 loadMutant 内复用）
  const original = (key) => {
    if (!textCache.has(key)) {
      textCache.set(key, readFileSync(sources[key], 'utf8').replace(/\r\n/g, '\n'));
    }
    return textCache.get(key);
  };
  let seq = 0;

  /**
   * @param {string} label 变异体标签（进文件名与报错）
   * @param {Array<[string, string, string]>} edits `[源键, find, replace]`
   * @returns {Promise<Record<string, Function>>} 源键 → 变异体工厂
   */
  async function loadMutant(label, edits) {
    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error(`变异体 ${label} 没有给出任何编辑（判据会失真）`);
    }
    // 先按源聚合，再逐条替换：同一次 loadMutant 里对同一源的多次编辑**顺序叠加**。
    const pending = new Map();
    for (const [key, find, replace] of edits) {
      if (!sources[key]) throw new Error(`变异体 ${label} 用了未知的源键：${key}`);
      if (typeof find !== 'string' || !find) throw new Error(`变异体 ${label} 在 ${key} 上的 find 非法`);
      if (typeof replace !== 'string') throw new Error(`变异体 ${label} 在 ${key} 上的 replace 非法`);
      if (find === replace) throw new Error(`变异体 ${label} 在 ${key} 上的编辑是空转（find === replace）`);
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push([find, replace]);
    }
    const mods = {};
    for (const [key, list] of pending) {
      let text = original(key);
      for (const [find, replace] of list) {
        if (!text.includes(find)) {
          throw new Error(`变异体 ${label} 的锚点在 ${key} 里没命中：${JSON.stringify(find.slice(0, 90))} —— 源码变了就同步改锚点`);
        }
        text = text.replace(find, () => replace);
      }
      mkdirSync(outDir, { recursive: true });
      seq += 1;
      const file = join(outDir, `${seq}-${key}-${label}.mjs`);
      writeFileSync(file, absolutizeSpecifiers(dirname(sources[key]), text));
      const mod = await import(pathToFileURL(file).href);
      const factory = mod[factories[key]];
      if (typeof factory !== 'function') {
        throw new Error(`变异体 ${label} 的 ${key} 模块里取不到工厂导出 ${factories[key]}（导出名写错或源码变了）`);
      }
      mods[key] = factory;
    }
    return mods;
  }

  return { loadMutant, mutantCount: () => seq };
}
