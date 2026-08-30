// WE 渲染引擎 — effects 注册表 (官方 effects/<name>/ 包对应)
// P2 重构: 替代 effects.js 里 24 分支 if/else 名称分发 → 数据驱动注册表。
// 每个条目: 效果名 → (ctx) => img 内核执行。ctx = { img, ef, name, passes, pass, c, combos, t }
// 内核保持手写 CPU 实现 (性能关键, 不泛化为通用解释器); 第三方/未注册效果
// 仍走 GLSL 解释器 (applyEffects 的 else 分支)。
// 行为保证: 每个条目调用与旧 if/else 完全相同的内核与实参 (含 `this` 绑定)。
import { fx as fxGodrays } from './godrays.js';
import { fx as fxScroll } from './scroll.js';
import { fx as fxTint } from './tint.js';
import { fx as fxPulse } from './pulse.js';
import { fx as fxFilmgrain } from './filmgrain.js';
import { fx as fxOpacity } from './opacity.js';
import { fx as fxSkew } from './skew.js';
import { fx as fxIris } from './iris.js';
import { fx as fxLightshafts } from './lightshafts.js';
import { fx as fxCloudmotion } from './cloudmotion.js';
import { fx as fxShimmer } from './shimmer.js';
import { fx as fxBlurradial } from './blurradial.js';
import { fx as fxBlur } from './blur.js';
import { fx as fxDepthParallax } from './depthparallax.js';
import { fx as fxWaterCaustics } from './watercaustics.js';
import { fx as fxBlend } from './blend.js';
import { fx as fxGlitter } from './glitter.js';
import { fx as fxClouds } from './clouds.js';
import { fx as fxSwing } from './swing.js';
import { fx as fxWaterflow } from './waterflow.js';
import { fx as fxFoliageSway } from './foliagesway.js';
import { fx as fxWaterwaves } from './waterwaves.js';
import { fx as fxWaterripple } from './waterripple.js';
import { fx as fxShake } from './shake.js';

// 内核集 (仍挂原型, 与 installEffects 的 ...allFx 保持一致; 注册表经 this 调用)
export const effectKernels = Object.assign({}, fxGodrays, fxScroll, fxTint, fxPulse, fxFilmgrain, fxOpacity, fxSkew, fxIris, fxLightshafts, fxCloudmotion, fxShimmer, fxBlurradial, fxBlur, fxDepthParallax, fxWaterCaustics, fxBlend, fxGlitter, fxClouds, fxSwing, fxWaterflow, fxFoliageSway, fxWaterwaves, fxWaterripple, fxShake);

// 注册表: 效果名 → (ctx) => img (this = SceneRenderer 实例)
export const effectRegistry = {
  waterwaves(ctx) { return this.effectWaterwaves(ctx.img, ctx.c, ctx.t, ctx.pass); },
  waterflow(ctx) { return this.effectWaterflow(ctx.img, ctx.c, ctx.t, ctx.pass); },
  foliagesway(ctx) { return this.effectFoliageSway(ctx.img, ctx.c, ctx.t, ctx.pass); },
  skew(ctx) { return this.effectSkew(ctx.img, ctx.c, ctx.t, ctx.pass); },
  iris(ctx) { return this.effectIris(ctx.img, ctx.c, ctx.t, ctx.pass); },
  lightshafts(ctx) { return this.effectLightshafts(ctx.img, ctx.c, ctx.t, ctx.pass); },
  cloudmotion(ctx) { return this.effectCloudmotion(ctx.img, ctx.c, ctx.t, ctx.pass); },
  shimmer(ctx) { return this.effectShimmer(ctx.img, ctx.c, ctx.t, ctx.pass); },
  blurradial(ctx) { return this.effectBlurradial(ctx.img, ctx.c, ctx.t, ctx.pass); },
  clouds(ctx) { return this.effectClouds(ctx.img, ctx.c, ctx.t, ctx.pass); },
  swing(ctx) { return this.effectSwing(ctx.img, ctx.c, ctx.t, ctx.pass); },
  waterripple(ctx) { return this.effectWaterripple(ctx.img, ctx.c, ctx.t, ctx.ef, ctx.pass); },
  shake(ctx) { return this.effectShake(ctx.img, ctx.c, ctx.t, ctx.pass); },
  scroll(ctx) { return this.effectScroll(ctx.img, ctx.c, ctx.t); },
  tint(ctx) { return this.effectTint(ctx.img, ctx.c, ctx.t, ctx.combos, ctx.pass); },
  pulse(ctx) { return this.effectPulse(ctx.img, ctx.c, ctx.t, ctx.combos, ctx.pass); },
  filmgrain(ctx) { return this.effectFilmgrain(ctx.img, ctx.c, ctx.t, ctx.combos, ctx.pass); },
  godrays(ctx) { return this.effectGodrays(ctx.img, ctx.passes, ctx.t); },
  glitter(ctx) { return this.effectGlitter(ctx.img, ctx.passes, ctx.t); },
  opacity(ctx) { return this.effectOpacity(ctx.img, ctx.c, ctx.t, ctx.pass); },
  blur(ctx) { return this.effectBlur(ctx.img, ctx.passes, ctx.c, ctx.t, ctx.pass); },
  depthparallax(ctx) { return this.effectDepthParallax(ctx.img, ctx.c, ctx.t, ctx.pass); },
  watercaustics(ctx) { return this.effectWaterCaustics(ctx.img, ctx.c, ctx.t, ctx.pass); },
  blend(ctx) { return this.effectBlend(ctx.img, ctx.passes, ctx.c, ctx.t, ctx.pass); },
  // blurprecise: 跳过 (性能) — 与旧 if/else 行为一致
  blurprecise(ctx) { return ctx.img; },
};
