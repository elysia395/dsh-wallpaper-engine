// WE GLSL 预处理: #include 展开 + combo 宏注入 + uniform material 映射解析
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js';

// 解析 shader 源码里的元注释:
//   // [COMBO] {"material":"...","combo":"KERNEL","default":0,...}  → combos 默认值
//   uniform <type> <name>; // {"material":"xxx",...}              → material→uniform 映射
export function parseMeta(source) {
  const combos = {}; // combo 名 → 默认值 (string)
  const uniforms = {}; // uniform 名 → { material, type }
  const comboRe = /\/\/\s*\[COMBO\]\s*(\{[\s\S]*?\})/g;
  let m;
  while ((m = comboRe.exec(source))) {
    try {
      const meta = JSON.parse(m[1]);
      if (meta.combo && meta.default !== undefined) combos[meta.combo] = String(meta.default);
    } catch {}
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[\s\S]*?\})/g;
  while ((m = unifRe.exec(source))) {
    try {
      const meta = JSON.parse(m[3]);
      if (meta.material) uniforms[m[2]] = { material: meta.material, type: m[1] };
    } catch {}
  }
  // 无注释的 uniform 也收集 (引擎注入类, material=null)
  const unifPlain = /uniform\s+([\w]+)\s+(\w+)\s*;/g;
  while ((m = unifPlain.exec(source))) {
    if (!uniforms[m[2]]) uniforms[m[2]] = { material: null, type: m[1] };
  }
  return { combos, uniforms };
}

// include 展开: resolveInclude(rel) → 源码字符串
export function expandIncludes(source, resolveInclude, seen = new Set()) {
  const re = /#include\s+"([^"]+)"/g;
  let out = source;
  let m;
  while ((m = re.exec(source))) {
    const inc = m[1];
    if (seen.has(inc)) { out = out.replace(m[0], ''); continue; }
    seen.add(inc);
    let src = '';
    try { src = resolveInclude(inc); } catch {}
    if (!src) { out = out.replace(m[0], ''); continue; }
    src = expandIncludes(src, resolveInclude, seen);
    out = out.replace(m[0], '\n' + src + '\n');
  }
  return out;
}

// 完整预处理: include 展开 → combo defines 注入 → shaderfrog preprocess
export function preprocessShader(source, { defines = {}, resolveInclude = null } = {}) {
  let src = source;
  if (resolveInclude) src = expandIncludes(src, resolveInclude);
  // 若 combo 无默认且未注入 → 显式补 0 避免 #if 未定义报错
  const meta = parseMeta(src);
  const allDefines = {};
  for (const [k, v] of Object.entries(meta.combos)) {
    if (defines[k] === undefined) allDefines[k] = v;
  }
  Object.assign(allDefines, defines);
  return preprocess(src, { defines: allDefines });
}

// ---- GL 路径专用（scene-gl）：客户端拼 define 头用，host 绝不求值 #if ----
// parseMetaGL 与 CPU 路径 parseMeta 并存：保留 mode/combo/default/direction/conversion
// 全字段 + [COMBO_OFF] + 纹理派生 combo（MASK 无默认元注释 → default '0' + textureUniform）。
// 附录 §6.3 全文定稿。
export function parseMetaGL(source) {
  const combos = {};   // name -> { default, comboOff?, textureUniform? }
  const uniforms = {}; // name -> { material, type, mode?, combo?, default?, direction?, conversion? }
  let m;
  const comboRe = /\/\/\s*\[(COMBO|COMBO_OFF)\]\s*(\{[\s\S]*?\})/g;
  while ((m = comboRe.exec(source))) {
    try {
      const meta = JSON.parse(m[2]);
      if (meta.combo && meta.default !== undefined)
        combos[meta.combo] = { default: String(meta.default), comboOff: m[1] === 'COMBO_OFF' };
    } catch { /* 坏注释忽略 */ }
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[\s\S]*?\})/g;
  while ((m = unifRe.exec(source))) {
    let meta = {};
    try { meta = JSON.parse(m[3]); } catch { /* keep {} */ }
    uniforms[m[2]] = { material: meta.material || null, type: m[1], ...meta };
    if (meta.combo && !combos[meta.combo])
      combos[meta.combo] = { default: '0', textureUniform: meta.mode === 'opacitymask' ? m[2] : null };
  }
  const plain = /uniform\s+([\w]+)\s+(\w+)\s*;/g;
  while ((m = plain.exec(source))) if (!uniforms[m[2]]) uniforms[m[2]] = { material: null, type: m[1] };
  return { combos, uniforms };
}

// ---- shake.frag 旧版锯齿数学修正（sf35）─────────────────────────────────────
// 背景: 2023 前后 pkg 捆绑的 shake.frag 把相位裁到 [0, π/2):
//   offset = sin(frac(time / M_PI_2) * M_PI_2)   ← sin 在段边界从 ~1 跳回 0
// 每 π/2/speed 秒产生一次硬跳变（本机实测 1080p 人物区 ~2.7px 瞬移 = "闪动"）。
// 官方已在后续引擎版本修复（Steam 讨论帖, WE 作者 Biohazard 确认的最终形态）:
// 时间切片 frac(T·w)·6.28 — 相位走完整 2π, sin(0)=sin(2π) 回绕连续 → 平滑往返。
// 官方翻译新增 ui_editor_properties_shake_phase 亦证实现行 shader ≠ 旧快照。
// 本函数: 检测旧版特征 → 替换为 2π 连续公式; 已是新版（含 6.28 切片/phase）不动。
const SHAKE_OLD_NOISE0 = /\bfloat\s+time\s*=\s*g_Speed\s*\*\s*g_Time\s*\+\s*flowPhase\s*;[\s\S]*?\boffset\s*=\s*sin\s*\(\s*frac\s*\(\s*time\s*\/\s*M_PI_2\s*\)\s*\*\s*M_PI_2\s*\)/;
const SHAKE_OLD_NOISE1 = /vec4\s+sines\s*=\s*flowPhase\s*\+\s*frac\s*\(\s*g_Speed\s*\*\s*g_Time\s*\/\s*M_PI_2\s*\*\s*vec4\s*\(/;
export function patchShakeFrag(frag) {
  let out = frag, patched = [];
  // NOISE=0 路径: time 切片 6.28 + sin(time) 完整正弦
  if (SHAKE_OLD_NOISE0.test(out)) {
    out = out.replace(
      /\bfloat\s+time\s*=\s*g_Speed\s*\*\s*g_Time\s*\+\s*flowPhase\s*;/,
      'float time = frac(g_Speed * g_Time / 6.28) * 6.28 + flowPhase; // sf35: 2π 切片 (官方修复, 回绕连续)',
    );
    out = out.replace(
      /\boffset\s*=\s*sin\s*\(\s*frac\s*\(\s*time\s*\/\s*M_PI_2\s*\)\s*\*\s*M_PI_2\s*\)\s*;/,
      'offset = sin(time); // sf35: 完整正弦 (sin(0)=sin(2π) 连续)',
    );
    patched.push('noise0');
  }
  // NOISE=1 路径: 同款 6.28 切片 (各分量 sin 回绕连续)
  if (SHAKE_OLD_NOISE1.test(out)) {
    out = out.replace(
      /vec4\s+sines\s*=\s*flowPhase\s*\+\s*frac\s*\(\s*g_Speed\s*\*\s*g_Time\s*\/\s*M_PI_2\s*\*\s*(vec4\s*\([^)]*\))\s*\)\s*\*\s*M_PI_2\s*;/,
      'vec4 sines = flowPhase + frac(g_Speed * g_Time * $1) * 6.28; // sf35: 2π 切片 (官方修复)',
    );
    patched.push('noise1');
  }
  return { frag: out, patched };
}
