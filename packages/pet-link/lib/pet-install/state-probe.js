// state-only 探测：只回答「装没装 / 什么版本 / 在不在跑」，不做任何下载或写盘。
// 2026-11-01 取代原 transaction.js（那套自研下载解包已整体移除：
// 它绕过 DSH 的依赖管理，与本地 link: 布局冲突，曾造成重复注册 / 误判未安装 / 启动崩溃）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNTIME_NAME = 'dshpet-dshwe';
const LEGACY_NAME = 'dsh-pet-dshwe';
const CANDIDATES = [RUNTIME_NAME, LEGACY_NAME];

/**
 * 找已安装副本：在给定 node_modules 下按候选名找目录，读它的 package.json 版本。
 * @param {string} nodeModulesDir - profile 的 node_modules 绝对路径
 * @returns {{installed:boolean,name:string|null,version:string|null,path:string|null}}
 */
function detect(nodeModulesDir) {
  if (!nodeModulesDir || !existsSync(nodeModulesDir)) {
    return { installed: false, name: null, version: null, path: null };
  }
  for (const name of CANDIDATES) {
    const dir = join(nodeModulesDir, name);
    const pkg = join(dir, 'package.json');
    if (!existsSync(pkg)) continue;
    try {
      const json = JSON.parse(readFileSync(pkg, 'utf8'));
      return { installed: true, name, version: typeof json.version === 'string' ? json.version : null, path: dir };
    } catch {
      return { installed: true, name, version: null, path: dir };
    }
  }
  return { installed: false, name: null, version: null, path: null };
}

/**
 * 造一个只读状态提供者，接口与原 installer 的 `state()` 保持兼容
 * （这样路由与 UI 不用改调用方式）。
 * @param {{ profiledNodeModules?: string, runtimeDir?: string }} opts
 * @returns {{ state: () => object }}
 */
export function createStateProbe(opts = {}) {
  const nodeModulesDir = opts.profiledNodeModules || null;
  const runtimeDir = opts.runtimeDir || null;
  return {
    /** 当前安装态：installed / version / name / path / runtimePresent。纯读，无副作用。 */
    state() {
      const found = detect(nodeModulesDir);
      let runtimePresent = false;
      try {
        runtimePresent = Boolean(runtimeDir && existsSync(runtimeDir) && readdirSync(runtimeDir).length > 0);
      } catch {
        runtimePresent = false;
      }
      return {
        installed: found.installed,
        version: found.version,
        name: found.name,
        path: found.path,
        runtimePresent,
        // UI 需要的官方安装入口（不再由本插件代下载）
        installUrl: 'https://www.npmjs.com/package/dshpet-dshwe',
        installCommand: 'dsh plugin add dshpet-dshwe',
      };
    },
  };
}

export { RUNTIME_NAME, LEGACY_NAME, CANDIDATES, detect };