import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_HASH = '7073c497cb9d81f28a7e303ef318b0fcb444b91ecb7682e4ccec69a2b3559c5a';
const HOST_HASH = 'fab68075a40c844d996c168f3b3109e00bc6e1cd1b7a16e2dd6e1ed1e20ab903';
export const PET_NAMES = Object.freeze([
  '通用-右侧螃蟹步-dshwe', '通用-左侧螃蟹步-dshwe',
  '侧边栏-蓄力准备往后拉-dshwe', '侧边栏-后拉接疲态结束-dshwe',
  '吉祥物-跳抓眩晕落地起身-dshwe', '彩蛋-侧边栏-半身转向踢腿-dshwe',
  '彩蛋-侧边栏-被弹飞-dshwe', '彩蛋-侧边栏-落地-dshwe', '彩蛋-吉祥物-哈气-dshwe',
]);
const MEMES = ['累瘫鲸鱼的两碗饭', '蓝发鲸尾女仆拒绝换壁纸', '暴怒鲸尾女仆贴纸', '吓哭了', '？！欺负一只肥鱼！？'];
const hashes = new Map();
function fileHash(path) {
  const stat = statSync(path, { bigint: true });
  if (!stat.isFile()) throw new Error('不是文件');
  const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const cached = hashes.get(path);
  if (cached && cached.key === key) return cached.hash;
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hashes.size > 128) hashes.clear();
  hashes.set(path, { key, hash });
  return hash;
}

/** 安装记录不授予运行资格；这里只校验已准备的代码与全套资源。 */
export function checkPetPrepared(home, profile) {
  const data = join(home, 'dsh-pet');
  const pkg = join(profile, 'node_modules/dsh-pet');
  try {
    const manifest = JSON.parse(readFileSync(join(data, 'pet-link-install.json'), 'utf8'));
    const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
    if (manifest.protocol !== 1 || manifest.version !== '0.3.6' || version !== '0.3.6')
      return { available: false, reason: '不兼容的桌宠安装协议或版本' };
    if (fileHash(join(pkg, 'lib/client.js')) !== CLIENT_HASH || fileHash(join(pkg, 'lib/index.js')) !== HOST_HASH)
      return { available: false, reason: '桌宠补丁指纹不匹配' };
    const required = [
      ...PET_NAMES.map(name => `main-animation/webm/${name}.webm`),
      ...MEMES.map(name => `memes/${name}.png`),
      'animation-ext/leash-bridge-ext.json',
    ];
    if (!required.every(path => typeof manifest.files?.[path] === 'string' && fileHash(join(data, path)) === manifest.files[path]))
      return { available: false, reason: '桌宠联动资源缺失或已改变' };
    const ext = JSON.parse(readFileSync(join(data, 'animation-ext/leash-bridge-ext.json'), 'utf8'));
    if (ext.target !== 'main' || !PET_NAMES.every(name => ext.animations?.events?.DSHWE?.includes(name)))
      return { available: false, reason: '目标宠物动画池不完整' };
    return { available: true, reason: '' };
  } catch { return { available: false, reason: '未完成受支持版本的完整桥接安装' }; }
}
