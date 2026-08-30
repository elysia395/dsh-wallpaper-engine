// WE 渲染引擎 — scene 层: 场景图 (对象树/拓扑排序/类型分类)
// 官方对应: scenescript64.dll 的场景图构建 (CScene::createObject/addObjectToRenderOrder)
// P1 重构: 从 core.js 拆出, 纯搬家零行为变化
export function installSceneGraph(proto) {
  Object.assign(proto, {
    // ── 对象树: 依赖/父级排序 (CScene::createObject/addObjectToRenderOrder) ──
    _resolveObjects() {
      const objects = this.scene.objects || [];
      this.objects = objects.map((o) => ({ ...o, _renderType: this._classify(o) }));
      // 渲染顺序: 依赖前置 + 场景顺序 (防循环依赖栈溢出)
      const order = [];
      const added = new Set();
      const visiting = new Set();
      const add = (o) => {
        if (added.has(o.id)) return;
        if (visiting.has(o.id)) return; // 依赖循环 (A↔B): 已在此链中, 跳过
        visiting.add(o.id);
        for (const dep of o.dependencies || []) {
          const d = this.objects.find((x) => x.id === dep);
          if (d) add(d);
        }
        if (o.parent != null) {
          const p = this.objects.find((x) => x.id === o.parent);
          if (p) add(p);
        }
        visiting.delete(o.id);
        added.add(o.id);
        order.push(o);
      };
      for (const o of this.objects) add(o);
      this.renderOrder = order;
    },

    _classify(o) {
      if (o.image) return 'image';
      if (o.model) return 'model';
      if (o.particle) return 'particle';
      if (o.sound) return 'sound';
      if (o.text) return 'text';
      if (o.light) return 'light';
      return 'unknown';
    },
  });
}
