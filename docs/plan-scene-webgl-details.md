# 附录：plan-scene-webgl 实施细节（scene-gl）

> 本附录由细节子代理编写、主代理审定，与主计划 v2 配套。所有公式/代码均对照 CPU 实现核对（核对状态逐项标注）。

## 0. 事实基线（均已对照代码/scene.pkg 实测）

- 摆放语义：`lib/we-renderer/image.js:133-145`——ps=[W/ortho.w, H/ortho.h]；`dx=ox−dw/2`，`dy=H−oy·ps−dh/2`（+vs[1]，本场景 0）；tex 行 0（图顶）画在矩形顶边。viewShift：`camera.js:276-289`（camEye=(0,0,0)→[0,0,0]）。
- 相机矩阵（模型路径）：`camera.js:227-244`；mat4Ortho/mat4FromTRS：`math.js:50-75`；resolveTransform：`core.js:418-455`；clear：`core.js:576-579`。
- 采样：`model.js:676-702` _texSample = wrap(frac)+双线性 = GL REPEAT+LINEAR 无 mip。
- CPU 效果：`effects/waterripple.js:14-70`（direction 弧度直传：37-39；maskUV=u·maskW/texW：29-31）；`effects/iris.js:13-78`。
- 官方 shader（pkg 内原文本已提取）：waterripple.{vert,frag}、iris.{vert,frag}；combo：PERSPECTIVE=0、SPECULAR=0([COMBO_OFF])、BACKGROUND=0、MASK=纹理驱动（无默认值元注释）。
- 场景实测：单对象 3840×2160@origin(1920,1080)；ortho 3840×2160；bloom/hdr=false；clearenabled=true clearcolor 0.7；材质 blending "translucent"，效果 pass blending "normal"、depthtest/depthwrite disabled。
- 纹理实测：主图 3840×2160（embedded PNG）；waterripple_mask 1920×1080 R8，texel(0,0)=255 白；iris_mask 1920×1080 R8，全黑（max=124@眼部，>40 仅 0.18%）；waterripplenormal 256×256 RGBA8888。
- 宿主：token=base64url(abs path) `index.js:1917-1922`；403 门控 `index.js:2414-2422`；serveFile Range `index.js:2101-2146`；sceneAspect `index.js:680-692`；build-client.mjs 仅单文件文本包裹（:34-36）。

## 1. 最小 common.h / common_perspective.h（host 内置，新文件）

`lib/we-renderer/glsl/common.h`：

```glsl
#ifndef WE_COMMON_H_MIN
#define WE_COMMON_H_MIN
#define M_PI   3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define mul(v, m) ((v) * (m))            // GLSL v*m 与 HLSL mul(v,m)（行向量积）逐位等价
#define frac fract                        // iris.vert 用
#define lerp mix
#define saturate(x) clamp((x), 0.0, 1.0)
#define CAST2(x) vec2(x)
#define CAST3(x) vec3(x)
#define CAST4(x) vec4(x)
#define CAST3X3(x) mat3(x)
// rotateVec2：官方语义=平面逆时针旋转。核对：CPU waterripple.js:37-39 以
// rotateVec2((0,1),dir) 得 (-sin dir, cos dir)，与本实现一致。【官方语义核对过】
vec2 rotateVec2(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}
#endif
```

`lib/we-renderer/glsl/common_perspective.h`：

```glsl
#ifndef WE_COMMON_PERSPECTIVE_H_MIN
#define WE_COMMON_PERSPECTIVE_H_MIN
// 仅 waterripple.vert PERSPECTIVE=1 分支引用；本场景被 #if 裁掉，但 include 必须展开且可编译。
// squareToQuad = 单位方→四边形射影映射（Heckbert 公式重构；CPU math.js 无此函数）。
// 三组几何核对：单位方→恒等；平行四边形→g=h=0 纯仿射；梯形数值代入 (1,1)→(2,2)✓ (0,1)→(0,1)✓。
// 【重构+验证，非官方原文；PERSPECTIVE=1 不在 Phase 1】
mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
    float dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
    float dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
    float sx  = p0.x - p1.x + p2.x - p3.x;
    float sy  = p0.y - p1.y + p2.y - p3.y;
    float den = dx1 * dy2 - dy1 * dx2;
    float g = (sx * dy2 - sy * dx2) / den;
    float h = (dx1 * sy - dy1 * sx) / den;
    float a = p1.x - p0.x + g * p1.x;
    float b = p3.x - p0.x + h * p3.x;
    float c = p0.x;
    float d = p1.y - p0.y + g * p1.y;
    float e = p3.y - p0.y + h * p3.y;
    float f = p0.y;
    return mat3(a, d, g,  b, e, h,  c, f, 1.0);  // 列主序构造；列向量约定 p'=M·(u,v,1)ᵀ
}
// inverse(mat3)：ES 3.00 内建，不重定义；ES 1.00 首选路径下只在被裁掉的 #else 里出现，无需实现。
#endif
```

## 2. Shader 拼装：首选 ES 1.00 原样编译（WebGL2 上下文）

WebGL2 上下文直接编译 GLSL ES 1.00（NPOT+REPEAT 限制在 API 层解除）。varying/attribute/texture2D/gl_FragColor 全部原生，唯一必需的宏是 `texSample2D`，加 combo 定义与 precision：

```js
function assembleGLSL(expandedSrc, combosTable, comboValues) {
  // expandedSrc: host 端 expandIncludes 产物（绝不跑 shaderfrog preprocessShader）
  // combosTable: scene-shader 响应的 combos 表（parseMetaGL 产物）——遍历全键生成 define，
  //              不硬编码 combo 名（否则白名单扩第一个带新 combo 的效果时 define 头缺失、
  //              未定义宏按 0 → 分支被静默裁掉）
  if (/^\s*#version/m.test(expandedSrc)) throw new Error('unexpected #version in WE shader');
  let head = '';
  for (const name of Object.keys(combosTable || {})) head += `#define ${name} ${comboValues[name] ?? 0}\n`;
  head += `#define texSample2D texture2D\n` + `precision highp float;\nprecision highp int;\n`;
  return head + expandedSrc + '\n';
}
```

官方原文两个 quirk 照抄不"修正"：① waterripple MASK 分支用 g_Texture2Resolution（normal 图分辨率）缩放 mask UV；② waterripple.frag 声明 `varying vec2 v_Scroll;` 但 vert 不写——ES 1.00 链接合法（未使用）。

**【Phase 0 回写】"唯一必需的宏是 texSample2D" 不成立**：严格 ES 1.00 禁 int→float 隐式转换，ANGLE/SwiftShader 拒绝官方文本两处——waterripple.frag 的 `* 2 - 1`（vec3×int）与 iris.vert 的 `smoothstep(1 - g_Rough, 1,`。assembleGLSL 必须在拼头后对全文做定向 regex fixup（`* 2 - 1` → `* 2.0 - 1.0`；`smoothstep(1 - g_Rough, 1,` → `smoothstep(1.0 - g_Rough, 1.0,`），spike 实测两条命中即编译通过。WE 官方编译器宽松放行这两处，故 pkg 原文如此。

备选 B：GLSL 300 es 转换头（原样编译踩坑才启用；`gl_FragColor` 必须文本改名不能宏定义——GLSL 禁止宏取代 gl_ 前缀标识符；`#version` 物理第一行）：

```js
const GL3_VERT_HEAD = `#version 300 es
#define attribute in
#define varying out
#define texture2D texture
#define texSample2D texture
precision highp float;
precision highp int;
`;
const GL3_FRAG_HEAD = `#version 300 es
#define varying in
#define texture2D texture
#define texture2DLod textureLod
#define texSample2D texture
precision highp float;
precision highp int;
out vec4 we_FragColor;
`;
// frag 源码拼头前：src = src.replace(/\bgl_FragColor\b/g, 'we_FragColor')
```

## 3. Y 翻转与坐标系（与 image.js 逐行对齐）

顶点数据（全 pass 共用，local y 向上）：

```js
const verts = new Float32Array([
    -0.5,  0.5, 0,   0,   1,   // 左上
     0.5,  0.5, 0,   1,   1,   // 右上
    -0.5, -0.5, 0,   0,   0,   // 左下
     0.5, -0.5, 0,   1,   0,   // 右下
]);
const idx = new Uint16Array([0, 2, 1,  1, 2, 3]);
// stride 20B；a_Position offset 0 (vec3)，a_TexCoord offset 12 (vec2)
```

**【Phase 0 回写】flipY 方案被 spike 推翻，改 y-down 全链路**：WE shader 血统是 HLSL/D3D（`mul(v,m)` 行向量），官方语义 **v=0=图顶、纹理行 0=图顶**。waterripple.vert 把 g_Time 直接加进 v——flipY 上传会让 `frac(1−v+c)` 与 `frac(v+c)` 互为镜像，法线场采样完全错位（实测 MAD 11+ 全约定不收敛）。**定案**：纹理**不翻转**上传（tex 行 0 = PNG 行 0 = 图顶 = CPU v=0）；quad UV 顶边 v=0；效果 pass MVP **y 行取负**（图顶 → NDC−1 → FBO tex 行 0，链内一致）；present pass MVP 正常（图顶 → NDC+1 = 屏幕上）。修正后波纹与 CPU 逐点对齐（MAD 2.88）。

~~上传翻转定案：`createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })`（t=0=图底）。不依赖 `UNPACK_FLIP_Y_WEBGL`（对 ImageBitmap 源被规范忽略；回退路径 = Image + texImage2D + pixelStorei）。~~

~~FBO ping-pong 方向：quad 底边（v=0）NDC y=−1 → 写附件 t=0；源图底部也是 t=0（flipY 上传）→ 链内方向一致，present 直出正向。~~

FBO ping-pong 方向（回写版）：quad 顶边（v=0）经效果 pass 的负 y MVP → NDC y=−1 → FBO tex 行 0 = 图顶；链内方向一致，present 正向 MVP 直出。

纹理参数：**slot1/2（mask/normal）REPEAT**（ripple 坐标随 t 无界增长必须 wrap，CPU _texSample 同为 wrap）；**slot0（主图）= 【Phase 0 回写】判别实验⑤定案 CLAMP**——REPEAT 渲染对比差异仅上下边缘 1-2px 带（分段 MAD 仅段0/段15 非零），CPU 对位移后 UV clamp → 跟 CPU 用 CLAMP。LINEAR + mipmap（4K 主图缩闪，generateMipmap + LINEAR_MIPMAP_LINEAR，WebGL2 NPOT 合法）。context：`webgl2, { alpha:false, premultipliedAlpha:false, antialias:false }`。混合：效果 FBO pass 禁 BLEND；present pass `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`（=CPU 直 alpha src-over）。清屏 clearColor(0.7,0.7,0.7,1)。

## 4. MVP 与 g_ModelViewProjectionMatrix

```js
// dx,dy = 对象矩形左上角像素（CPU: dx=ox−dw/2, dy=H−oy·ps−dh/2(+vs[1])）；dw,dh=size·scale·ps
function quadMVP(W, H, dx, dy, dw, dh) {
  const cx = dx + dw / 2, cy = dy + dh / 2;
  return new Float32Array([
    2 * dw / W, 0, 0, 0,
    0, 2 * dh / H, 0, 0,
    0, 0, -1, 0,                          // z 直通（勿复用 CPU mat4Ortho 的 z 行——near=0.01
    2 * cx / W - 1, 1 - 2 * cy / H, 0, 1, //   会把 z=0 映到 NDC −1.000002 被近平面剔除！）
  ]);
}
// 全屏对象/全屏 FBO pass 均得 M = [2,0,0,0, 0,2,0,0, 0,0,-1,0, 0,0,0,1]
```

mul 行向量一致性：`mul(v,m) ((v)*(m))` 精确等价 HLSL；`uniformMatrix4fv(loc, false, M)` 无需转置。angles：**【Phase 0 回写】spike 判别实验②定死**——① scene.json angles 为**弧度**（lwe CImage.cpp:1097 明示 + CPU 一致）；② **正角 = 屏幕逆时针**，quadMVP 前 local 左乘列主序 `R=[c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]` 时 r = **−rad**；③ **旋转必须像素空间刚体**：NDC/本地坐标各向异性（16:9），直接 rotZ 把 30° 压成 17.6°（实测 tan⁻¹((540/960)·tan30°) 吻合），须用 `S⁻¹·RotZ·S`（S=diag(dw,dh)，即 2x2 部分 [[c, −s·dh/dw],[s·dw/dh, c]]）。

present pass 自写 shader（非 WE 官方）：

```glsl
// present.vert
attribute vec3 a_Position; attribute vec2 a_TexCoord;
varying vec2 v_UV; uniform mat4 u_MVP;
void main(){ v_UV = a_TexCoord.xy; gl_Position = u_MVP * vec4(a_Position, 1.0); }
// present.frag
precision highp float;
varying vec2 v_UV; uniform sampler2D u_Tex; uniform float u_ObjectAlpha;
void main(){ vec4 c = texture2D(u_Tex, v_UV); gl_FragColor = vec4(c.rgb, c.a * u_ObjectAlpha); }
```

## 5. uniform 赋值清单

转换规则（对齐 executor.js convertUniform）：float=`Number(v)`；vec2/vec3/color=空白分隔 split→Float32Array，单数字播撒；缺失→元注释 default→仍缺→不调（GL 默认 0）。`g_Time=(performance.now()−t0)/1000`。`getUniformLocation` 对被 #if 裁掉的 uniform 返回 null，uniformX(null) 是规范 no-op，统一赋值。

**g_TextureNResolution（候选 (a) 的赋值清单，非定案——以主计划 §6.4 判别实验为准）**：候选 (a) = `vec4(w,h,1/w,1/h)`：slot0=效果链输入 FBO 分辨率（=画布），slot1/2=绑定纹理分辨率。判别时**两效果必须用同一约定**（不得混用）；其余候选见主计划 §10.1。

**combo 判定（客户端）**：`MASK=1 ⟺ 该 pass 解析出的 mask 槽纹理非 null`；其余取元注释默认；pass.combos 存在则优先。

**g_TextureNResolution 约定为 Phase 0 判别实验对象**（见主计划 §9.4）：候选 (a) (w,h,1/w,1/h) (b) executor.js engineInject 的 (objW,objH,texW,texH) (c) 恒等。判别基线 = CPU 参考帧（用户已验收视觉正确）。注意：约定 (a) 下本场景 iris 为 no-op（mask UV≈texel(0,0)=黑）、wr-mask≡白；CPU iris 用纯 (u,v)（眼部有位移）——若官方语义使 iris 成 no-op 而 CPU 使其微动，以"原作视觉"为仲裁（原作者画了眼部 mask，意图是眼动）。

rad2deg 语义：CPU 直传弧度 → 元注释 `"conversion":"rad2deg"` 是编辑器 UI 显示元数据，GL 同样直传。

## 6. host 路由 schema

通用：GET-only（405）；token=base64url(abs path)；三路由 betaSceneAnim 403 门控；JSON `Cache-Control: no-store`。pkg 访问带 LRU 缓存（key=abs|mtime，cap 2）。

### 6.1 GET /wallpaper-engine/scene-gl-meta/<token>

200（as-built 实测响应，与计划稿两处偏差：① effects.textures 用**槽位数组**（忠实
pass.textures，null=链输入），role 关联由 scene-shader 的 textures 表（unit=槽位号）
承担；② 每条纹理为 `{path,width,height,headerWidth,headerHeight}`（mip0 + header，
lwe resolution 四元组直接可用）；③ 不可见效果在 gate 前已剔除，响应无 visible 字段）：

```json
{ "supported": true, "engine": "dsh-we-scene-gl/1",
  "scene": {
    "general": { "bloom": false, "hdr": false, "clearenabled": true,
                 "clearcolor": "0.70000 0.70000 0.70000", "ortho": { "width": 3840, "height": 2160 } },
    "camera": { "static": true },
    "objects": [{
      "name": "207电脑", "type": "image",
      "origin": [1920, 1080, 0], "size": [3840, 2160],
      "scale": [1, 1, 1], "angles": [0, 0, 0], "alpha": 1, "brightness": 1,
      "colorBlendMode": 0, "alignment": "", "blending": "translucent",
      "mainTexture": { "path": "materials/207电脑.tex", "width": 3840, "height": 2160,
                       "headerWidth": 3840, "headerHeight": 2160 },
      "effects": [
        { "dir": "waterripple",
          "textures": [ null,
                        { "path": "materials/masks/waterripple_mask_206a0206.tex",
                          "width": 1920, "height": 1080, "headerWidth": 1920, "headerHeight": 1080 },
                        { "path": "materials/effects/waterripplenormal.tex",
                          "width": 256, "height": 256, "headerWidth": 256, "headerHeight": 256 } ],
          "constants": { "animationspeed": 0.15000001, "ratio": 1, "ripplestrength": 0.1,
                         "scale": 1, "scrolldirection": 0, "scrollspeed": 0 },
          "combos": {} },
        { "dir": "iris",
          "textures": [ null,
                        { "path": "materials/masks/iris_mask_d44b353d.tex",
                          "width": 1920, "height": 1080, "headerWidth": 1920, "headerHeight": 1080 } ],
          "constants": { "noiseamount": 0.5, "phase": 0, "rough": 0.2, "scale": "1 1", "speed": 1 },
          "combos": {} }
      ] }] } }
```

不支持：200 `{"supported":false,"reason":"particles|camera-paths|bloom|hdr|effect:<dir>|passes>1|model|eye|zoom|anim|cbm|alignment|parallax"}`。纹理路径必须经 resolveSceneTexPath 解析成 pkg 完整路径再下发；每条纹理附 `{path,w,h}`（供 g_TextureNResolution）。

### 6.2 扩展现有 GET /wallpaper-engine/scene-resource/<token>/<path...>

- 解析链末尾追加 `resolveSceneTexPath(access, path)` 兜底（修掉短名 404）；路径含 `..` → 404。
- `.tex`：decodeTex 后按 kind——`jpeg`/`png-pass` 原样 bytes 透传（浏览器原生解码），`rgba` → encodePng。**422 仅作用于新增的 resolveSceneTexPath 兜底分支**（兜底命中但 decode 失败才 422）；既有 `extractSceneResourceVia` 的 catch-raw 行为原样保留（内嵌视频纹理/坏 tex/.json 原样透传，scene-player 回退路径依赖它——对齐主计划验收 7"只追加兜底不改前序行为"）。
- 需要 pkg-extract.js 导出 `resolveSceneTexPath`、`pkgSceneAccess`、`dirSceneAccess`（现未导出；松散目录分支必须同 fence——dirSceneAccess 的路径穿越防护）。

### 6.3 GET /wallpaper-engine/scene-shader/<token>/<effectDir>

- effectDir ∉ 白名单 → 404；pkg 缺 shader → 404。
- 只做 expandIncludes（内置 §1 两 stub），禁 preprocessShader；`#if` 原样保留。
- include 预检：`#include "x"` ∉ {common.h, common_perspective.h} → 422 `{"error":"include-not-found"}`。
- 200：`{ effect, engine, vert, frag, combos, uniforms, textures }`（完整示例见 git 历史或附录存档；uniforms 含 stage/engine/material/default/combo 字段，textures 含 role/stage/unit/combo）。
- role：slot0=source；元注释 `mode:"opacitymask"` → opacitymask；其余 aux；pass 纹理槽 null 时用 materials/effects/<dir>.json 默认材质补位（CPU 同款）。

parseMetaGL（新增，不动 CPU 路径的 parseMeta）：匹配 `[COMBO|COMBO_OFF]`、uniform 元注释保留 mode/combo/default/direction/conversion、纹理 combo 派生（MASK 无默认 → default '0' + textureUniform 标记）：

```js
export function parseMetaGL(source) {
  const combos = {};   // name -> { default, comboOff?, textureUniform? }
  const uniforms = {}; // name -> { material, type, mode?, combo?, default?, direction?, conversion? }
  let m;
  const comboRe = /\/\/\s*\[(COMBO|COMBO_OFF)\]\s*(\{[\s\S]*?\})/g;
  while ((m = comboRe.exec(source))) {
    try { const meta = JSON.parse(m[2]);
      if (meta.combo && meta.default !== undefined)
        combos[meta.combo] = { default: String(meta.default), comboOff: m[1] === 'COMBO_OFF' };
    } catch { /* 坏注释忽略 */ }
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[\s\S]*?\})/g;
  while ((m = unifRe.exec(source))) {
    let meta = {}; try { meta = JSON.parse(m[3]); } catch { /* keep {} */ }
    uniforms[m[2]] = { material: meta.material || null, type: m[1], ...meta };
    if (meta.combo && !combos[meta.combo])
      combos[meta.combo] = { default: '0', textureUniform: meta.mode === 'opacitymask' ? m[2] : null };
  }
  const plain = /uniform\s+([\w]+)\s+(\w+)\s*;/g;
  while ((m = plain.exec(source))) if (!uniforms[m[2]]) uniforms[m[2]] = { material: null, type: m[1] };
  return { combos, uniforms };
}
```

## 7. 客户端模块加载（build-client.mjs 拼接）

```js
const glSrc = readFileSync(resolve(root, 'src', 'scene-gl.js'), 'utf8');
const glBody = stripHeader(glSrc).replace(/\r\n/g, '\n').replace(/\n+$/, '');
outline.push('\t\tvar __WESceneGL = (function () {');
outline.push(glBody.split('\n').map((l) => (l.trim() === '' ? '' : '\t\t' + l)).join('\n'));
outline.push('\t\t})();');
outline.push(indented);   // 原 client.js body —— __WESceneGL 同 factory 作用域可见
```

`src/scene-gl.js` 约定：无 import/export 纯脚本片段；末行 `return { version: 1, createSceneGLRenderer };`；禁止声明 module/exports 或与 client.js 顶层重名；文件头 /** */ banner。版本 handshake：`__WESceneGL.version` vs meta.engine 次版本不符 → 回退 mp4 + console.warn。

## 8. 回退时序（状态机）

```
IDLE ──beta on & weSceneGL≠0 & 无 glFailed──▶ GL_TRY
GL_TRY ──GET scene-gl-meta（5s 超时）──┬─ supported=false / 403 / 超时 ──▶ MP4
                                      └─ supported ──▶ GL_INIT
GL_INIT（AbortController 贯穿全部 fetch；总 watchdog 12s）
  ① shader fetch + compile+link（失败快速退出，不下载纹理）
  ② 纹理 fetch ×3（各 10s）→ createImageBitmap(flipY) → texImage2D
GL_INIT ──首帧 rAF 渲染完成──▶ GL_RUN（此刻才挂载/显示 canvas，img 300ms CSS 淡出）
任一 GL 失败/超时 ──▶ 标记 glFailed(sessionStorage, per-wallpaper) → MP4（既有 probe+轮询）
任一状态 ──壁纸切换 / beta 关 / weSceneGL=0──▶ DISPOSED（不触发 mp4）
GL_RUN ──webglcontextlost──▶ dispose → contextrestored/短退避后重建一次 → 再失败 → MP4
GL_RUN ──document.hidden──▶ 停 rAF（时间基连续，恢复无跳变）
```

dispose 幂等：abort 在途 fetch → deleteTexture/Program/Framebuffer → loseContext。mp4 接管时同样 dispose GL。

## 9. spike（Phase 0）步骤

```
test/scene-gl-spike/
  index.html / spike.mjs / scene-data.mjs / extract-assets.mjs / render-ref.mjs / mad.mjs / assets/
```

命令序列：

```bash
node test/scene-gl-spike/extract-assets.mjs
node test/scene-gl-spike/render-ref.mjs 960 540 3.7        # CPU staticFrame 全分辨率参考帧
python3 -m http.server 8931 --directory test/scene-gl-spike
# 浏览器 http://127.0.0.1:8931/index.html?t=3.7 → Capture 下载 → mad.mjs 对比
```

mad.mjs：零依赖复用 decodePngBuffer，16 行分段 MAD 定位差异区。

判别实验清单（主计划 §6.4 引此）：① g_TextureNResolution 三约定各渲一帧对 CPU 帧（两效果必须同约定）；② angles=30° 合成用例定死旋转方向；③ REPEAT：uv+1.3 采样无黑缝；④ mask 区域集中差异时替换约定重试；⑤ **slot0（主图）CLAMP vs REPEAT 各渲一帧对 CPU ref**（主计划 §2.6——wrap 是引擎 sampler 状态、官方不可考，无独立官方证据时默认跟 CPU 的 clamp）。

## 10. 附带代码修订项（主计划引用）

1. pkg-extract.js 导出 resolveSceneTexPath/pkgSceneAccess/dirSceneAccess（3 个 export，零逻辑改动）；
2. parseMetaGL 新增于 preprocess.js（不动 CPU 用 parseMeta）；
3. syncLayers wantKey 加 GL 位；releaseLayerMedia 加 canvas/GL dispose 钩子；
4. queueSceneAnimUpgrade 内联的 w/h 计算抽 helper 复用；
5. docs/WE-REVERSE.md 补记：waterripple MASK UV 用 g_Texture2Resolution（normal 分辨率）的官方 quirk、CPU maskUV 近似约定、CPU 主图 clamp vs 官方 REPEAT 偏离。
6. **【Phase 0 新增】CPU 渲染器三处已修 bug**（WE-REVERSE.md §9.5）：Canvas.clear 无视参数、waterripple mask UV u·0.5→纯 uv、waterripple 法线 z 未解码。**用户可见影响**：修正后 mp4 路径上①留边/旋转场景的底色从黑变为 scene.json clearcolor、②波纹不再穿透头部保护区——二者均为 fidelity 修复但偏离此前"已验收视觉"，用户可单独回退。

## 11. Phase 0 spike 裁决回写（实测结论汇总）

**验收数据（GL WebGL2 + 官方 ES 1.00 原样编译 vs CPU staticFrame，960×540 t=3.7）**：
- 无效果地板 MAD 2.515（4:1 降采样滤波差，GL LINEAR 无 mip vs CPU 双线性）；1920×1080 全链 MAD **1.247 ≤2 通过**（960 全链 2.88 主要源自降采样滤波）。
- 亚像素偏移搜索 ≈ (0.16, 0.16) < 0.5px → **无整体上移**（早前 iris 上移 bug 无回归）。

**判别实验裁决**：
| # | 对象 | 裁决 | 证据 |
|---|---|---|---|
| ① | g_TextureNResolution | **lwe 约定 (mip0,mip0,header,header)** | 约定 a/b 使 iris mask 成 no-op（违背作者意图）；lwe 下 GL vs 修正后 CPU MAD 2.88/1.25 |
| ② | angles 旋转方向 | **弧度；正角=屏幕 CCW；像素空间刚体 S⁻¹RS** | 反旋拟合精确 30°/枢轴画布中心；附录 §4 回写 |
| ③ | REPEAT 无黑缝 | **构造性成立** | ripple 坐标 t=3.7 已跨 [0,1] 回绕，截图无黑缝、分段 MAD 均匀 |
| ④ | mask 区域集中差异 | **已解释并闭合** | 差异=CPU maskUV u·0.5 旧错误；CPU 修纯 uv 后 MAD 2.878（→地板） |
| ⑤ | slot0 wrap | **CLAMP（跟 CPU）** | REPEAT 对比差异仅边缘 1-2px 带（段0=7.6/段15=3.3，中段=0） |

**对 plan 的实测修正**（已回写附录对应节）：§2 int 字面量 fixup、§3 flipY→y-down 全链路、§4 angles 三定论、§3 slot0 CLAMP、主计划 §10 开放问题①关闭（g_TextureNResolution = lwe 约定）。

**冻结归因（主计划 §6.1，真 GPU 实测：DISPLAY=:1 系统 Chrome headed，各 10min）**：

| 配置 | 帧数 | p50/p95/p99/max (ms) | 结论 |
|---|---|---|---|
| ③ 主文档 canvas 无玻璃 | 36010 | 16.7/16.8/16.8/16.8 | 完美 vsync，零停顿 |
| ② 主文档 canvas + 玻璃面板（blur(16px) saturate(1.8)×3 复刻 client.js:3888） | 36009 | 16.7/16.8/16.8/33.3 | 玻璃对壁纸层帧时**零可测影响** |
| ① scene-player 代理（iframe + WebGL1 + antialias+depth+alpha） | 35998 | 16.7/16.8/16.8/16.8（宿主页 max 183.5 单尖峰） | 无冻结；宿主页全程可响应 |

**三配置均不复现冻结** → 按主计划"无复现决策规则"执行：依据 §2.8 差异设计 + `weSceneGL=0` 逃生门 + per-wallpaper glFailed 继续实施；**"玻璃开启 30s 帧时 P95 ≤ 20ms" 保持为 Phase 1 首项验收**（验收 3，真实 GUI 跑）。scene-player.js 旧冻结最可疑的剩余差异 = **每场景一 context（数量无上限、旧场景不 dispose）+ WebGL1+antialias:true+depth:true 高开销上下文 + 无 fpsCap**，本方案九项差异设计已逐项覆盖（单 context per-document、webgl2+aa:false+depth:false、dispose-on-switch、document.hidden 停 rAF）。

## 12. Phase 1 as-built 纪要（与附录计划稿的偏差 + 新增件）

**偏差（均已实测验收，附录原文保留备查）**：
1. **FBO 效果链分辨率 = 对象纹理空间**（本场景 3840×2160），非 §7 计划稿的 canvas 背板
   分辨率——对齐 CPU staticFrame 全分辨率效果链语义（非全屏对象天然正确），present pass
   负责缩放（LINEAR ≈ CPU blitScaled 双线性）；真 GPU 实测 4K 链 60fps vsync 锁定，性能
   无虞。§7 的 "1080p canvas × 2 全屏 pass" 是负载估算不是设计约束。
2. **meta effects.textures = 槽位数组**（见 §6.1 as-built 示例）；role 关联靠 scene-shader
   textures 表的 unit 字段。
3. **canvas 背板在 meta 到达后按 ortho 比例 sar fix**（启动时 2×2 占位，buildResources
   入口 resize 后再取 context），视口比例不一致时 CSS object-fit letterbox——与
   scene-anim 路由 h=w/sar 修正同语义。
4. **验收 ④ 采样窗 = 599 连续帧（≈10s @60fps）**，非字面 60s——页内降采样 readback
   流式算 MAD 不落盘；60s 覆盖由 ③ 的 5min soak（无 contextlost/pageerror）承担。

**新增件（计划稿未列，as-built 实现）**：
- `renderer.setPaused()/setFpsCap()/setPlaybackRate()`：syncLayers 按
  `isEffectivelyPlaying()` 同步暂停（遮挡暂停 WE 对齐，电池实测生效）；fpsCap 变更
  即时生效不重建（mp4 路径需分钟级重渲染，GL 零成本）；playbackRate 时间基重锚定
  无跳变（mp4 路径 video.playbackRate 同款用户控制）。
- `stats.initStage/lastT/frameTimes/contextLost/errors` + `window.__weSceneGL`
  诊断钩子（client.js trySceneGL/disposeSceneGL/onError 三处维护）——验收 ②③④⑥
  与线上排障共用。
- E2E 套件 `test/scene-gl-e2e/`：serve.mjs（静态+路由代理 harness）、capture.py
  （rAF 同帧原子取 (像素,lastT)——preserveDrawingBuffer:false 下 present 后缓冲即清，
  必须同帧读）、gui-e2e.py（headed 验收①③④⑥）、gui-e2e-5.py（验收⑤⑥b）。
- 设置 PUT 语义警示：**`/wallpaper-engine/settings` PUT 是全量替换不是合并**——
  任何自动化必须先 GET 合并再回写（裸 PUT 局部键会抹掉壁纸选择/玻璃/侧栏全部配置）。

**E2E 修出的 client 接线 bug（详见主计划 Phase 1 回填）**：ready 类幂等重挂 /
trySceneGL 补 emit / onError 清诊断钩子。
