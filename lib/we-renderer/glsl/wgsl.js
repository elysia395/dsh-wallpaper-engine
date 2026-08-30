// WE GLSL 方言 → WGSL compute 发射器 (v1)
// 输入: preprocessShader 后的 fragment GLSL 的 shaderfrog AST
// 输出: WGSL compute shader 源码字符串 (逐像素执行片段, 与 CPU 解释器同语义)
//
// v1 范围 (内置单 pass 效果): 全 float 运算, 无循环/数组/out-inout 函数/mat 类型。
// 采样: texSample2D → textureSampleLevel(…, 0.0) (compute 阶段必须显式 lod; 双线性,
//       与 WebGL GPU 路径同语义)。
// 类型策略: 数值字面量统一加 .0 (float 上下文); vecN → vecNf; rgba swizzle → xyzw;
//       swizzle 赋值重建整个向量; float 条件包 != 0.0; 三元 → select(f, t, c)。
// uniform: sampler2D → @binding(N) texture; 标量/vec uniform → 扁平 array<f32> 槽位
//      (fn u_<name>() 访问, vec 由连续槽位构造 — 规避 WGSL uniform 16B 对齐)。
//
// 用法:
//   const wgsl = emitWgsl(ast, {
//     varyings: { v_TexCoord: 'vec4f(uv.x, uv.y, uv.x, uv.y)' },  // 可引用 uv/fx/fy/x/y
//     uniformSlots: { g_Time: 0, g_Speed: 1 },                    // 名 → params 槽位
//     totalSlots: 9,                                              // params 长度 (含 sizeX/Y)
//     textures: ['g_Texture0', ...],                              // sampler2D 名 (绑定序)
//   });

const VEC = { vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i', ivec3: 'vec3i', ivec4: 'vec4i' };
const VEC_N = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4 };
const SWZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };
const SCALARS = new Set(['float', 'int', 'uint', 'bool', 'double']);
// 直接同名可用的 WGSL 内置 (f32/vec 泛型, 参数顺序与 GLSL 一致)
const WGSL_FNS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'floor', 'ceil', 'sign',
  'sqrt', 'pow', 'exp', 'log', 'max', 'min', 'dot', 'normalize', 'length', 'distance',
  'cross', 'clamp', 'step', 'smoothstep', 'mix', 'fract', 'radians', 'degrees',
  'inversesqrt', 'trunc', 'round', 'isnan', 'isinf', 'select', 'fma',
]);
// GLSL 名 → WGSL 表达式模板 ($0, $1... 参数)
const GLSL_TO_WGSL = {
  saturate: 'clamp($0, 0.0, 1.0)',
  lerp: 'mix($0, $1, $2)',
  mod: '($0 - $1 * floor($0 / $1))',
  frac: 'fract($0)',
  rotateVec2: 'vec2f(($0).x * cos($1) - ($0).y * sin($1), ($0).x * sin($1) + ($0).y * cos($1))',
  rotateVec3: 'vec3f(($0).x * cos($1) - ($0).y * sin($1), ($0).x * sin($1) + ($0).y * cos($1), ($0).z)',
  texSample2D: 'textureSampleLevel($TEX, samp0, $0, 0.0)',
  texture2D: 'textureSampleLevel($TEX, samp0, $0, 0.0)',
  texture2DLod: 'textureSampleLevel($TEX, samp0, $0, $1)',
  mul: '($0)',
};

export function emitWgsl(ast, opts = {}) {
  const e = new WgslEmitter(ast, opts);
  return e.generate();
}

// 自动计算 uniform 槽位 (非 sampler, 声明序; 标量 1 槽, vecN N 槽) 并发射。
// 返回 { wgsl, slots, totalSlots } — 供 Dawn 后端构建 uniform buffer (单一事实源,
// 避免发射器与后端槽位分配不一致)。
export function emitWgslWithSlots(ast, opts = {}) {
  const e = new WgslEmitter(ast, opts);
  const slots = {};
  let slot = 0;
  for (const node of ast.program || []) {
    if (node.type !== 'declaration_statement') continue;
    const dl = node.declaration;
    if (!dl || dl.type !== 'declarator_list') continue;
    const type = e.typeOf(dl.specified_type);
    if (type === 'sampler2D' || type === 'samplerCube') continue;
    const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
    if (!quals.includes('uniform')) continue;
    for (const d of dl.declarations || []) {
      if (d.type !== 'declaration') continue;
      slots[d.identifier.identifier] = slot;
      slot += VEC_N[type] || 1;
    }
  }
  const wgsl = e.generateWithSlots(slots, slot);
  return { wgsl, slots, totalSlots: slot };
}

class WgslEmitter {
  constructor(ast, opts) {
    this.ast = ast;
    this.opts = opts;
    this.globals = {};   // name -> { type, kind } (kind: uniform/varying/global)
    this.locals = {};    // 当前函数局部
    this.functions = new Set(); // 用户函数名
    this.fnReturns = {}; // 用户函数返回类型
    this.collect();
  }

  typeOf(spec) {
    if (!spec) return null;
    let s = spec;
    while (s && typeof s === 'object' && !s.token && s.specifier) s = s.specifier;
    return s && s.token ? s.token : null;
  }

  collect() {
    for (const node of this.ast.program || []) {
      if (node.type === 'declaration_statement') {
        const dl = node.declaration;
        if (!dl || dl.type !== 'declarator_list') continue;
        const type = this.typeOf(dl.specified_type);
        const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
        const kind = quals.includes('uniform') ? 'uniform'
          : quals.includes('varying') ? 'varying'
          : quals.includes('attribute') ? 'attribute' : 'global';
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          this.globals[d.identifier.identifier] = { type, kind };
        }
      } else if (node.type === 'function') {
        const name = node.prototype.header.name.identifier;
        if (name !== 'main') this.functions.add(name);
        const rt = this.typeOf(node.prototype.header.returnType);
        if (rt && rt !== 'void') this.fnReturns[name] = rt;
      }
    }
  }

  // ── WGSL 类型 ──
  wtype(t) {
    if (!t) return 'f32';
    if (t === 'float') return 'f32';
    if (t === 'int') return 'i32';
    if (t === 'uint') return 'u32';
    if (t === 'bool') return 'bool';
    if (VEC[t]) return VEC[t];
    return 'f32';
  }

  // ── 生成 ──
  generate() {
    return this.generateWithSlots(this.opts.uniformSlots || {}, this.opts.totalSlots || 0);
  }

  generateWithSlots(slots, totalSlots) {
    const out = [];
    const textures = this.opts.textures || [];
    // 纹理绑定 + **per-texture 采样器** (samp0..sampN-1): 不同纹理可绑不同
    // 过滤 (如 waterwaves: 源纹理最近邻对齐 CPU floor, mask 双线性对齐 _texSample)。
    textures.forEach((tname, i) => {
      out.push(`@group(0) @binding(${i}) var tex${i}: texture_2d<f32>;`);
    });
    textures.forEach((tname, i) => {
      out.push(`@group(0) @binding(${textures.length + i}) var samp${i}: sampler;`);
    });
    const total = totalSlots || 0;
    out.push(`@group(0) @binding(${textures.length * 2}) var<uniform> params: array<f32, ${total}>;`);
    out.push(`@group(0) @binding(${textures.length * 2 + 1}) var<storage, read_write> outBuf: array<u32>;`);
    out.push('');
    // uniform 访问 helper (名 → 槽位)
    for (const [name, info] of Object.entries(this.globals)) {
      if (info.kind !== 'uniform' || info.type === 'sampler2D') continue;
      const off = slots[name];
      if (off === undefined) continue;
      const t = info.type;
      if (SCALARS.has(t)) out.push(`fn u_${name}() -> f32 { return params[${off}]; }`);
      else if (VEC_N[t]) {
        const parts = [];
        for (let i = 0; i < VEC_N[t]; i++) parts.push(`params[${off + i}]`);
        out.push(`fn u_${name}() -> ${VEC[t]} { return ${VEC[t]}(${parts.join(', ')}); }`);
      }
    }
    // 用户函数
    for (const node of this.ast.program || []) {
      if (node.type === 'function' && node.prototype.header.name.identifier !== 'main') {
        out.push(this.functionCode(node));
      }
    }
    // main
    out.push(this.mainCode());
    return out.join('\n');
  }

  functionCode(node) {
    const proto = node.prototype;
    const name = proto.header.name.identifier;
    const params = proto.parameters || [];
    this.locals = {};
    for (const p of params) this.locals[p.identifier.identifier] = this.typeOf(p.specifier);
    for (const d of this.collectLocals(node.body)) this.locals[d[0]] = d[1];
    // v1: 标量参数一律 f32 (目标 shader 无真正的 int 运算; GLSL int 参数如
    // ApplyBlending 的 const int blendMode 在 #if 预求值后不被使用)
    const pList = params.map((p) => {
      const t = this.typeOf(p.specifier);
      return `${p.identifier.identifier}: ${VEC_N[t] ? this.wtype(t) : 'f32'}`;
    }).join(', ');
    const ret = this.typeOf(proto.header.returnType);
    const retStr = ret && ret !== 'void' ? ` -> ${this.wtype(ret)}` : '';
    // WGSL 参数不可变且不能遮蔽 — GLSL 参数是可修改的局部副本 → 复制为
    // var <name>_m 并在函数体内引用处重命名 (this.rename 须在 body 发射前设置)。
    this.rename = {};
    const copies = params.map((p) => {
      const t = this.typeOf(p.specifier);
      const wt = VEC_N[t] ? this.wtype(t) : 'f32';
      this.rename[p.identifier.identifier] = `${p.identifier.identifier}_m`;
      return `var ${p.identifier.identifier}_m: ${wt} = ${p.identifier.identifier};`;
    }).join('\n');
    // 顶部 return 后的语句丢弃 (GLSL #if 分支残留死代码; WGSL 拒绝不可达代码)
    const bodyStmts = (node.body && node.body.statements) || [];
    const live = [];
    for (const s of bodyStmts) {
      live.push(s);
      if (s.type === 'return_statement') break;
    }
    const body = live.map((s) => this.stmt(s)).filter((s) => s !== '').join('\n');
    this.locals = {};
    this.rename = null;
    return `fn ${name}(${pList})${retStr} {\n${copies}\n${body}\n}`;
  }

  collectLocals(body) {
    const found = [];
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'declaration_statement') {
        const dl = n.declaration;
        if (dl && dl.type === 'declarator_list') {
          const type = this.typeOf(dl.specified_type);
          for (const d of dl.declarations || []) {
            if (d.type === 'declaration') found.push([d.identifier.identifier, type]);
          }
        }
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) for (const c of v) visit(c);
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(body);
    return found;
  }

  // ── 语句 ──
  stmt(node) {
    if (!node) return '';
    switch (node.type) {
      case 'compound_statement':
        return (node.statements || []).map((s) => this.stmt(s)).filter((s) => s !== '').join('\n');
      case 'declaration_statement': {
        const dl = node.declaration;
        const type = this.typeOf(dl.specified_type);
        const out = [];
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          const nm = d.identifier.identifier;
          const isVec = !!VEC_N[type];
          const init = d.initializer ? this.expr(d.initializer) : null;
          const initVec = init ? VEC_N[init.type] : 0;
          let code;
          if (init && !isVec && initVec) {
            // 标量声明带 vec 初始化器 (WE 宽容: float x = v.xy 隐式取 .x)
            code = `var ${nm}: ${this.wtype(type)} = ${init.code}.x;`;
          } else if (isVec && init && initVec) {
            code = `var ${nm}: ${this.wtype(type)} = ${init.code};`;
          } else if (isVec && init) {
            // 标量初始化 vec → 广播
            code = `var ${nm}: ${this.wtype(type)} = ${this.wtype(type)}(${init.code});`;
          } else if (init) {
            code = `var ${nm}: ${this.wtype(type)} = ${this.coerce(init.code, type)};`;
          } else {
            code = `var ${nm}: ${this.wtype(type)} = ${VEC_N[type] ? `${this.wtype(type)}(0.0)` : this.wtype(type) === 'bool' ? 'false' : '0.0'};`;
          }
          out.push(code);
        }
        return out.join('\n');
      }
      case 'expression_statement': {
        const n = node.expression;
        if (n && n.type === 'assignment') return this.assignStmt(n);
        return `${this.expr(n).code};`;
      }
      case 'if_statement': {
        const cond = this.expr(node.condition);
        const condCode = cond.type === 'bool' ? cond.code : `(${cond.code} != 0.0)`;
        let out = `if (${condCode}) {\n${this.stmt(node.body)}\n}`;
        if (node.else) {
          const elseArr = Array.isArray(node.else) ? node.else : [node.else];
          const elseBody = elseArr.filter((n) => n && n.type !== 'keyword' && n.type !== 'literal');
          if (elseBody.length) out += ` else {\n${elseBody.map((s) => this.stmt(s)).join('\n')}\n}`;
        }
        return out;
      }
      case 'return_statement':
        if (!node.expression) return 'return;';
        return `return ${this.expr(node.expression).code};`;
      case 'for_statement':
        // v1 不支持循环 (内置单 pass 效果无循环)
        return '/* for unsupported in wgsl v1 */';
      case 'break_statement': return 'break;';
      case 'continue_statement': return 'continue;';
      default:
        return '/* stmt ' + node.type + ' */';
    }
  }

  // ── 赋值 (含 swizzle 左值重建) ──
  assignStmt(node) {
    const left = node.left;
    const op = node.operator.literal;
    const rhs = this.expr(node.right);
    const swz = this.swizzleOf(left);
    const base = this.baseName(left);
    if (swz && swz.length >= 1 && base) {
      const lt = this.typeOfName(base);
      const n = VEC_N[lt] || 0;
      if (swz.length === 1 && n > 1) {
        // 单分量: v[c] op= e (WGSL 允许常量索引向量左值)
        const c = swz[0];
        return `${base}[${c}] ${op} ${rhs.code};`;
      }
      if (n > 1 && swz.length < n) {
        // 部分 swizzle 赋值 → 重建整个向量 (复合运算符展开为普通算术)
        return this.swizzleAssign(base, lt, swz, op, rhs);
      }
      // 全分量 swizzle: v.xyzw = e → v = e; v.xyzw += e → v += e (vec 复合赋值合法)
      if (op === '=') return `${base} = ${rhs.code};`;
      return `${base} ${op} ${rhs.code};`;
    }
    if (op === '=') return `${base} = ${this.coerce(rhs.code, this.typeOfName(base))};`;
    // 复合赋值 (op 已含 '=': += -= *= /=)
    return `${base} ${op} ${rhs.code};`;
  }

  swizzleAssign(base, lt, swz, op, rhs) {
    const n = VEC_N[lt] || 4;
    const plain = { '=': null, '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%' }[op];
    const parts = [];
    for (let i = 0; i < n; i++) {
      const idx = swz.indexOf(i);
      if (idx >= 0) {
        const rc = idx < (rhs.type && VEC_N[rhs.type] ? VEC_N[rhs.type] : 1) ? `${rhs.code}[${idx}]` : rhs.code;
        parts.push(plain ? `${base}[${i}] ${plain} ${rc}` : rc);
      } else {
        parts.push(`${base}[${i}]`);
      }
    }
    return `${base} = ${this.wtype(lt)}(${parts.join(', ')});`;
  }

  baseName(node) {
    if (!node) return null;
    if (node.type === 'identifier') {
      const nm = node.identifier;
      return this.rename && this.rename[nm] ? this.rename[nm] : nm;
    }
    if (node.type === 'postfix') return this.baseName(node.expression);
    return null;
  }

  swizzleOf(node) {
    if (!node || node.type !== 'postfix') return null;
    const pf = node.postfix;
    if (pf && pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel && sel.split('').every((c) => SWZ[c] !== undefined)) {
        return sel.split('').map((c) => SWZ[c]);
      }
    }
    return null;
  }

  typeOfName(name) {
    if (this.locals && this.locals[name]) return this.locals[name];
    if (this.globals[name]) return this.globals[name].type;
    return null;
  }

  coerce(code, type) {
    if (!type || SCALARS.has(type) || VEC_N[type]) return code;
    return code;
  }

  // ── 表达式 (返回 {code, type}) ──
  expr(node) {
    if (!node) return { code: '0.0', type: 'float' };
    switch (node.type) {
      case 'identifier': {
        const nm = node.identifier;
        if (this.rename && this.rename[nm]) {
          return { code: this.rename[nm], type: this.typeOfName(nm) };
        }
        if (this.globals[nm] && this.globals[nm].kind === 'uniform') {
          const t = this.globals[nm].type;
          return { code: `u_${nm}()`, type: t };
        }
        return { code: nm, type: this.typeOfName(nm) || (this.globals[nm] ? this.globals[nm].type : null) };
      }
      case 'int_constant':
        return { code: `${node.token}.0`, type: 'float' };
      case 'float_constant':
        return { code: node.token, type: 'float' };
      case 'bool_constant':
        return { code: node.token, type: 'bool' };
      case 'literal': {
        const v = node.literal;
        if (/^[0-9.eE+-]+$/.test(v)) return { code: /\./.test(v) ? v : `${v}.0`, type: 'float' };
        return { code: '0.0', type: 'float' };
      }
      case 'binary':
        return this.binaryExpr(node);
      case 'unary': {
        const inner = this.expr(node.expression);
        const op = node.operator.literal;
        if (op === '-') return { code: `(-${inner.code})`, type: inner.type };
        if (op === '!') return { code: `(!${inner.code})`, type: 'bool' };
        return { code: `(${op}${inner.code})`, type: inner.type };
      }
      case 'ternary': {
        const c = this.expr(node.expression);
        const a = this.expr(node.left);
        const b = this.expr(node.right);
        const cc = c.type === 'bool' ? c.code : `(${c.code} != 0.0)`;
        return { code: `select(${b.code}, ${a.code}, ${cc})`, type: a.type || b.type || 'float' };
      }
      case 'group':
        return this.expr(node.expression);
      case 'function_call':
        return this.callExpr(node);
      case 'postfix':
        return this.postfixExpr(node);
      case 'index': {
        const b = this.expr(node.expression);
        const idx = this.expr(node.index);
        return { code: `${b.code}[${idx.code}]`, type: 'float' };
      }
      default:
        return { code: '0.0', type: 'float' };
    }
  }

  postfixExpr(node) {
    const base = this.expr(node.expression);
    const pf = node.postfix;
    if (pf && pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel && sel.length >= 1 && sel.split('').every((c) => SWZ[c] !== undefined)) {
        // 结果类型按分量数: xy→vec2, xyz→vec3, x→float
        const outType = sel.length === 1 ? 'float' : `vec${sel.length}`;
        return { code: `${base.code}.${sel.split('').map((c) => this.swzChar(c)).join('')}`, type: outType };
      }
      return { code: `${base.code}.${sel}`, type: base.type };
    }
    if (pf && (pf.type === 'index' || pf.type === 'quantifier')) {
      const idx = this.expr(pf.expression || pf.index);
      return { code: `${base.code}[${idx.code}]`, type: 'float' };
    }
    return base;
  }

  swzChar(c) { return { r: 'x', g: 'y', b: 'z', a: 'w', s: 'x', t: 'y', p: 'z', q: 'w' }[c] || c; }

  binaryExpr(node) {
    const l = this.expr(node.left);
    const r = this.expr(node.right);
    const op = node.operator.literal;
    if (op === '&&' || op === '||') return { code: `(${l.code} ${op} ${r.code})`, type: 'bool' };
    if (op === '<' || op === '>' || op === '<=' || op === '>=') return { code: `(${l.code} ${op} ${r.code})`, type: 'bool' };
    if (op === '==' || op === '!=') return { code: `(${l.code} ${op} ${r.code})`, type: 'bool' };
    // 标量/vec 混合: WGSL 需要同类型 — vec op 标量时广播
    const ln = VEC_N[l.type], rn = VEC_N[r.type];
    if (ln || rn) {
      const vt = ln ? l.type : r.type;
      const n = ln || rn;
      const parts = [];
      for (let i = 0; i < n; i++) {
        const li = ln ? `${l.code}[${i}]` : l.code;
        const ri = rn ? `${r.code}[${i}]` : r.code;
        parts.push(`(${li} ${op} ${ri})`);
      }
      return { code: `${this.wtype(vt)}(${parts.join(', ')})`, type: vt };
    }
    return { code: `(${l.code} ${op} ${r.code})`, type: 'float' };
  }

  callExpr(node) {
    let name = null;
    if (node.identifier) {
      if (node.identifier.type === 'identifier') name = node.identifier.identifier;
      else if (node.identifier.type === 'type_specifier') {
        const sp = node.identifier.specifier;
        if (sp) {
          if (sp.token) name = sp.token;
          else if (sp.identifier) name = sp.identifier;
          else if (sp.specifier) name = sp.specifier.token || (sp.specifier.specifier && sp.specifier.specifier.token);
        }
      }
    }
    const args = (node.args || []).filter((a) => a && a.type !== 'literal');
    const a = args.map((x) => this.expr(x));
    if (!name) return { code: a.length ? a[0].code : '0.0', type: 'float' };
    // vec 构造
    if (VEC[name]) {
      const n = VEC_N[name];
      const flat = [];
      for (const ai of a) {
        const an = VEC_N[ai.type] || 1;
        for (let k = 0; k < an && flat.length < n; k++) flat.push(an === 1 ? ai.code : `${ai.code}[${k}]`);
      }
      while (flat.length < n) flat.push('0.0');
      return { code: `${VEC[name]}(${flat.slice(0, n).join(', ')})`, type: name };
    }
    // CAST2/3/4 (广播/逐分量 vec 构造 — common_blending.h 等)
    if (name === 'CAST2' || name === 'CAST3' || name === 'CAST4') {
      const n = name === 'CAST2' ? 2 : name === 'CAST3' ? 3 : 4;
      const flat = [];
      for (const ai of a) {
        const an = VEC_N[ai.type] || 1;
        for (let k = 0; k < an && flat.length < n; k++) flat.push(an === 1 ? ai.code : `${ai.code}[${k}]`);
      }
      while (flat.length < n) flat.push('0.0');
      return { code: `vec${n}f(${flat.slice(0, n).join(', ')})`, type: `vec${n}` };
    }
    // 内置/引擎函数
    if (name === 'texSample2D' || name === 'texture2D' || name === 'texture2DLod') {
      // 第 0 参 = 纹理名 (identifier) → 绑定 texN
      const texArg = args[0];
      const texName = texArg && texArg.type === 'identifier' ? texArg.identifier : '';
      const texIdx = (this.opts.textures || []).indexOf(texName);
      const uv = a[1] ? a[1].code : 'vec2f(0.0)';
      const lod = a[2] ? a[2].code : '0.0';
      const tmpl = name === 'texture2DLod' ? 'textureSampleLevel($TEX, $SAMP, $0, $1)' : 'textureSampleLevel($TEX, $SAMP, $0, 0.0)';
      const code = tmpl.replace('$TEX', `tex${Math.max(0, texIdx)}`).replace('$SAMP', `samp${Math.max(0, texIdx)}`).replace('$0', uv).replace('$1', lod);
      return { code, type: 'vec4' };
    }
    if (GLSL_TO_WGSL[name]) {
      const tmpl = GLSL_TO_WGSL[name];
      let code = tmpl;
      a.forEach((ai, i) => { code = code.replace(new RegExp(`\\$${i}`, 'g'), ai.code); });
      return { code, type: this.builtinReturnType(name, a) };
    }
    if (WGSL_FNS.has(name)) {
      // WGSL 不允许 vec+scalar 混合参数 (GLSL 自动广播) → 标量参数广播为 vec
      let args = a.map((x) => x.code);
      if (name === 'clamp' || name === 'min' || name === 'max') {
        const vecType = (a.find((x) => VEC_N[x.type]) || {}).type;
        if (vecType) args = a.map((x) => (VEC_N[x.type] ? x.code : `${this.wtype(vecType)}(${x.code})`));
      } else if ((name === 'step' || name === 'smoothstep') && a[1] && VEC_N[a[1].type]) {
        const vt = a[1].type;
        args = a.map((x, i) => (i < 2 && !VEC_N[x.type] ? `${this.wtype(vt)}(${x.code})` : x.code));
      }
      return { code: `${name}(${args.join(', ')})`, type: this.builtinReturnType(name, a) };
    }
    if (this.functions.has(name)) {
      return { code: `${name}(${a.map((x) => x.code).join(', ')})`, type: this.fnReturns[name] || 'float' };
    }
    return { code: a.length ? a[0].code : '0.0', type: 'float' };
  }

  // 内置函数返回类型推断 (vec 构造/分量展开需要)
  builtinReturnType(name, args) {
    const t0 = args[0] ? args[0].type : null;
    const t1 = args[1] ? args[1].type : null;
    if (name === 'dot' || name === 'length' || name === 'distance' || name === 'isnan' || name === 'isinf') return 'float';
    if (name === 'cross') return 'vec3';
    if (name === 'texSample2D' || name === 'texture2D' || name === 'texture2DLod') return 'vec4';
    if (name === 'normalize') return t0 || 'float';
    if (name === 'rotateVec2') return 'vec2';
    if (name === 'rotateVec3') return 'vec3';
    if (name === 'mix' || name === 'lerp') return t0 || 'float';
    if (name === 'step' || name === 'smoothstep') return t1 || t0 || 'float';
    if (name === 'saturate' || name === 'clamp' || name === 'min' || name === 'max' || name === 'abs' || name === 'floor' || name === 'ceil' || name === 'fract' || name === 'frac' || name === 'mod' || name === 'pow' || name === 'exp' || name === 'log' || name === 'sqrt' || name === 'sign' || name === 'sin' || name === 'cos' || name === 'tan' || name === 'asin' || name === 'acos' || name === 'atan' || name === 'atan2' || name === 'radians' || name === 'degrees' || name === 'mul') return t0 || 'float';
    return 'float';
  }

  mainCode() {
    const out = [];
    const sx = this.opts.sizeX || 0, sy = this.opts.sizeY || 0;
    out.push('@compute @workgroup_size(64)');
    out.push('fn main(@builtin(global_invocation_id) gid: vec3<u32>) {');
    out.push(`  let sizeXf: f32 = ${sx}.0;`);
    out.push(`  let sizeYf: f32 = ${sy}.0;`);
    out.push('  let i = gid.y * u32(sizeXf) + gid.x;');
    out.push('  if (gid.x >= u32(sizeXf) || gid.y >= u32(sizeYf)) { return; }');
    out.push('  let fx = f32(gid.x);');
    out.push('  let fy = f32(gid.y);');
    out.push('  let uv = vec2f((fx + 0.5) / sizeXf, (fy + 0.5) / sizeYf);');
    // varying 声明
    const varyings = this.opts.varyings || {};
    for (const [name, info] of Object.entries(this.globals)) {
      if (info.kind !== 'varying') continue;
      const exprTpl = varyings[name];
      if (exprTpl !== undefined) {
        out.push(`  var ${name}: ${this.wtype(info.type)} = ${exprTpl};`);
      } else {
        out.push(`  var ${name}: ${this.wtype(info.type)} = ${this.wtype(info.type)}(0.0);`);
      }
    }
    out.push('  var gl_FragColor: vec4f = vec4f(0.0);');
    // main 函数体 (AST 中的 main) — 先收集 locals 供类型推断 (vec-scalar 展开等)
    for (const node of this.ast.program || []) {
      if (node.type === 'function' && node.prototype.header.name.identifier === 'main') {
        this.locals = {};
        for (const d of this.collectLocals(node.body)) this.locals[d[0]] = d[1];
        const body = this.stmt(node.body);
        this.locals = {};
        if (body) out.push(body);
      }
    }
    out.push('  outBuf[i] = pack4x8unorm(gl_FragColor);');
    out.push('}');
    return out.join('\n');
  }
}
