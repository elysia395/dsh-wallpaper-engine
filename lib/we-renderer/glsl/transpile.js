// WE GLSL AST → JS 转译器 (基于 @shaderfrog/glsl-parser AST)
// 输出: 一段 JS 代码字符串, 由 new Function('__u','__v','__a','__rt', code + '; return exports;') 装配。
//   __u: uniforms 对象; __v: varyings 对象; __a: attributes 对象; __rt: runtime 对象
// 约定:
//   - vecN 用 JS 数组 (Float32Array 兼容), 标量用 number
//   - mat 用 Float32Array (列主序 flat): m[i] 下标 → subarray 列视图, 写入透传 (F-14)
//   - 内置/引擎函数调用 → __rt.<name>(...)
//   - fragment: 输出 gl_FragColor (Float32Array, 逐分量写); vertex: varying 写回 __v
//   - out/inout 标量参数: 调用方传 {v} 装箱对象, 函数体内 p 读写编译为 p.v, 调用后回写 (P1-31)

const VEC_SIZE = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 };
const MAT_SIZE = { mat2: 4, mat3: 9, mat4: 16 };
const SCALARS = new Set(['float', 'int', 'uint', 'bool', 'double']);
const BUILTIN = new Set([
  'mix', 'step', 'smoothstep', 'clamp', 'min', 'max', 'abs', 'floor', 'ceil',
  'fract', 'mod', 'pow', 'exp', 'log', 'sqrt', 'inversesqrt', 'sign', 'sin',
  'cos', 'tan', 'asin', 'acos', 'atan', 'radians', 'degrees', 'dot', 'cross',
  'length', 'distance', 'normalize', 'isnan', 'isinf', 'saturate', 'mul',
  'texSample2D', 'texture2D', 'texture2DLod', 'CAST2', 'CAST3', 'CAST4', 'CAST3X3',
  'floatBitsToInt', 'intBitsToFloat',
  // P1-28/GLS-10: 补齐 runtime 已实现的内置 (此前缺收录 → 裸调用 ReferenceError)
  'reflect', 'refract', 'faceforward', 'matrixCompMult',
  'any', 'all', 'not', 'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
  'equal', 'notEqual',
]);
const CONSTS = new Set(['M_PI', 'M_PI_HALF', 'M_PI_2', 'SQRT_2', 'SQRT_3']);
const SWZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

export function transpile(ast, stage) {
  return new Transpiler(ast, stage).generate();
}
export { Transpiler };

class Transpiler {
  constructor(ast, stage) {
    this.ast = ast;
    this.stage = stage; // 'fragment' | 'vertex'
    this.globals = {}; // name -> { type, kind }
    this.functions = {}; // name -> [overload] (GLS-19: 同名重载按参数个数分派)
    this.tmp = 0;
    this.collect();
  }

  typeOf(spec) {
    // fully_specified_type → type_specifier → keyword(token), 任意嵌套解包
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
          : quals.includes('attribute') ? 'attribute'
          : quals.includes('const') ? 'global'
          : 'global';
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          // GLS-02: 数组声明 float w[3] → 类型标 'float[]' (逐元素下标读写)
          const isArr = !!(d.quantifier && d.quantifier.length);
          this.globals[d.identifier.identifier] = { type: isArr ? type + '[]' : type, kind };
        }
      } else if (node.type === 'function') {
        const proto = node.prototype;
        const h = proto.header;
        const name = h.name.identifier;
        const returnType = this.typeOf(h.returnType);
        const params = (proto.parameters || []).map((p) => ({
          name: p.identifier.identifier,
          type: this.typeOf(p.specifier),
          inout: (p.qualifier || []).some((q) => q.token === 'inout' || q.token === 'out'),
        }));
        (this.functions[name] = this.functions[name] || []).push({ returnType, params, node });
      }
    }
    // GLS-19: 同名重载混名 — 按参数个数 (个数再撞 → 加序号), 调用点按实参个数分派
    for (const [name, list] of Object.entries(this.functions)) {
      if (list.length === 1) { list[0].jsName = name; continue; }
      const byCount = {};
      for (const o of list) (byCount[o.params.length] = byCount[o.params.length] || []).push(o);
      for (const group of Object.values(byCount)) {
        group.forEach((o, i) => { o.jsName = group.length === 1 ? `${name}$${o.params.length}` : `${name}$${o.params.length}_${i}`; });
      }
    }
  }

  // ── 局部类型收集 (函数体 DFS, 平铺) ──
  collectLocals(body) {
    const locals = {};
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'declaration_statement') {
        const dl = n.declaration;
        if (dl && dl.type === 'declarator_list') {
          const type = this.typeOf(dl.specified_type);
          for (const d of dl.declarations || []) {
            if (d.type === 'declaration') {
              locals[d.identifier.identifier] = d.quantifier && d.quantifier.length ? type + '[]' : type;
            }
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
    return locals;
  }

  fresh() { return '__t' + this.tmp++; }

  // 类型查询
  typeOfName(name, locals) {
    if (locals && locals[name]) return locals[name];
    if (this.globals[name]) return this.globals[name].type;
    return null;
  }
  kindOfName(name) {
    return this.globals[name] ? this.globals[name].kind : null;
  }

  // ── 块级作用域 (§五 P2: JS var 函数级污染 → 嵌套块同名声明重命名) ──
  resolveName(nm, ctx) {
    if (ctx.scopes) {
      for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        const s = ctx.scopes[i];
        if (s.has(nm)) return s.get(nm);
      }
    }
    return nm;
  }
  registerDeclaration(nm, ctx) {
    if (!ctx.scopes || !ctx.scopes.length) return nm;
    const cur = ctx.scopes[ctx.scopes.length - 1];
    for (let i = ctx.scopes.length - 2; i >= 0; i--) {
      if (ctx.scopes[i].has(nm)) {
        // 外层已有同名 → 本块重命名 (GLSL 块级 shadow, 不再污染外层)
        const alias = nm + '$' + this.tmp++;
        cur.set(nm, alias);
        return alias;
      }
    }
    cur.set(nm, nm);
    return nm;
  }

  // ── 非简单子表达式 hoist (GLS-09: 防逐分量重求值, 如 vec4(tex().rgb, 1) 的 12 次采样) ──
  maybeHoist(e, ctx) {
    if (e.simple || !ctx || !ctx.hoist) return e;
    const t = this.fresh();
    ctx.hoist.push(`var ${t} = ${e.code};`);
    return { code: t, type: e.type, simple: true };
  }

  // ── 主生成 ──
  generate() {
    const lines = [];
    const initLines = []; // GLS-26: 非常量全局的每像素重置体
    for (const [name, info] of Object.entries(this.globals)) {
      if (info.kind === 'uniform') {
        // GLS-15: 材质缺值且无引擎注入 → 类型默认值兜底 (不再 undefined→NaN)
        lines.push(`var ${name} = __u.${name} !== undefined ? __u.${name} : ${this.defaultValue(info.type)};`);
      } else if (info.kind === 'varying') {
        // varying 动态读 __v (每像素更新), 不声明快照
      } else if (info.kind === 'attribute') {
        lines.push(`var ${name} = __a.${name};`);
      } else {
        // 全局变量 (初始化器在下方 AST 扫描时补充)
        lines.push(`var ${name} = ${this.defaultValue(info.type)};`);
        initLines.push(`${name} = ${this.defaultValue(info.type)};`);
      }
    }
    // 全局变量声明带初始化器 (非 uniform/varying/attribute); 同步记入 __initGlobals
    const gctx = { locals: {}, fnName: null };
    for (const node of this.ast.program || []) {
      if (node.type !== 'declaration_statement') continue;
      const dl = node.declaration;
      if (!dl || dl.type !== 'declarator_list') continue;
      const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
      if (quals.includes('uniform') || quals.includes('varying') || quals.includes('attribute')) continue;
      const type = this.typeOf(dl.specified_type);
      for (const d of dl.declarations || []) {
        if (d.type !== 'declaration') continue;
        const nm = d.identifier.identifier;
        if (d.initializer) {
          const line = this.declInit(nm, type, d.initializer, gctx);
          lines.push(line);
          initLines.push(line.replace(/^var /, ''));
        }
      }
    }
    if (this.stage === 'vertex') {
      // gl_Position 显式声明 (§五 P2: 不再依赖非严格模式隐式全局)
      lines.push('var gl_Position = null;');
    }
    for (const node of this.ast.program || []) {
      if (node.type === 'function') {
        lines.push(this.functionCode(node));
      }
    }
    if (initLines.length) {
      // GLS-26: GLSL 全局在每次片元/顶点调用时重新初始化 (executor 逐像素调用)
      lines.push('function __initGlobals() {\n' + initLines.join('\n') + '\n}');
    }
    const initRef = 'typeof __initGlobals !== "undefined" ? __initGlobals : null';
    if (this.stage === 'fragment') {
      lines.push('var gl_FragColor = new Float32Array(4);');
      lines.push(`return { main: main, gl_FragColor: gl_FragColor, __initGlobals: ${initRef} };`);
    } else {
      lines.push(`return { main: main, __initGlobals: ${initRef} };`);
    }
    return lines.join('\n');
  }

  defaultValue(type) {
    if (type && String(type).endsWith('[]')) return '[]'; // 数组 (GLS-02)
    if (SCALARS.has(type)) return '0';
    const n = VEC_SIZE[type] || MAT_SIZE[type];
    return n ? `new Float32Array(${n})` : 'null';
  }

  // 声明初始化 (P1-35): 按声明类型截断 (vec4 值 → vec3) / 标量广播到 vec
  declInit(alias, type, initializer, ctx) {
    const e = this.expr(initializer, ctx);
    const dsz = VEC_SIZE[type];
    if (dsz !== undefined) {
      const esz = VEC_SIZE[e.type];
      if (esz !== undefined && esz !== dsz) {
        const h = this.maybeHoist(e, ctx);
        const parts = [];
        for (let i = 0; i < dsz; i++) parts.push(`${h.code}[${i}]`);
        return `var ${alias} = [${parts.join(', ')}];`;
      }
      if (esz === undefined && !MAT_SIZE[e.type]) {
        // 标量初始化 vec → 广播
        const h = this.maybeHoist(e, ctx);
        return `var ${alias} = ${this.broadcast(h.code, dsz)};`;
      }
    }
    return `var ${alias} = ${e.code};`;
  }

  // ── 函数转译 ──
  functionCode(node) {
    const proto = node.prototype;
    const name = proto.header.name.identifier;
    const params = proto.parameters || [];
    const body = node.body;
    const locals = this.collectLocals(body);
    for (const p of params) locals[p.identifier.identifier] = this.typeOf(p.specifier);
    // GLS-19: 重载 → 混名后的 JS 函数名
    const self = (this.functions[name] || []).find((o) => o.node === node);
    const jsName = self && self.jsName ? self.jsName : name;
    // P1-31/GLS-08: out/inout 标量参数 → {v} 装箱 (函数体内 p 读写 → p.v, 调用点回写)
    const boxed = new Set(params
      .filter((p) => (p.qualifier || []).some((q) => q.token === 'inout' || q.token === 'out') && SCALARS.has(this.typeOf(p.specifier)))
      .map((p) => p.identifier.identifier));
    // vec/mat in 参数按值复制 (GLSL in 语义; inout vec 按引用透传即正确)
    const copies = params
      .filter((p) => {
        const t = this.typeOf(p.specifier);
        return (VEC_SIZE[t] || MAT_SIZE[t]) && !(p.qualifier || []).some((q) => q.token === 'inout' || q.token === 'out');
      })
      .map((p) => `  ${p.identifier.identifier} = ${p.identifier.identifier}.slice(0);`)
      .join('\n');
    const ctx = { locals, fnName: name, boxed };
    // 作用域种子: 全局名 + 形参名 (函数级) → 函数体/嵌套块同名声明自动重命名
    const seed = new Map();
    for (const g of Object.keys(this.globals)) seed.set(g, g);
    for (const p of params) seed.set(p.identifier.identifier, p.identifier.identifier);
    ctx.scopes = [seed];
    const bodyCode = this.stmt(body, ctx);
    const paramNames = params.map((p) => p.identifier.identifier).join(', ');
    return `function ${jsName}(${paramNames}) {\n${copies}${bodyCode}\n}`;
  }

  // ── 语句转译 (外层: 块作用域 + hoist 行前置) ──
  stmt(node, ctx) {
    if (!node) return '';
    const scoped = node.type === 'compound_statement' || node.type === 'for_statement' || node.type === 'switch_statement';
    if (scoped && ctx.scopes) ctx.scopes.push(new Map());
    const outerHoist = ctx.hoist;
    ctx.hoist = [];
    const code = this.stmtInner(node, ctx);
    const hoisted = ctx.hoist;
    ctx.hoist = outerHoist;
    if (scoped && ctx.scopes) ctx.scopes.pop();
    if (!hoisted || !hoisted.length) return code;
    return hoisted.join('\n') + '\n' + code;
  }

  stmtInner(node, ctx) {
    switch (node.type) {
      case 'compound_statement':
        return (node.statements || []).map((s) => this.stmt(s, ctx)).filter((s) => s !== '').join('\n');
      case 'declaration_statement': {
        const dl = node.declaration;
        const type = this.typeOf(dl.specified_type);
        const out = [];
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          const nm = d.identifier.identifier;
          if (this.stage === 'vertex' && this.kindOfName(nm) === 'varying') {
            // vert 里对 varying 的声明一般不存在 (varying 在全局声明); 若局部声明同名, 忽略
            continue;
          }
          if (d.quantifier && d.quantifier.length) {
            // GLS-02: 数组声明 float w[3] → JS 数组, 支持逐元素下标读写
            const alias = this.registerDeclaration(nm, ctx);
            const sz = d.quantifier[0].expression ? this.expr(d.quantifier[0].expression, ctx).code : '0';
            out.push(`var ${alias} = new Array(Math.max(0, ${sz})).fill(0);`);
            continue;
          }
          const alias = this.registerDeclaration(nm, ctx);
          if (d.initializer) out.push(this.declInit(alias, type, d.initializer, ctx));
          else out.push(`var ${alias} = ${this.defaultValue(type)};`);
        }
        return out.join('\n');
      }
      case 'expression_statement':
        return this.exprStmt(node.expression, ctx);
      case 'if_statement': {
        const cond = this.expr(node.condition, ctx);
        const thenB = this.stmt(node.body, ctx);
        let out = `if (${cond.code}) {\n${thenB}\n}`;
        if (node.else) {
          // else 是数组: [elseToken, bodyNode] — bodyNode 可能是 if_statement (else-if 链) 或 compound
          const elseArr = Array.isArray(node.else) ? node.else : [node.else];
          const elseBody = elseArr.filter((n) => n && n.type !== 'keyword' && n.type !== 'literal');
          if (elseBody.length > 0) {
            out += ` else {\n${elseBody.map((s) => this.stmt(s, ctx)).join('\n')}\n}`;
          }
        }
        return out;
      }
      case 'for_statement': {
        // P0-11/GLS-01: init 支持裸 declarator_list (含多声明) / assignment; upd 支持 ++/--/复合赋值/逗号
        const savedHoist = ctx.hoist;
        ctx.hoist = null; // 头部不做 hoist (避免把每迭代求值提前到循环外)
        const init = node.init ? this.forInit(node.init, ctx) : '';
        const cond = node.condition ? this.expr(node.condition, ctx).code : '';
        const upd = node.operation ? this.forUpdate(node.operation, ctx) : '';
        ctx.hoist = savedHoist;
        return `for (${init}; ${cond}; ${upd}) {\n${this.stmt(node.body, ctx)}\n}`;
      }
      case 'while_statement': {
        const cond = this.expr(node.condition, ctx);
        return `while (${cond.code}) {\n${this.stmt(node.body, ctx)}\n}`;
      }
      case 'do_statement': {
        // GLS-14: do-while 真实执行 (此前整条丢弃)
        const cond = this.expr(node.expression, ctx);
        return `do {\n${this.stmt(node.body, ctx)}\n} while (${cond.code});`;
      }
      case 'switch_statement':
        return this.switchStmt(node, ctx);
      case 'return_statement':
        if (!node.expression) return 'return;';
        return `return ${this.expr(node.expression, ctx).code};`;
      case 'break_statement':
        return 'break;';
      case 'continue_statement':
        return 'continue;';
      case 'discard_statement':
        // P0-15/P1-32: 真 discard — 抛 runtime 信号, executor 捕获后跳过该像素写色
        return '__rt._discard();';
      default:
        return '/* stmt ' + node.type + ' */';
    }
  }

  // for 头部 init (P0-11): 裸 declarator_list / assignment / 表达式, 无尾分号
  forInit(node, ctx) {
    if (node.type === 'declarator_list') {
      const type = this.typeOf(node.specified_type);
      const parts = [];
      for (const d of node.declarations || []) {
        if (d.type !== 'declaration') continue;
        const alias = this.registerDeclaration(d.identifier.identifier, ctx);
        if (d.initializer) parts.push(`${alias} = ${this.expr(d.initializer, ctx).code}`);
        else parts.push(`${alias} = ${this.defaultValue(type)}`);
      }
      return 'var ' + parts.join(', ');
    }
    const code = node.type === 'assignment' ? this.assignStmt(node, ctx) : this.exprStmt(node, ctx);
    return code.replace(/;\s*$/, '');
  }

  // for 头部 update (P0-11): 去尾分号; i++/i-- 由 postfixExpr 生成 JS 原生后缀
  forUpdate(node, ctx) {
    const code = node.type === 'assignment' ? this.assignStmt(node, ctx) : `${this.expr(node, ctx).code};`;
    return code.replace(/;\s*$/, '');
  }

  // GLS-14: switch 退化 if 链 + default (fallthrough 按 GLSL 语义累计到下一个 break)
  switchStmt(node, ctx) {
    const e = this.expr(node.expression, ctx);
    const sw = this.fresh();
    const cases = node.cases || [];
    const blocks = cases.map((_, i) => {
      const stmts = [];
      for (let j = i; j < cases.length; j++) {
        let broke = false;
        for (const s of cases[j].statements || []) {
          if (s.type === 'break_statement') { broke = true; break; } // case 顶层 break 剥离
          const c = this.stmt(s, ctx);
          if (c !== '') stmts.push(c);
        }
        if (broke) break;
      }
      return stmts.join('\n');
    });
    const defaultIdx = cases.findIndex((c) => c.type === 'default_case');
    const conds = [];
    cases.forEach((c, i) => {
      if (c.type === 'default_case') return;
      conds.push(`if (${sw} === ${this.expr(c.test, ctx).code}) {\n${blocks[i]}\n}`);
    });
    let chain = conds.join(' else ');
    if (defaultIdx >= 0) {
      const dflt = `{\n${blocks[defaultIdx]}\n}`;
      chain = chain ? chain + ' else ' + dflt : dflt;
    }
    return `{\nvar ${sw} = ${e.code};\n${chain}\n}`;
  }

  // 表达式语句 (赋值等)
  exprStmt(node, ctx, asExpr = false) {
    if (!node) return '';
    if (node.type === 'assignment') {
      return this.assignStmt(node, ctx);
    }
    const e = this.expr(node, ctx);
    return `${e.code};`;
  }

  assignStmt(node, ctx) {
    const left = node.left;
    const op = node.operator.literal; // '=', '*=', 等
    // 左值 = 多分量 swizzle?
    const swz = this.swizzleOf(left);
    if (swz && swz.length > 1) {
      // var __t = rhs; base[i0] op= __t[0]; ... (op 可为 += *= 等复合赋值)
      const base = this.lvalueBase(left, ctx);
      const rhs = this.expr(node.right, ctx);
      const tmp = this.fresh();
      const lines = [`var ${tmp} = ${rhs.code};`];
      const jsOp = { '*=': '*=', '+=': '+=', '-=': '-=', '/=': '/=', '=': '=' }[op] || '=';
      // P0-13: RHS 为标量 → 广播到各分量 (类型未知时运行时判定)
      const scalarRhs = rhs.type ? SCALARS.has(rhs.type) : null;
      for (let i = 0; i < swz.length; i++) {
        const ri = scalarRhs === false ? `${tmp}[${i}]`
          : scalarRhs === true ? tmp
          : `(${tmp}.length === undefined ? ${tmp} : ${tmp}[${i}])`;
        lines.push(`${base}[${swz[i]}] ${jsOp} ${ri};`);
      }
      return lines.join('\n');
    }
    // F-14: mat 列赋值 m[i] = v (flat 数组的 JS 下标是标量, 需按列写回)
    const mc = this.matColLeft(left, ctx);
    if (mc) {
      const rhs = this.expr(node.right, ctx);
      if (op === '=') return `__rt._matColSet(${mc.base}, ${mc.idx}, ${rhs.code}, ${mc.rows});`;
      const fn = { '*=': '_vmul', '+=': '_vadd', '-=': '_vsub', '/=': '_vdiv' }[op];
      if (fn) {
        return `__rt._matColSet(${mc.base}, ${mc.idx}, __rt.${fn}(${mc.base}.subarray((${mc.idx}) * ${mc.rows}, (${mc.idx}) * ${mc.rows} + ${mc.rows}), ${rhs.code}), ${mc.rows});`;
      }
    }
    const lv = this.lvalue(left, ctx);
    // gl_FragColor 赋值 → 写内容 (模块 Float32Array 不重绑)
    if (this.stage === 'fragment' && left.type === 'identifier' && left.identifier === 'gl_FragColor') {
      const rhs = this.expr(node.right, ctx);
      return `gl_FragColor.set(${rhs.code});`;
    }
    if (op === '=') {
      const rhs = this.expr(node.right, ctx);
      return `${lv} = ${rhs.code};`;
    }
    // 复合赋值 *= -= += /=  (左值=vec → 辅助; 标量 → 直接)
    const lt = this.typeOfNode(left, ctx);
    const rhs = this.expr(node.right, ctx);
    if (VEC_SIZE[lt] || MAT_SIZE[lt]) {
      const fn = { '*=': '_vmulEq', '+=': '_vaddEq', '-=': '_vsubEq', '/=': '_vdivEq' }[op];
      return `${lv} = __rt.${fn}(${lv}, ${rhs.code});`;
    }
    const jsOp = { '*=': '*=', '+=': '+=', '-=': '-=', '/=': '/=', '%=': '%=' }[op] || '=';
    return `${lv} ${jsOp} ${rhs.code};`;
  }

  // 检测 mat[i] 左值 (postfix 下标直接作用于 mat 类型标识符) → { base, idx, rows }
  matColLeft(node, ctx) {
    if (!node || node.type !== 'postfix') return null;
    const pf = node.postfix;
    if (pf.type !== 'quantifier' && pf.type !== 'index') return null;
    if (node.expression.type !== 'identifier') return null;
    const rows = Math.round(Math.sqrt(MAT_SIZE[this.typeOfName(node.expression.identifier, ctx.locals)] || 0));
    if (!rows) return null;
    const idxNode = pf.type === 'quantifier' ? pf.expression : pf.index;
    return { base: this.lvalue(node.expression, ctx), idx: this.expr(idxNode, ctx).code, rows };
  }

  // 左值
  lvalue(node, ctx) {
    if (!node) return 'null';
    if (node.type === 'identifier') {
      const nm = node.identifier;
      if (ctx.boxed && ctx.boxed.has(nm)) return `${nm}.v`; // P1-31: 装箱标量
      // vert 的 varying 输出 → __v.name
      if (this.stage === 'vertex' && this.kindOfName(nm) === 'varying') {
        return `__v.${nm}`;
      }
      return this.resolveName(nm, ctx);
    }
    if (node.type === 'postfix') {
      const pf = node.postfix;
      // 基座: 标识符走 lvalueBase (别名/varying); 嵌套下标链走 expr (mat 列 subarray 视图可写)
      const base = node.expression.type === 'identifier'
        ? this.lvalueBase(node.expression, ctx)
        : this.expr(node.expression, ctx).code;
      if (pf.type === 'field_selection') {
        const sel = pf.selection.identifier;
        if (sel.length === 1 && SWZ[sel[0]] !== undefined) return `${base}[${SWZ[sel[0]]}]`;
        // 多分量 swizzle 已在 assignStmt 处理 (返回 base)
      }
      if (pf.type === 'quantifier' || pf.type === 'index') {
        // GLS-02: shaderfrog 7.0.1 下标节点是 quantifier
        const idxNode = pf.type === 'quantifier' ? pf.expression : pf.index;
        const idx = this.expr(idxNode, ctx);
        return `${base}[${idx.code}]`;
      }
    }
    return this.expr(node, ctx).code;
  }
  lvalueBase(node, ctx) {
    if (node.type === 'postfix') {
      if (node.postfix && node.postfix.type === 'postfix') {
        // 链式折叠 (m[1].xy = ...): 基座 = m[1] 的 mat 列 subarray 视图码
        return this.postfixExpr({ type: 'postfix', expression: node.expression, postfix: node.postfix.expression }, ctx).code;
      }
      if (node.expression.type !== 'identifier') {
        // 嵌套下标基座: 生成视图码
        return this.expr(node.expression, ctx).code;
      }
      return this.lvalueBase(node.expression, ctx);
    }
    if (node.type === 'identifier') {
      if (ctx.boxed && ctx.boxed.has(node.identifier)) return `${node.identifier}.v`;
      if (this.stage === 'vertex' && this.kindOfName(node.identifier) === 'varying') return `__v.${node.identifier}`;
      return this.resolveName(node.identifier, ctx);
    }
    return this.expr(node, ctx).code;
  }
  // 多分量 swizzle 检测 (含 parser 链式折叠: m[1].xy → postfix(m, postfix(q, field)))
  swizzleOf(node) {
    if (!node || node.type !== 'postfix') return null;
    let pf = node.postfix;
    if (pf && pf.type === 'postfix') pf = pf.postfix;
    if (pf && pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel.length > 1 && sel.split('').every((c) => SWZ[c] !== undefined)) {
        return sel.split('').map((c) => SWZ[c]);
      }
    }
    return null;
  }

  // ── 表达式转译 (返回 {code, type, simple}; simple=无副作用可安全内联) ──
  expr(node, ctx) {
    if (!node) return { code: '0', type: 'float', simple: true };
    switch (node.type) {
      case 'identifier': {
        const nm = node.identifier;
        let code;
        if (this.kindOfName(nm) === 'varying') code = `__v.${nm}`;
        else if (ctx.boxed && ctx.boxed.has(nm)) code = `${nm}.v`; // P1-31: 装箱标量
        else code = this.resolveName(nm, ctx);
        return { code, type: this.typeOfName(nm, ctx.locals), simple: true };
      }
      case 'int_constant':
        return { code: node.token, type: 'int', simple: true };
      case 'float_constant':
        return { code: node.token, type: 'float', simple: true };
      case 'bool_constant':
        return { code: node.token, type: 'bool', simple: true };
      case 'literal': {
        // 数字 token (罕见)
        if (/^[0-9.eE+-]+$/.test(node.literal)) return { code: node.literal, type: /\./.test(node.literal) ? 'float' : 'int', simple: true };
        return { code: '0', type: 'float', simple: true };
      }
      case 'binary':
        return this.binaryExpr(node, ctx);
      case 'unary': {
        const inner = this.expr(node.expression, ctx);
        if (node.operator.literal === '-') {
          if (VEC_SIZE[inner.type]) {
            if (inner.simple) {
              const n = VEC_SIZE[inner.type];
              const parts = [];
              for (let i = 0; i < n; i++) parts.push(`(-${inner.code}[${i}])`);
              return { code: `[${parts.join(', ')}]`, type: inner.type, simple: true };
            }
            return { code: `__rt._vneg(${inner.code})`, type: inner.type, simple: false };
          }
          return { code: `(-${inner.code})`, type: inner.type, simple: true };
        }
        if (node.operator.literal === '!') return { code: `(!${inner.code})`, type: 'bool', simple: true };
        return { code: `(${node.operator.literal}${inner.code})`, type: inner.type, simple: inner.simple };
      }
      case 'ternary': {
        const c = this.expr(node.expression, ctx);
        const a = this.expr(node.left, ctx);
        const b = this.expr(node.right, ctx);
        return { code: `(${c.code} ? ${a.code} : ${b.code})`, type: a.type || b.type, simple: false };
      }
      case 'group':
        return this.expr(node.expression, ctx);
      case 'function_call':
        return this.callExpr(node, ctx);
      case 'postfix':
        return this.postfixExpr(node, ctx);
      case 'index': {
        // AST index 节点: expression + index? (罕见结构)
        const base = this.expr(node.expression, ctx);
        const idx = this.expr(node.index, ctx);
        return { code: `${base.code}[${idx.code}]`, type: 'float', simple: true };
      }
      default:
        return { code: '0', type: 'float' };
    }
  }

  isIntType(t) {
    return t === 'int' || t === 'uint';
  }

  binaryExpr(node, ctx) {
    const l = this.expr(node.left, ctx);
    const r = this.expr(node.right, ctx);
    const op = node.operator.literal;
    const lvec = VEC_SIZE[l.type];
    const rvec = VEC_SIZE[r.type];
    const lmat = MAT_SIZE[l.type];
    const rmat = MAT_SIZE[r.type];
    if (op === '+' || op === '-' || op === '*' || op === '/') {
      if (lvec || rvec) {
        // vec 运算: 操作数简单 → 内联数组字面量 (避免 __rt 调用 + 分配)
        if (l.simple && r.simple) {
          const n = lvec || rvec;
          const parts = [];
          for (let i = 0; i < n; i++) {
            const li = lvec ? `${l.code}[${i}]` : l.code;
            const ri = rvec ? `${r.code}[${i}]` : r.code;
            parts.push(`(${li} ${op} ${ri})`);
          }
          return { code: `[${parts.join(', ')}]`, type: lvec ? l.type : r.type, simple: true };
        }
        const fn = { '+': '_vadd', '-': '_vsub', '*': '_vmul', '/': '_vdiv' }[op];
        return { code: `__rt.${fn}(${l.code}, ${r.code})`, type: lvec ? l.type : r.type, simple: false };
      }
      if (lmat || rmat) {
        // mat 运算 (矩阵语义特殊, 保持辅助)
        const fn = { '+': '_vadd', '-': '_vsub', '*': '_vmul', '/': '_vdiv' }[op];
        return { code: `__rt.${fn}(${l.code}, ${r.code})`, type: lmat ? l.type : r.type, simple: false };
      }
      if (op === '/' && this.isIntType(l.type) && this.isIntType(r.type)) {
        // GLS-12: int/int 截断除法 (GLSL 整除)
        return { code: `Math.trunc(${l.code} / ${r.code})`, type: 'int', simple: true };
      }
      return { code: `(${l.code} ${op} ${r.code})`, type: 'float', simple: true };
    }
    if (op === '%' && this.isIntType(l.type) && this.isIntType(r.type)) {
      // P1-34: GLSL % 对负操作数取 floor-mod (符号随除数)
      return { code: `__rt._imod(${l.code}, ${r.code})`, type: 'int', simple: true };
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      return { code: `(${l.code} ${op} ${r.code})`, type: 'bool', simple: true };
    }
    if (op === '==' || op === '!=') {
      // GLS-07: vec/mat 相等 → 逐分量比较 (JS 引用比较恒 false)
      if (lvec || rvec || lmat || rmat) {
        const eq = `__rt._veq(${l.code}, ${r.code})`;
        return { code: op === '==' ? eq : `(!${eq})`, type: 'bool', simple: false };
      }
      return { code: `(${l.code} ${op === '==' ? '===' : '!=='} ${r.code})`, type: 'bool', simple: true };
    }
    if (op === '&&' || op === '||') {
      return { code: `(${l.code} ${op} ${r.code})`, type: 'bool', simple: true };
    }
    return { code: `(${l.code} ${op} ${r.code})`, type: 'float', simple: true };
  }

  callExpr(node, ctx) {
    // callee: node.identifier — identifier 节点 (函数名) 或 type_specifier 节点 (vec2/3/4/mat 构造)
    let name = null;
    if (node.identifier) {
      if (node.identifier.type === 'identifier') {
        name = node.identifier.identifier;
      } else if (node.identifier.type === 'type_specifier') {
        // specifier 可能是 keyword {token} 或 type_name {identifier} (如 CAST2)
        const sp = node.identifier.specifier;
        if (sp) {
          if (sp.token) name = sp.token;
          else if (sp.identifier) name = sp.identifier;
          else if (sp.specifier) name = sp.specifier.token || (sp.specifier.specifier && sp.specifier.specifier.token);
        }
      }
    }
    if (name) {
      const args = (node.args || []).filter((a) => a.type !== 'literal');
      if (VEC_SIZE[name]) {
        return { code: this.constructVec(VEC_SIZE[name], args, ctx), type: name, simple: true };
      }
      if (MAT_SIZE[name]) {
        return { code: this.constructMat(name, args, ctx), type: name, simple: true };
      }
      if (name === 'float') return { code: `(+(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'float', simple: true };
      if (name === 'int') return { code: `(Math.trunc(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'int', simple: true };
      if (name === 'bool') return { code: `(!!(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'bool', simple: true };
      // mix: a/b vec + t 标量/vec → 内联 (避免 __rt.mix 分配); 否则回退
      if (name === 'mix' && args.length === 3) {
        const a = this.expr(args[0], ctx);
        const b = this.expr(args[1], ctx);
        const t = this.expr(args[2], ctx);
        const n = VEC_SIZE[a.type];
        if (n && VEC_SIZE[b.type] && a.simple && b.simple && t.simple) {
          const tVec = VEC_SIZE[t.type];
          if (tVec || t.type === 'float') {
            const parts = [];
            for (let i = 0; i < n; i++) {
              const ti = tVec ? `${t.code}[${i}]` : t.code;
              parts.push(`(${a.code}[${i}] + (${b.code}[${i}] - ${a.code}[${i}]) * ${ti})`);
            }
            return { code: `[${parts.join(', ')}]`, type: a.type, simple: true };
          }
        }
      }
      if (BUILTIN.has(name) || CONSTS.has(name)) {
        const a = args.map((a) => this.expr(a, ctx).code).join(', ');
        return { code: `__rt.${name}(${a})`, type: this.builtinReturnType(name, args, ctx), simple: false };
      }
      // 自定义函数 (GLS-19: 按实参个数选重载, 个数同再按可推断类型; P1-31: out/inout 标量装箱回写)
      const overloads = this.functions[name] || [];
      const argCodes = args.map((a) => this.expr(a, ctx));
      let cands = overloads.filter((o) => o.params.length === args.length);
      if (cands.length > 1) {
        // 同参数个数的重载: 静态类型可判时按类型精确匹配 (标量 vs vec)
        const byType = cands.filter((o) => argCodes.every((a, i) => {
          const pt = o.params[i] ? o.params[i].type : null;
          return pt && a.type && (pt === a.type || (VEC_SIZE[pt] ? VEC_SIZE[a.type] : !VEC_SIZE[a.type]));
        }));
        if (byType.length) cands = byType;
      }
      const fnInfo = cands[0] || overloads[overloads.length - 1] || null;
      const boxedIdx = fnInfo
        ? fnInfo.params.map((p, i) => (p.inout && SCALARS.has(p.type) ? i : -1)).filter((i) => i >= 0 && i < argCodes.length)
        : [];
      // (argCodes 已在重载选择时求值)
      if (fnInfo && boxedIdx.length) {
        const pre = [];
        const callArgs = [];
        const post = [];
        argCodes.forEach((ac, i) => {
          if (boxedIdx.includes(i)) {
            const b = this.fresh();
            pre.push(`var ${b} = {v: ${ac.code}};`);
            callArgs.push(b);
            if (args[i].type === 'identifier') post.push(`${this.lvalue(args[i], ctx)} = ${b}.v;`);
          } else callArgs.push(ac.code);
        });
        return {
          code: `(function(){${pre.join(' ')}var __r = ${fnInfo.jsName}(${callArgs.join(', ')});${post.join(' ')}return __r;})()`,
          type: fnInfo.returnType,
          simple: false,
        };
      }
      const a = argCodes.map((ac) => ac.code).join(', ');
      return { code: `${fnInfo ? fnInfo.jsName : name}(${a})`, type: fnInfo ? fnInfo.returnType : 'float', simple: false };
    }
    // 其它 callee (罕见)
    return { code: '0', type: 'float', simple: true };
  }

  builtinReturnType(name, args, ctx) {
    switch (name) {
      case 'dot': case 'length': case 'distance': return 'float';
      case 'mix': case 'step': case 'smoothstep': case 'clamp': case 'min': case 'max':
        return args.length ? this.expr(args[0], ctx).type : 'float';
      case 'normalize': return args.length ? this.expr(args[0], ctx).type : 'vec3';
      case 'cross': return 'vec3';
      case 'mul': return args.length ? this.expr(args[0], ctx).type : 'vec4';
      case 'texSample2D': case 'texture2D': case 'texture2DLod': return 'vec4';
      case 'CAST2': return 'vec2';
      case 'CAST3': return 'vec3';
      case 'CAST4': return 'vec4';
      case 'CAST3X3': return 'mat3';
      // P1-28 新增内置的返回类型
      case 'reflect': case 'refract': case 'faceforward': return args.length ? this.expr(args[0], ctx).type : 'vec3';
      case 'matrixCompMult': return args.length ? this.expr(args[0], ctx).type : 'mat4';
      case 'any': case 'all': return 'bool';
      case 'not': return args.length ? this.expr(args[0], ctx).type : 'bool';
      case 'lessThan': case 'lessThanEqual': case 'greaterThan': case 'greaterThanEqual':
      case 'equal': case 'notEqual': {
        const t = args.length ? this.expr(args[0], ctx).type : 'vec4';
        return 'bvec' + (VEC_SIZE[t] || 4);
      }
      case 'saturate': case 'abs': case 'floor': case 'ceil': case 'fract': case 'mod':
      case 'pow': case 'exp': case 'log': case 'sqrt': case 'inversesqrt': case 'sign':
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan':
      case 'radians': case 'degrees':
        return args.length ? this.expr(args[0], ctx).type : 'float';
      default: return 'float';
    }
  }

  // vec 构造: GLSL 规则 — 单标量广播; 多参数按分量拼接/截取
  constructVec(size, args, ctx) {
    if (args.length === 0) return `new Float32Array(${size})`;
    const exprs = args.map((a) => this.expr(a, ctx));
    // 单参数
    if (args.length === 1) {
      let e = exprs[0];
      e = this.maybeHoist(e, ctx); // GLS-09: 非简单参数只求值一次
      if (SCALARS.has(e.type)) {
        return this.broadcast(e.code, size);
      }
      // vec 参数 → 截取/填充
      const parts = [];
      for (let i = 0; i < size; i++) parts.push(`${e.code}[${i}]`);
      return `[${parts.join(', ')}]`;
    }
    // 多参数: 拼接
    const parts = [];
    for (let e of exprs) {
      if (SCALARS.has(e.type)) parts.push(e.code);
      else {
        e = this.maybeHoist(e, ctx); // GLS-09
        const n = VEC_SIZE[e.type] || 1;
        for (let i = 0; i < n; i++) parts.push(`${e.code}[${i}]`);
      }
    }
    // 截取到 size
    return `[${parts.slice(0, size).join(', ')}]`;
  }

  broadcast(code, sizeOrType) {
    const n = typeof sizeOrType === 'number' ? sizeOrType : VEC_SIZE[sizeOrType];
    return `[${Array(n).fill(code).join(', ')}]`;
  }

  constructMat(type, args, ctx) {
    // 简化: 对角线广播 (单标量) / matN(matM) 左上子阵 / 前N分量
    // F-14: 返回 Float32Array (m[i] 下标 → subarray 列视图可写)
    const n = MAT_SIZE[type];
    const d = Math.round(Math.sqrt(n));
    if (args.length === 1) {
      const e = this.expr(args[0], ctx);
      if (SCALARS.has(e.type)) {
        const arr = new Array(n).fill('0');
        for (let i = 0; i < d; i++) arr[i * d + i] = e.code;
        return `new Float32Array([${arr.join(', ')}])`;
      }
      if (MAT_SIZE[e.type]) {
        // §五 P2: mat3(mat4) — 左上 N×N 子阵 (列主序抽列; 此前整包塞入得长度 1)
        const sd = Math.round(Math.sqrt(MAT_SIZE[e.type]));
        const parts = [];
        for (let c = 0; c < d; c++) {
          for (let r = 0; r < d; r++) {
            parts.push(r < sd && c < sd ? `${e.code}[${c * sd + r}]` : (r === c ? '1' : '0'));
          }
        }
        return `new Float32Array([${parts.join(', ')}])`;
      }
    }
    const parts = [];
    for (const a of args) {
      const e = this.expr(a, ctx);
      const vn = VEC_SIZE[e.type];
      if (vn) for (let i = 0; i < vn; i++) parts.push(`${e.code}[${i}]`);
      else parts.push(e.code);
    }
    return `new Float32Array([${parts.slice(0, n).join(', ')}])`;
  }

  postfixExpr(node, ctx) {
    const base = this.expr(node.expression, ctx);
    return this.postfixApply(base, node.postfix, ctx);
  }

  // 把一个 postfix 修饰应用到基座上。
  // 注意: parser 把链式下标折叠为 postfix(quantifier, quantifier) —
  // 即 pf 本身是 postfix 节点 (expression=第一个下标, postfix=后续) — 需递归展开
  postfixApply(base, pf, ctx) {
    if (!pf) return base;
    if (pf.type === 'postfix') {
      return this.postfixApply(this.postfixApply(base, pf.expression, ctx), pf.postfix, ctx);
    }
    if (pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel.length === 1 && SWZ[sel[0]] !== undefined) {
        const t = base.type && base.type[0] === 'i' ? 'int' : 'float';
        return { code: `${base.code}[${SWZ[sel[0]]}]`, type: t, simple: true };
      }
      if (sel.split('').every((c) => SWZ[c] !== undefined)) {
        // P0-12: 多分量 swizzle 按分量数定型 (此前 type: base.type → vec3 得 vec4 长度失真)
        const idx = sel.split('').map((c) => SWZ[c]);
        const h = this.maybeHoist(base, ctx); // GLS-09: 非简单基座 (如 texture2D(...)) 只求值一次
        const parts = idx.map((i) => `${h.code}[${i}]`);
        const pre = base.type && base.type[0] === 'i' ? 'ivec' : base.type && base.type[0] === 'b' ? 'bvec' : 'vec';
        return { code: `[${parts.join(', ')}]`, type: pre + idx.length, simple: true };
      }
    }
    if (pf.type === 'quantifier' || pf.type === 'index') {
      // GLS-02: shaderfrog 7.0.1 下标节点是 quantifier (lb/expression/rb), 此前只查 'index' → v[0] 丢成 v
      const idxNode = pf.type === 'quantifier' ? pf.expression : pf.index;
      const idx = this.expr(idxNode, ctx);
      if (MAT_SIZE[base.type]) {
        // F-14: mat 的 [i] 返回列向量 (GLSL 列主序) → subarray 视图 (constructMat 返回 Float32Array, 写入透传)
        const rows = Math.round(Math.sqrt(MAT_SIZE[base.type]));
        return {
          code: `${base.code}.subarray((${idx.code}) * ${rows}, (${idx.code}) * ${rows} + ${rows})`,
          type: 'vec' + rows,
          simple: true,
        };
      }
      const bt = base.type || '';
      const elem = bt.endsWith('[]') ? bt.slice(0, -2) : bt[0] === 'i' ? 'int' : 'float';
      return { code: `${base.code}[${idx.code}]`, type: elem, simple: true };
    }
    if (pf.type === 'literal' && (pf.literal === '++' || pf.literal === '--')) {
      // P0-11: i++/i-- (JS 原生后缀; 此前整个增量被丢弃)
      return { code: `${base.code}${pf.literal}`, type: base.type, simple: false };
    }
    return { code: base.code, type: base.type, simple: base.simple };
  }

  exprTypeIsVec(t) {
    return VEC_SIZE[t] !== undefined || MAT_SIZE[t] !== undefined;
  }

  typeOfNode(node, ctx) {
    if (node.type === 'identifier') return this.typeOfName(node.identifier, ctx.locals);
    if (node.type === 'postfix') {
      const base = this.typeOfNode(node.expression, ctx);
      const pf = node.postfix;
      if (pf.type === 'field_selection' && pf.selection.identifier.length === 1) return 'float';
      return base;
    }
    const e = this.expr(node, ctx);
    return e.type;
  }
}
