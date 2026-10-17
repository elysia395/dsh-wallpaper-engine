/**
 * frame-store.js —— 帧缓存与 GPU 抓帧（P0.2-B 存储族）。
 *
 * 来源：从 `lib/index.js` 纯搬移（原 435–534）。三级内容：帧缓存目录（`cacheBaseDir()/frames`）、
 * 静态帧缓存键（`LIVE_FRAME_KEY_VERSION` 前缀 + 场景帧槽位）、GPU 抓帧回填的载荷校验与在途串行化。
 *
 * 形式：整段包进 `createFrameStoreKit(deps)`（工厂包裹 ⇒ 每行 +2 缩进，除此之外逐字未改）。
 * 实例由门面建在**模块作用域**：`sceneProbeKit`（传访问器）与 scene-frame / scene-media 两条
 * 路由族都消费它。
 *
 * deps 契约：
 *   · cacheBaseDir  —— 缓存根解析链（`lib/kernel/data-dir.js` 的 `cacheBaseDir`）
 *   · ensureDirOnce —— 转码套件按路径 memoize 的 mkdir（`lib/media/transcode.js`）
 *
 * 本模块绝不 import `lib/index.js`。
 */
import { join } from 'node:path';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export function createFrameStoreKit({ cacheBaseDir, ensureDirOnce }) {
  /**
   * 帧缓存目录（插件托管，与 config/uploads 同一个数据目录）。这里存三类产物、
   * 各有自己的键前缀：实时抓帧（`<LIVE_FRAME_KEY_VERSION>_…_gpu.png`）、场景内嵌视频
   * （`sv1_*.mp4`）与场景包内音频（`sa1_*`）。键里带入口路径的 base64url + mtime，
   * 所以工坊更新会让旧产物自然失效。
   *
   * 目录取 `cacheBaseDir()/frames`（⇒ `DSH_WE_CACHE_DIR` 与设置页的 `cacheDir` 都作数，
   * 后者是用户可见的那条路）。**`DSH_WE_CACHE_DIR` 是"根"不是"帧目录本身"** —— 这个语义
   * 与早期版本不同（那时它被直接当帧目录用），统一的原因与判据见 `cacheBaseDir()` 的第 ② 条。
   */
  function frameCacheDir() {
    return join(cacheBaseDir(), 'frames');
  }
  function ensureFrameCacheDir() {
    return ensureDirOnce(frameCacheDir());
  }

  /**
   * 静态帧缓存键：`<逻辑版本>_<入口绝对路径 base64url>_<mtime>`（可选 `_vN` 档位后缀）。
   *
   * 不变量：
   *   ① **只能有一处实现** —— 本函数是帧缓存键的唯一构造点，只由 `sceneFrameSlot` 调用；
   *      写帧的 GPU 抓帧回填与读帧的 `/scene-frame` 路由都必须经它，各写一份会出现
   *      "一边写一边读不着"（产物永不被服务，白烧 CPU）。
   *      注：同目录下的 `sv1_`（场景视频）与 `sa1_`（场景音频）是**另两个命名空间**，各有自己的
   *      构造点，不共用本条键。
   *   ② **渲染逻辑一改，版本前缀必须 bump**（见下方 `LIVE_FRAME_KEY_VERSION`）——
   *      否则旧前缀下的坏帧被继续复用，或产物写进旧键、读取走新键（"改了却没生效"）。
   *   任何触及渲染/提取产物的改动，都要同时检查：本常量、所有键构造点、缓存清理。
   */
  const LIVE_FRAME_KEY_VERSION = 'lf1';
  function sceneFrameCacheKey(abs, mtime) {
    return LIVE_FRAME_KEY_VERSION + '_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
  }

  // scene-frame 缓存槽位解析（GET / HEAD / GPU 回填 PUT 共用）：key =
  // <LIVE_FRAME_KEY_VERSION>_<base64url(abs)>_<mtime>。
  // 唯一产物是实时抓帧 <key>_gpu.png —— 文件名即标记：存在 = 该槽已被 live
  // 渲染抓帧覆盖（拒绝重复写，缓存唯一），且可直接双击打开查看。
  //
  // ⚠️ 槽位**只有这一个产物**，所以这里也只给出这一个路径（外加 `key`，它是 PUT 的写去重锁键）：
  // **不要再往槽位里加"看起来有用"的路径**（如 `pngPath` / `jpgPath` / `gifPath`）或 `_vN`
  // 档位后缀 —— 它们**没有任何消费者**，而档位后缀还让"档 4"那次调用白做一次 `statSync` +
  // `ensureFrameCacheDir()`（档 4 是用户 pin 的自定义封面，**豁免**抓帧 ⇒ 根本不会读槽位）。
  function sceneFrameSlot(abs) {
    let mtime = 0;
    try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
    // 键**只有一处构造点**（sceneFrameCacheKey）：两处各自拼字面量时，升键只改一处
    // 就会让写盘产物与读取路径错位（版本前缀同理：必须只有一处）。
    const key = sceneFrameCacheKey(abs, mtime);
    const dir = ensureFrameCacheDir();
    return { key, gpuPath: join(dir, key + '_gpu.png') };
  }
  // GPU 抓帧优先于自定义画面：`_gpu.png` 是真实渲染帧。
  // ⚠️ 档位值域是 `{0, 4}`（其余值由路由 clamp 到 0），而**档 4 的豁免由调用方判定**
  //（`lib/routes/scene-frame.js` 的 `variant === 4 ? null : sceneFrameSlot(abs)`）：
  // 豁免了就不该再解析槽位 —— 那正是上面说的那次白工。本函数因此只回答
  // "这个槽有没有抓帧"，不承担档位语义。
  function gpuFrameFileFor(slot) {
    return existsSync(slot.gpuPath) ? slot.gpuPath : null;
  }
  // GPU 抓帧回填载荷上限（4K PNG 一般数 MB，32MB 余量充足）。
  const GPU_FRAME_MAX_BYTES = 32 * 1024 * 1024;
  // 最小结构校验：只认 8 字节魔数会让「9 字节假 PNG」永久占槽（PUT 200 落盘、
  // 浏览器解不出、之后恒 409），因此额外要求长度下限 + IHDR + IEND。
  const GPU_FRAME_MIN_BYTES = 1024;
  function looksLikePng(body) {
    if (body.length < GPU_FRAME_MIN_BYTES) return false;
    const sig = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47
      && body[4] === 0x0d && body[5] === 0x0a && body[6] === 0x1a && body[7] === 0x0a;
    if (!sig) return false;
    if (body.toString('latin1', 12, 16) !== 'IHDR') return false;
    // IEND 是最后一个 chunk：长度(4)=0 + 'IEND' + CRC(4) → 'IEND' 落在末尾 8..4。
    return body.toString('latin1', body.length - 8, body.length - 4) === 'IEND';
  }
  // 同 key 写入串行化：唯一性闸（existsSync → 写）必须在同一临界区内，否则
  // 并发 PUT 会双双通过（实测：两个 24MB PUT 都返回 200）。
  const GPU_WRITE_INFLIGHT = new Map();
  // GPU 抓帧的几何信息：PNG 的 IHDR 就是抓帧画布的**设备像素**尺寸，其宽高比
  // = 抓帧那一刻渲染页的视口比。渲染器按画布比取景（与设计比 2% 内 → 整张设计
  // 上屏，否则按画布比 cover 裁切），所以「在别的窗口抓的帧」是**另一种构图**，
  // 拿到当前窗口上屏会再被 CSS object-fit: cover 裁一次 → 画面明显放大。客户端
  // 靠这个头判断存帧配不配当前视口（不符就清掉重抓）。只读文件头 33 字节。
  // 同 `pngSizeOf`，但直接解析**内存里的 PNG 字节**（PUT 在落盘前就要从 IHDR 拿几何做
// 面积守卫判定 —— 落盘再读回是多余的 I/O）。结构由 `looksLikePng` 先行保证；这里仍自校验，
// 坏输入返回 null ⇒ 调用方按 415 拒写，绝不给无几何的字节落盘。（上游把它留在门面；本分支门面是
// 薄适配层 ⇒ 收进本 kit，与 pngSizeOf / looksLikePng 同处。）
function pngDimsOfBuf(buf) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function pngSizeOf(file) {
    let fd = -1;
    try {
      fd = openSync(file, 'r');
      const headBuf = Buffer.alloc(33);
      if (readSync(fd, headBuf, 0, 33, 0) < 33) return null;
      if (headBuf.toString('latin1', 12, 16) !== 'IHDR') return null;
      const width = headBuf.readUInt32BE(16);
      const height = headBuf.readUInt32BE(20);
      if (!(width > 0) || !(height > 0)) return null;
      return { width, height };
    } catch {
      return null; // 读不到就不发这个头：客户端按「几何未知」保守处理
    } finally {
      if (fd >= 0) { try { closeSync(fd); } catch { /* ignore */ } }
    }
  }

  return {
    ensureFrameCacheDir, GPU_FRAME_MAX_BYTES, GPU_WRITE_INFLIGHT,
    gpuFrameFileFor, looksLikePng, pngSizeOf, pngDimsOfBuf, sceneFrameSlot,
  };
}
