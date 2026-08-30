// WE 渲染引擎 — scene 层: 场景脚本执行 ({script,value} 写回 + 备份恢复)
// 官方对应: scenescript64.dll 的内嵌 V8 — 脚本运行时本身在 lib/scene-scripts.js
// (vm 沙箱), 本模块只负责"何时跑、跑完写回、多帧复用如何恢复"的编排
// P1 重构: 从 core.js 拆出, 纯搬家零行为变化
import { applySceneScripts } from '../../scene-scripts.js';

export function installSceneScripts(proto) {
  Object.assign(proto, {
    // scene scripts ({script,value}) 写回原对象 value — 多帧复用需备份恢复, 避免值累积污染
    _backupScriptValues() {
      if (this._scriptBackup) return;
      this._scriptBackup = [];
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
          this._scriptBackup.push([obj, obj.value]);
          return; // script 对象内部不再含 script 子对象
        }
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v && typeof v === 'object') walk(v);
        }
      };
      for (const o of this.scene.objects || []) walk(o);
      if (this.scene.general) walk(this.scene.general);
      if (this.scene.camera) walk(this.scene.camera);
    },

    _restoreScriptValues() {
      if (!this._scriptBackup) return;
      for (const [obj, v] of this._scriptBackup) obj.value = v;
    },

    // sf42: 执行场景 {script, value} 脚本 (一次)。从 render() 主流程提取 —
    // 必须在 _setupCamera 前调用 (相机对象 origin/zoom 可能是脚本驱动:
    // Amiya 的相机 origin 脚本把 eye 移到画布中心 1920,1080; 旧实现脚本在
    // setupCamera 后执行 → 相机用脚本前原始值 → 错位 → 前景组件偏移)。
    _runSceneScripts(t) {
      try {
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const sceneW = ortho && ortho.width ? ortho.width : this.W;
        const sceneH = ortho && ortho.height ? ortho.height : this.H;
        if (process.env.DSH_WE_DEBUG_SCRIPTS === '1') {
          // 诊断: 打印传入脚本的 canvasSize (定位相机对象 origin 脚本算出 0 的问题)
          const cam = (this.objects || []).find((o) => o && o.camera === 'default');
          this.log('[scripts] canvasSize=' + sceneW + 'x' + sceneH + (cam ? ' camOrigin=' + JSON.stringify(cam.origin && cam.origin.value) : ''));
        }
        // frametime = 真实场景时间差 (根因 A 修复): 旧实现恒 1/60, 而 NSL 调度器按
        // `time += engine.frametime` 推进 — 静态帧单次 update() 用 1/60 (与旧行为
        // 一致, 避免平滑类脚本跳变); 快进 (P4a) 负责把时钟推到场景时间 t。
        const dt = (this._lastRenderTime != null && t > this._lastRenderTime)
          ? Math.min(1, t - this._lastRenderTime)
          : 1 / 60;
        this._lastRenderTime = t;
        // P4a 静态帧脚本时间轴快进 (根因 A): NSL 调度器 time += engine.frametime,
        // 静态帧只有 1 次 update → 脚本动画停在 init 态。把剩余场景时间切成
        // ≤MAX_FF_STEPS 步 (每步 ≥1/30s) 逐次重跑状态脚本, 动画时钟到达 t。
        // 门控: 默认关闭 (DSH_WE_SCRIPT_FF=1 启用) — NSL 动画注册 API
        // (getAnimationLayer/startAnimation) 未实现, 动画方向已放弃 (2026-08-30);
        // 状态脚本 (计数/时钟类) 仍可受益于快进, 按需启用。启用成本: 120 步 ×
        // 状态脚本数 ≈ 1-2s。
        const MAX_FF_STEPS = 120;
        let ffSteps = 0, ffStep = 0;
        if (process.env.DSH_WE_SCRIPT_FF === '1' && this.staticFrame === true && t > 0) {
          ffSteps = Math.min(Math.max(1, Math.ceil(t / (1 / 30))), MAX_FF_STEPS);
          ffStep = t / ffSteps;
        }
        if (!this._scriptErrors) this._scriptErrors = [];
        const errBefore = this._scriptErrors.length;
        applySceneScripts(this.scene, t, {
          canvasSize: { x: sceneW, y: sceneH },
          userProps: this.userProps,
          scriptCache: this._scriptCache,
          // 脚本 thisScene/getLayer 写渲染对象 (烘焙后的 this.objects), 直接生效
          renderObjects: this.objects,
          runtime: t,
          frametime: dt,
          // P4a: 静态帧脚本时间轴快进参数 (非静态帧为 0, 不启用)
          fastForwardSteps: ffSteps,
          fastForwardStep: ffStep,
          // 脚本运行时错误收集 (worker 结束随 gpuDiag 输出; 不再静默吞掉)
          onError: (msg) => {
            if (this._scriptErrors.length < 30) this._scriptErrors.push(msg);
          },
          // thisLayer.getTextureAnimation() 的帧动画元数据 (鸟等 spritesheet)
          textureInfoFn: (o) => this._textureFrameInfo(o),
        });
        if (this._scriptErrors.length > errBefore) {
          this.log('脚本错误 (' + (this._scriptErrors.length - errBefore) + '): ' + this._scriptErrors.slice(errBefore).slice(0, 3).join(' | '));
        }
      } catch (e) {
        this.log('脚本执行失败: ' + e.message);
      }
    },
  });
}
