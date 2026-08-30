// WE 渲染引擎 — scene 层: 对象可见性 (自身 + 祖先级联 + 用户属性绑定 + 实时组件跳过)
// 官方对应: 场景图对象 visible 语义 — {user: <属性名>, value} 绑定 project.json 用户属性,
// 父对象隐藏时子对象一并隐藏 (App Launcher Dock 等作者组件依赖此语义)
// P1 重构: 从 core.js 拆出, 纯搬家零行为变化
import path from 'path';
import { getVal } from '../math.js';

export function installVisibility(proto) {
  Object.assign(proto, {
    // 对象自身可见性 (不含父级): visible 可能是 {user: <属性名>, value} 绑定用户属性
    // (可关闭的作者声明/时钟/FPS 等: user 指向 project.json 属性, 用户关闭后
    // 该组件整体不渲染)。scene.json 里的 value 是设计器默认, 运行时须读 userProps
    // 的当前值 (用户改过则生效), userProps 无该键时才回退 scene.json 的 value。
    _isVisibleSelf(o) {
      const v = o && o.visible;
      if (v == null) return true;
      if (typeof v === 'object' && v !== null && 'user' in v) {
        const user = v.user;
        if (typeof user === 'string' && user && this.userProps && user in this.userProps) {
          return this.userProps[user] !== false && this.userProps[user] !== 'false';
        }
        // user 无对应属性 (或 object 形式) → 回退 value
        return v.value !== false && v.value !== 'false';
      }
      return getVal(o, 'visible', true) !== false;
    },

    // 对象可见性 = 自身可见 AND 祖先链全部可见 (官方场景图语义: 组/容器对象
    // 隐藏时其子对象一并隐藏 — App Launcher Dock 等作者组件用父对象 visible
    // 绑定用户属性开关, 父隐藏后 Launcher 子对象不得独立渲染)
    _isVisible(o) {
      if (!this._isVisibleSelf(o)) return false;
      // 沿 parent 链向上, 任一祖先不可见 → 本对象不可见
      let cur = o;
      let guard = 0;
      while (cur && cur.parent != null && guard < 32) {
        const parent = this.objects.find((x) => x.id === cur.parent);
        if (!parent) break;
        if (!this._isVisibleSelf(parent)) return false;
        cur = parent;
        guard++;
      }
      return true;
    },

    // 实时组件统一跳过 (静态帧无法提供实时数据, 后续解决实时渲染):
    //   1. 音频条/频谱类效果组件 (效果名匹配, 无音频输入 → 渲染无意义)
    //   2. 时间文本已有 _isLiveText (text.js) 单独跳过
    _isLiveComponent(o) {
      if (!o || !Array.isArray(o.effects)) return false;
      for (const ef of o.effects) {
        if (!ef || !ef.file) continue;
        const name = path.basename(path.dirname(ef.file));
        // 音频类效果 (官方效果名均不含这些词, 第三方音频条/频谱全命中)
        if (/audio|bars|oscilloscope|visualizer|equalizer|spectrum/i.test(name)) return true;
      }
      return false;
    },
  });
}
