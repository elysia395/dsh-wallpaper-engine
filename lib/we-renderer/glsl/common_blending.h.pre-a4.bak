#ifndef WE_COMMON_BLENDING_H_MIN
#define WE_COMMON_BLENDING_H_MIN
// common_blending.h 重建版 — WE 官方头文件无公开副本（lwe/文档均未随附），
// 按本仓库 CPU 侧 applyBlending (lib/we-renderer/math.js) 已验证模式表逐支转写，
// 数学逐通道同构。官方语义（docs.wallpaperengine.io shader/headers）:
// ApplyBlending 第一个 mode 参数被忽略，实际按 BLENDMODE combo（编译期 define）选择。
// 第 4 参数 blend: 0 = colorA 原样, 1 = 完全应用混合结果。
// 未定义 BLENDMODE 时回退 0（normal mix）。

#ifndef BLENDMODE
#define BLENDMODE 0
#endif

vec3 _weBlendDarken(vec3 a, vec3 b) { return min(a, b); }
vec3 _weBlendLighten(vec3 a, vec3 b) { return max(a, b); }
vec3 _weBlendScreen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 _weBlendOverlay(vec3 a, vec3 b) {
  return vec3(a.r < 0.5 ? 2.0 * a.r * b.r : 1.0 - 2.0 * (1.0 - a.r) * (1.0 - b.r),
              a.g < 0.5 ? 2.0 * a.g * b.g : 1.0 - 2.0 * (1.0 - a.g) * (1.0 - b.g),
              a.b < 0.5 ? 2.0 * a.b * b.b : 1.0 - 2.0 * (1.0 - a.b) * (1.0 - b.b));
}
vec3 _weBlendSoftLight(vec3 a, vec3 b) {
  return vec3(b.r < 0.5 ? 2.0 * a.r * b.r + a.r * a.r * (1.0 - 2.0 * b.r) : sqrt(a.r) * (2.0 * b.r - 1.0) + 2.0 * a.r * (1.0 - b.r),
              b.g < 0.5 ? 2.0 * a.g * b.g + a.g * a.g * (1.0 - 2.0 * b.g) : sqrt(a.g) * (2.0 * b.g - 1.0) + 2.0 * a.g * (1.0 - b.g),
              b.b < 0.5 ? 2.0 * a.b * b.b + a.b * a.b * (1.0 - 2.0 * b.b) : sqrt(a.b) * (2.0 * b.b - 1.0) + 2.0 * a.b * (1.0 - b.b));
}
vec3 _weBlendColorDodge(vec3 a, vec3 b) {
  return vec3(b.r == 1.0 ? 1.0 : min(a.r / (1.0 - b.r), 1.0),
              b.g == 1.0 ? 1.0 : min(a.g / (1.0 - b.g), 1.0),
              b.b == 1.0 ? 1.0 : min(a.b / (1.0 - b.b), 1.0));
}
vec3 _weBlendColorBurn(vec3 a, vec3 b) {
  return vec3(b.r == 0.0 ? 0.0 : max(1.0 - (1.0 - a.r) / b.r, 0.0),
              b.g == 0.0 ? 0.0 : max(1.0 - (1.0 - a.g) / b.g, 0.0),
              b.b == 0.0 ? 0.0 : max(1.0 - (1.0 - a.b) / b.b, 0.0));
}
vec3 _weBlendVividLight(vec3 a, vec3 b) {
  return vec3(b.r < 0.5 ? _weBlendColorBurn(vec3(a.r), vec3(2.0 * b.r)).r : _weBlendColorDodge(vec3(a.r), vec3(2.0 * (b.r - 0.5))).r,
              b.g < 0.5 ? _weBlendColorBurn(vec3(a.g), vec3(2.0 * b.g)).r : _weBlendColorDodge(vec3(a.g), vec3(2.0 * (b.g - 0.5))).r,
              b.b < 0.5 ? _weBlendColorBurn(vec3(a.b), vec3(2.0 * b.b)).r : _weBlendColorDodge(vec3(a.b), vec3(2.0 * (b.b - 0.5))).r);
}
vec3 _weBlendLinearLight(vec3 a, vec3 b) {
  return vec3(b.r < 0.5 ? max(a.r + 2.0 * b.r - 1.0, 0.0) : min(a.r + 2.0 * (b.r - 0.5), 1.0),
              b.g < 0.5 ? max(a.g + 2.0 * b.g - 1.0, 0.0) : min(a.g + 2.0 * (b.g - 0.5), 1.0),
              b.b < 0.5 ? max(a.b + 2.0 * b.b - 1.0, 0.0) : min(a.b + 2.0 * (b.b - 0.5), 1.0));
}
vec3 _weBlendPinLight(vec3 a, vec3 b) {
  return vec3(b.r < 0.5 ? min(a.r, 2.0 * b.r) : max(a.r, 2.0 * (b.r - 0.5)),
              b.g < 0.5 ? min(a.g, 2.0 * b.g) : max(a.g, 2.0 * (b.g - 0.5)),
              b.b < 0.5 ? min(a.b, 2.0 * b.b) : max(a.b, 2.0 * (b.b - 0.5)));
}
vec3 _weBlendReflect(vec3 a, vec3 b) {
  return vec3(b.r == 1.0 ? 1.0 : min(a.r * a.r / (1.0 - b.r), 1.0),
              b.g == 1.0 ? 1.0 : min(a.g * a.g / (1.0 - b.g), 1.0),
              b.b == 1.0 ? 1.0 : min(a.b * a.b / (1.0 - b.b), 1.0));
}
vec3 _weBlendPhoenix(vec3 a, vec3 b) { return min(a, b) - max(a, b) + 1.0; }

vec3 _weRgbToHsl(vec3 c) {
  float fmin = min(c.r, min(c.g, c.b)), fmax = max(c.r, max(c.g, c.b));
  float delta = fmax - fmin;
  vec3 hsl = vec3(0.0, 0.0, (fmax + fmin) / 2.0);
  if (delta == 0.0) return hsl;
  hsl.y = hsl.z < 0.5 ? delta / (fmax + fmin) : delta / (2.0 - fmax - fmin);
  float deltaR = (((fmax - c.r) / 6.0) + delta / 2.0) / delta;
  float deltaG = (((fmax - c.g) / 6.0) + delta / 2.0) / delta;
  float deltaB = (((fmax - c.b) / 6.0) + delta / 2.0) / delta;
  if (c.r == fmax) hsl.x = deltaB - deltaG;
  else if (c.g == fmax) hsl.x = 1.0 / 3.0 + deltaR - deltaB;
  else hsl.x = 2.0 / 3.0 + deltaG - deltaR;
  if (hsl.x < 0.0) hsl.x += 1.0; else if (hsl.x > 1.0) hsl.x -= 1.0;
  return hsl;
}
float _weHueToRgb(float f1, float f2, float hue) {
  float h = hue;
  if (h < 0.0) h += 1.0; else if (h > 1.0) h -= 1.0;
  if (6.0 * h < 1.0) return f1 + (f2 - f1) * 6.0 * h;
  if (2.0 * h < 1.0) return f2;
  if (3.0 * h < 2.0) return f1 + (f2 - f1) * ((2.0 / 3.0) - h) * 6.0;
  return f1;
}
vec3 _weHslToRgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float f2 = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : (hsl.z + hsl.y) - (hsl.y * hsl.z);
  float f1 = 2.0 * hsl.z - f2;
  return vec3(_weHueToRgb(f1, f2, hsl.x + 1.0 / 3.0), _weHueToRgb(f1, f2, hsl.x), _weHueToRgb(f1, f2, hsl.x - 1.0 / 3.0));
}

// 逐支对应 CPU applyBlending (math.js) case 表; 输出 clamp [0,1] 与 CPU 一致。
vec3 ApplyBlending(int mode, vec3 colorA, vec3 colorB, float blend) {
#if BLENDMODE == 1 || BLENDMODE == 5
  return clamp(mix(colorA, _weBlendDarken(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 2
  return clamp(mix(colorA, colorA * colorB, blend), 0.0, 1.0);
#elif BLENDMODE == 3
  return clamp(mix(colorA, _weBlendColorBurn(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 4 || BLENDMODE == 20
  return clamp(mix(colorA, max(colorA + colorB - 1.0, 0.0), blend), 0.0, 1.0);
#elif BLENDMODE == 6 || BLENDMODE == 10
  return clamp(mix(colorA, _weBlendLighten(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 7
  return clamp(mix(colorA, _weBlendScreen(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 8
  return clamp(mix(colorA, _weBlendColorDodge(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 9
  return clamp(mix(colorA, min(colorA + colorB, 1.0), blend), 0.0, 1.0);
#elif BLENDMODE == 11
  return clamp(mix(colorA, _weBlendOverlay(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 12
  return clamp(mix(colorA, _weBlendSoftLight(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 13
  return clamp(mix(colorA, _weBlendOverlay(colorB, colorA), blend), 0.0, 1.0);
#elif BLENDMODE == 14
  return clamp(mix(colorA, _weBlendVividLight(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 15
  return clamp(mix(colorA, _weBlendLinearLight(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 16
  return clamp(mix(colorA, _weBlendPinLight(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 17
  return clamp(mix(colorA, vec3(_weBlendVividLight(colorA, colorB).r < 0.5 ? 0.0 : 1.0,
                                _weBlendVividLight(colorA, colorB).g < 0.5 ? 0.0 : 1.0,
                                _weBlendVividLight(colorA, colorB).b < 0.5 ? 0.0 : 1.0), blend), 0.0, 1.0);
#elif BLENDMODE == 18
  return clamp(mix(colorA, abs(colorA - colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 19
  return clamp(mix(colorA, colorA + colorB - 2.0 * colorA * colorB, blend), 0.0, 1.0);
#elif BLENDMODE == 21
  return clamp(mix(colorA, _weBlendReflect(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 22
  return clamp(mix(colorA, _weBlendReflect(colorB, colorA), blend), 0.0, 1.0);
#elif BLENDMODE == 23
  return clamp(mix(colorA, _weBlendPhoenix(colorA, colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 24
  return clamp(mix(colorA, (colorA + colorB) / 2.0, blend), 0.0, 1.0);
#elif BLENDMODE == 25
  return clamp(mix(colorA, 1.0 - abs(1.0 - colorA - colorB), blend), 0.0, 1.0);
#elif BLENDMODE == 26
  { vec3 bs = _weRgbToHsl(colorB), as2 = _weRgbToHsl(colorA); return clamp(mix(colorA, _weHslToRgb(vec3(bs.x, as2.y, as2.z)), blend), 0.0, 1.0); }
#elif BLENDMODE == 27
  { vec3 bs = _weRgbToHsl(colorB), as2 = _weRgbToHsl(colorA); return clamp(mix(colorA, _weHslToRgb(vec3(as2.x, bs.y, as2.z)), blend), 0.0, 1.0); }
#elif BLENDMODE == 28
  { vec3 bs = _weRgbToHsl(colorB), as2 = _weRgbToHsl(colorA); return clamp(mix(colorA, _weHslToRgb(vec3(bs.x, bs.y, as2.z)), blend), 0.0, 1.0); }
#elif BLENDMODE == 29
  { vec3 bs = _weRgbToHsl(colorB), as2 = _weRgbToHsl(colorA); return clamp(mix(colorA, _weHslToRgb(vec3(as2.x, as2.y, bs.z)), blend), 0.0, 1.0); }
#elif BLENDMODE == 30
  { float t = max(colorA.r, max(colorA.g, colorA.b)); return clamp(mix(colorA, vec3(t) * colorB, blend), 0.0, 1.0); }
#elif BLENDMODE == 31
  return clamp(colorA + colorB * blend, 0.0, 1.0);
#elif BLENDMODE == 32
  return clamp(mix(colorA, colorA + colorA * colorB, blend), 0.0, 1.0);
#else
  return clamp(mix(colorA, colorB, blend), 0.0, 1.0);
#endif
}

#endif // WE_COMMON_BLENDING_H_MIN
