/**
 * occlusion/x11.js — Linux X11 会话的遮挡数据**适配器**（EWMH 堆叠遍历，npm `x11`）。
 *
 * ══ 数据从哪来 ════════════════════════════════════════════════════════════════
 * X11 没有现成的「谁压在我上面、占了多少」查询，但 EWMH 给了两块积木：
 *   · `_NET_CLIENT_LIST_STACKING`（根窗属性）：**自底向上**的受管窗口 XID 序列，
 *     不含 override-redirect 弹层 —— 正好是「会遮挡我的正常窗口」全集；
 *   · `GetGeometry + TranslateCoordinates`：把每个窗口换算成屏幕坐标系矩形。
 * 于是遮挡 = 「堆叠序列里在我之上的、可见的、非自家的窗口矩形」∩ 自窗矩形。
 * 「自家」= `_NET_WM_PID` 命中候选集 `{process.pid, process.ppid}` 的窗口（插件现在
 * 跑在 runtime utility 子进程，父进程才是拥有 BrowserWindow 的 Electron 主进程）。
 *
 * ══ 为什么不监听事件就够了 ═══════════════════════════════════════════════════
 * 事件（ConfigureNotify/PropertyNotify/MapNotify…）**只当加速器**：堆叠序变化、
 * 窗口移动这些事并不保证每一个都有对应事件可靠地送到我们选的掩码上（不同 WM 行为
 * 有差异），而整遍轮询只是一串本机 unix-socket 往返（实测远低于 1ms/窗口）。所以
 * 架构是 **1Hz 兜底轮询 + 事件触发立即重算**（在 `index.js` hub 里组合），本文件只
 * 提供 `poll()` 与 `onChange` 两个原语，不内建定时器。
 *
 * ══ 会话门（照抄规格 §2 的裁决）══════════════════════════════════════════════
 * `isX11CandidateEnv()`：linux + `DISPLAY` 非空 + `WAYLAND_DISPLAY` **为空** 才允许
 * X11 路线。Wayland 会话下即便存在 `DISPLAY`（XWayland），也**禁用**：XWayland 的
 * 窗口域对 Wayland 合成器不透明，查出来的堆叠序是残缺的，宁可降级也不要假数据。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════
 * `createX11Adapter()` 返回 `{ start, poll, onChange, stop }`：
 *   · `start()` → Promise<void>；连不上 / 缺 EWMH 原子 ⇒ reject（hub 据此降级）；
 *   · `poll()`  → Promise<{ own:{x,y,w,h}, occluders:[[x,y,w,h]…], epoch }>，
 *     均为**屏幕坐标系**；`occluders` 已是「在自家最大可视窗之上」的候选集（未裁剪——
 *     裁剪/合并/相对化是 `rects.js` 与 hub 的事）；不可用时 reject；
 *   · `onChange(cb)` → 订阅「可能有变化」信号（不承诺是什么变了——hub 收到就重算）；
 *   · `stop()`   → 幂等；断开连接、解绑监听。
 * 不变量：本文件**不**碰 hub 的快照状态、**不**设定时器、**不**重试（重试策略在 hub）。
 */

import process from 'node:process';
import { cleanOccluders } from './rects.js';

/** EWMH frame extents 的四个方向的顺序：左、右、上、下（像素）。 */
// [left, right, top, bottom]

/**
 * X11 候选会话门。参数化（env/platform）只为单测注入；默认读真实进程。
 * @returns {boolean}
 */
export function isX11CandidateEnv(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (!env.DISPLAY) return false;
  // Wayland 会话一律禁走 X11 路线（XWayland 隔离 ⇒ 堆叠序残缺，见文件头）。
  if (env.WAYLAND_DISPLAY) return false;
  return true;
}

/** 事件类型白名单：任一命中都视为「布局可能变了」。数值抄自 X11 协议核心事件序号。 */
const LAYOUT_EVENT_TYPES = new Set([
  16, // CreateNotify
  17, // DestroyNotify
  18, // UnmapNotify
  19, // MapNotify
  22, // ConfigureNotify
  28, // PropertyNotify
]);

const MAP_STATE_VIEWABLE = 2;

/** 需要在连接建立后 Intern 的 EWMH 原子。 */
const EWmh_ATOMS = [
  '_NET_CLIENT_LIST_STACKING',
  '_NET_WM_PID',
  '_NET_WM_STATE',
  '_NET_WM_STATE_HIDDEN',
  '_NET_FRAME_EXTENTS',
];

/**
 * 建一个 X11 适配器（`snapshot()` / `subscribe()` / `stop()`）。
 *
 * @param {object} [o] 注入面（探针/单测用；缺省 = 真实实例）
 * @param {number} [o.ownPid] 把归属候选集收敛成这一个 pid（探针/单测）；缺省 = `[process.pid, process.ppid]`
 */
export function createX11Adapter({ ownPid } = {}) {
  // 归属候选集：显式注入 ownPid 只为探针/单测（此时集合就是它一个，行为确定）。
  // 真实实例：插件跑在 DSH 的 runtime **utility 子进程**里（`--expose-internals`），
  // BrowserWindow 属于 Electron **主进程** —— 即本进程的父进程。所以候选 =
  // [process.pid, process.ppid]：主进程直载（老形态）与 utility 子进程（现形态）都命中。
  let X = null;
  let root = 0;
  let epoch = '';
  let atoms = null;
  const changeListeners = new Set();
  let eventBound = null;
  let errorBound = null;
  let stopped = false;

  /** 把 `(…, cb(err, result))` 风格的 X 调用包成 Promise。 */
  const call = (fn, ...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (err, result) => (err ? reject(err) : resolve(result)));
    });

  const internAtoms = async () => {
    atoms = {};
    for (const name of EWmh_ATOMS) {
      // only_if_exists=false：即使 WM 尚未设置也把原子造出来（GetProperty 会回空体）。
      atoms[name] = await call(X.InternAtom.bind(X), false, name);
    }
  };

  const bindEvents = () => {
    eventBound = (ev) => {
      if (stopped || !LAYOUT_EVENT_TYPES.has(ev.type)) return;
      for (const fn of changeListeners) {
        try {
          fn();
        } catch {
          /* 监听者异常不得打断事件泵 */
        }
      }
    };
    X.on('event', eventBound);
    // ⚠️ x11@4.3.1 的错误分发：调用回调若返回 falsy（我们的 Promise 包装恒 undefined）
    // 就额外 `client.emit('error', error)`（xcore.js:617-619）；连接层错误同样 emit。
    // EventEmitter 无 'error' 监听即抛 ERR_UNHANDLED_ERROR，且 FrameBuffer 泵无 catch
    // ⇒ uncaughtException 崩掉宿主 utility 进程。常态触发面：遍历 stacking 时窗口
    // 恰好销毁的 BadWindow 应答。这里吞掉**事件级**错误 —— 单次调用的失败仍经各自
    // 的 Promise rejection 上行，由 hub 降级路径兜住。
    errorBound = () => {};
    X.on('error', errorBound);
  };

  return {
    /**
     * 建立连接并做一次能力探测（EWMH 原子可 Intern、根窗属性可读）。
     * x11 包**懒 import**：hub 单测与 Windows/macOS 冒烟不应当为了构造 hub 就加载它。
     */
    async start() {
      const x11 = (await import('x11')).default ?? (await import('x11'));
      const display = await new Promise((resolve, reject) => {
        x11.createClient((err, d) => (err ? reject(err) : resolve(d)));
      });
      X = display.client;
      root = display.screen[0].root;
      // 根窗**显式**选事件掩码：node-x11 不会自动选（xcore.js 只在 SendClientMessage
      // 的 SendEvent 里默认带），不选的话 X 服务器一条 PropertyNotify/ConfigureNotify
      // 都不会发给我们 —— "事件触发立即重算"整条死掉，只剩 1Hz 心跳。
      // ChangeWindowAttributes 无应答；选错/失败走 'error' 事件（已被吞）+ 心跳兜底。
      X.ChangeWindowAttributes(root, {
        eventMask: x11.eventMask.PropertyChange | x11.eventMask.SubstructureNotify,
      });
      epoch = `x11::display=${process.env.DISPLAY || ':0'}`;
      await internAtoms();
      bindEvents();
      // 能力探测：真读一次堆叠属性，缺 EWMH（裸 X、极端 WM）当场暴露给 hub 降级。
      const stacking = await this._readStacking();
      if (stacking === null) {
        throw new Error('_NET_CLIENT_LIST_STACKING unavailable (no EWMH window manager?)');
      }
    },

    /** 根窗 `_NET_CLIENT_LIST_STACKING` → XID 数组（自底向上）；属性缺失 ⇒ null。 */
    async _readStacking() {
      const prop = await call(
        X.GetProperty.bind(X), 0, root, atoms._NET_CLIENT_LIST_STACKING, 0 /* AnyPropertyType */, 0, 10000000,
      );
      if (!prop || prop.format !== 32 || !prop.data || prop.data.length < 4) return null;
      const n = prop.data.length >> 2;
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = prop.data.readUInt32LE(i * 4);
      return out;
    },

    /** 窗口属性：{ viewable, overrideRedirect }；读失败按「不可见」处理。 */
    async _attrs(wid) {
      try {
        const a = await call(X.GetWindowAttributes.bind(X), wid);
        return { viewable: a.mapState === MAP_STATE_VIEWABLE, overrideRedirect: a.overrideRedirect === 1 };
      } catch {
        return { viewable: false, overrideRedirect: false };
      }
    },

    /** `_NET_WM_PID`；读不到 ⇒ 0（未知属主，按非自家处理）。 */
    async _pidOf(wid) {
      try {
        const prop = await call(X.GetProperty.bind(X), 0, wid, atoms._NET_WM_PID, 0, 0, 10000000);
        if (!prop || prop.format !== 32 || !prop.data || prop.data.length < 4) return 0;
        return prop.data.readUInt32LE(0);
      } catch {
        return 0;
      }
    },

    /** `_NET_WM_STATE` 是否含 HIDDEN（图标化窗口对 EWMH 而言「在」堆叠里但不可见）。 */
    async _isHidden(wid) {
      try {
        const prop = await call(X.GetProperty.bind(X), 0, wid, atoms._NET_WM_STATE, 0, 0, 10000000);
        if (!prop || prop.format !== 32 || !prop.data) return false;
        const n = prop.data.length >> 2;
        for (let i = 0; i < n; i++) {
          if (prop.data.readUInt32LE(i * 4) === atoms._NET_WM_STATE_HIDDEN) return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    /**
     * 客户区屏幕矩形（经 EWMH frame extents 外扩到 WM 装饰外缘）。
     * GetGeometry 的 x/y 是**相对父窗**的，必须 TranslateCoordinates 到根窗；
     * 子进程崩溃/窗口消失（ BadWindow 等）⇒ null，调用方直接跳过。
     * @returns {Promise<[number, number, number, number] | null>} [x, y, w, h]（屏幕坐标），失败为 null
     */
    async _clientScreenRect(wid, expandFrame) {
      try {
        const geom = await call(X.GetGeometry.bind(X), wid);
        const pos = await call(X.TranslateCoordinates.bind(X), wid, root, 0, 0);
        let [x, y, w, h] = [pos.destX, pos.destY, geom.width, geom.height];
        if (expandFrame) {
          // EWMH: _NET_FRAME_EXTENTS = [left, right, top, bottom]（卡片量、32 位）。
          const prop = await call(X.GetProperty.bind(X), 0, wid, atoms._NET_FRAME_EXTENTS, 0, 0, 10000000);
          if (prop && prop.format === 32 && prop.data && prop.data.length >= 16) {
            const left = prop.data.readUInt32LE(0);
            const right = prop.data.readUInt32LE(4);
            const top = prop.data.readUInt32LE(8);
            const bottom = prop.data.readUInt32LE(12);
            x -= left; y -= top; w += left + right; h += top + bottom;
          }
        }
        return [x, y, w, h];
      } catch {
        return null;
      }
    },

    /**
     * 采集一遍。返回 null 的唯一原因：连接已死/会话不可用（hub 据此降级）。
     * 单窗口查询失败不致命（窗口可能恰好在销毁中）——跳过即可。
     */
    async poll() {
      if (stopped || !X) return null;
      const stacking = await this._readStacking();
      if (stacking === null) return null;

      // 第一遍：筛「正常可见窗」（viewable + 非 override-redirect + 非 HIDDEN），
      // 并按 _NET_WM_PID 找出自家候选窗。
      const alive = [];
      for (const wid of stacking) {
        const attrs = await this._attrs(wid);
        if (!attrs.viewable || attrs.overrideRedirect) continue;
        if (await this._isHidden(wid)) continue;
        const pid = await this._pidOf(wid);
        alive.push({ wid, pid: pid === 0 ? 0 : pid });
      }

      // 自家窗（pid 命中候选集）可能有多个（主窗 + 独立设置窗等）；P0 取**面积最大**
      // 的可视窗当作壁纸所在窗 —— 壁纸层只存在于主聊天窗，这个启发式在当前发行版成立。
      const ownSet = ownPid !== undefined
        ? new Set([ownPid])
        : new Set([process.pid, process.ppid].filter((p) => Number.isInteger(p) && p > 1));
      const mine = [];
      for (const w of alive) {
        if (ownSet.has(w.pid)) mine.push(w);
      }
      if (mine.length === 0) return { own: null, occluders: [], epoch };

      let own = null;
      for (const w of mine) {
        const rect = await this._clientScreenRect(w.wid, false);
        if (!rect) continue;
        const area = rect[2] * rect[3];
        if (!own || area > own.area) {
          own = { wid: w.wid, rect, area };
        }
      }
      if (!own) return { own: null, occluders: [], epoch };
      const ownIndex = stacking.indexOf(own.wid);

      // 遮挡候选 = 堆叠序里**在自家之上**的正常窗（stacking 自底向上 ⇒ slice 之后）。
      // 下方/平级的窗口不可能遮挡，连几何查询都不用发 —— 这是本轮询的省流关键。
      const occluders = [];
      for (let i = ownIndex + 1; i < stacking.length; i++) {
        const entry = alive.find((a) => a.wid === stacking[i]);
        if (!entry || entry.pid === ownPid) continue;
        const rect = await this._clientScreenRect(entry.wid, true);
        if (rect) occluders.push(rect);
      }

      // 清洗（裁剪/去零面积/合并）在这里做掉，hub 只做相对化 —— 让「纯函数」有个
      // 唯一消费入口，也避免 hub 依赖 rects.js 的内部形状。
      const cleaned = cleanOccluders(occluders, own.rect);
      return {
        own: { x: own.rect[0], y: own.rect[1], w: own.rect[2], h: own.rect[3] },
        occluders: cleaned,
        epoch,
      };
    },

    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },

    /** 幂等停止；之后 poll() 恒回 null。 */
    stop() {
      stopped = true;
      if (eventBound && X) {
        try {
          X.removeListener('event', eventBound);
        } catch {
          /* 已断开时移除失败无所谓 */
        }
        eventBound = null;
      }
      if (errorBound && X) {
        try {
          X.removeListener('error', errorBound);
        } catch {
          /* 已断开时移除失败无所谓 */
        }
        errorBound = null;
      }
      if (X) {
        try {
          X.terminate();
        } catch {
          /* 连接可能已断 */
        }
        X = null;
      }
    },
  };
}
