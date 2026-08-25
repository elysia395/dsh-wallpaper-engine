// 增强 scene-scripts.js: createScriptProperties + engine.canvasSize + Vec3 + 用户属性
// 支持 829 类定位脚本: value.x = scriptProperties.x * engine.canvasSize.x
// 以及 App Dock 等复杂脚本的基础 API
import { parseVec3 } from './we-renderer/math.js';

// WEColor API (引擎颜色工具)
export const WEColor = {
  hsv2rgb({ x: h, y: s, z: v }) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return { x: rgb[0], y: rgb[1], z: rgb[2] };
  },
  rgb2hsv({ x: r, y: g, z: b }) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h / 6;
    }
    const s = mx === 0 ? 0 : d / mx;
    return { x: ((h % 1) + 1) % 1, y: s, z: mx };
  },
};

// createScriptProperties() 链式构建器: .addSlider({...}).addCheckbox({...})...finish()
// 属性值: 优先 user 属性映射, 否则 name.value (脚本默认值)
export class ScriptPropertiesBuilder {
  constructor(userProps) {
    this.userProps = userProps || {};
    this.props = {};
  }
  _add(prop) {
    // prop: {name, label, value, min, max, user?, ...}
    let val = prop.value;
    if (prop.user) {
      const uv = this.userProps[prop.user];
      if (uv !== undefined && uv !== null) val = uv;
    }
    this.props[prop.name] = val;
    return this;
  }
  addSlider(p) { return this._add(p); }
  addCheckbox(p) { return this._add(p); }
  addColor(p) { return this._add(p); }
  addTextinput(p) { return this._add(p); }
  addText(p) { return this._add(p); }
  addCombo(p) { return this._add(p); }
  addDropdown(p) { return this._add(p); }
  finish() { return this.props; }
}

// Vec3 (引擎坐标类)
// 构造兼容: new Vec3(otherVec3) 复制 (733 Lens Flare 等脚本 new Vec3(thisLayer.size));
// 旧实现把 Vec3 实例存进 this.x → 后续运算 NaN → origin 级联 NaN → 组件渲染异常
export class Vec3 {
  constructor(x, y, z) {
    if (x && typeof x === 'object' && 'x' in x) { this.x = x.x; this.y = x.y; this.z = x.z; }
    else { this.x = x; this.y = y; this.z = z; }
  }
  add(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  subtract(o) { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  multiply(o) { return new Vec3(this.x * o, this.y * o, this.z * o); }
  divide(o) { return new Vec3(this.x / o, this.y / o, this.z / o); }
  negate() { return new Vec3(-this.x, -this.y, -this.z); }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { const l = this.length() || 1; return new Vec3(this.x / l, this.y / l, this.z / l); }
  distance(o) { return Math.sqrt((this.x-o.x)**2 + (this.y-o.y)**2 + (this.z-o.z)**2); }
  clone() { return new Vec3(this.x, this.y, this.z); }
  // NSL 脚本常用 copy() (726 Launcher init: value.copy())
  copy() { return new Vec3(this.x, this.y, this.z); }
  toString() { return `${this.x} ${this.y} ${this.z}`; }
}
