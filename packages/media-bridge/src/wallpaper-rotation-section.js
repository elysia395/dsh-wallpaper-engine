/**
 * wallpaper-rotation-section.js — 「壁纸库」页签第三节「自动轮播」的渲染器。
 *
 * 归属 / 构建期形状 / 消费侧契约见本包 `src/client.js` 文件头（同一份 P-D 口径）。
 * 本文件是 `packages/media-bridge/client.build.json` 的 inline 模块：与入口同工厂作用域，
 * 不收 import / require；自由标识符（React / weT / ctlText / Toggle / renderConfirmRow /
 * groupWallpapers / startCreateGroup / startEditGroup / saveEditingGroup / cancelEditGroup /
 * importPlaylistIntoDraft / rotationIntervalDefault）由入口从 host 显式键集解构。
 *
 * 默认轮播间隔经**窄键** `rotationIntervalDefault` 从 host 取（同一格默认值的显式绑定；
 * 真源仍是主包 `DEFAULTS.rotationInterval`，同源判据见 `test/verify-client.mjs`）。
 *
 * ctx 键（INTERVALS / armedConfirm / editing / group / groups / 十一个 on* 回调 /
 * playableCount / sel）照旧由主包 renderWallpaperTab 构造 ⇒ 本函数与搬前逐字同行为
 *（唯一新增：`onPictureSlideSeconds` = 图内过场周期，「图片轮播」那一行用）。
 */

  function renderWallpaperRotationSection(ctx) {
    const { INTERVALS, armedConfirm, editing, group, groups, onArmDeleteGroup, onDeleteGroup, onDisarmConfirm, onEditInterval, onEditName, onEditOrder, onEditTrigger, onGroupChange, onGroupInterval, onGroupTrigger, onOpenPickerDraft, onPictureSlideSeconds, onToggleRotation, playableCount, sel } = ctx;
    // 图内过场的可选项（秒）。与主包 KINDS.pictureSlideSeconds 的 0..3600 上界一致：
    // 这里只是**常用档**；用户在别处写入的秒数若不在档上，补一条同值 option 回显
    //（否则 select 会因找不到匹配值显示空白，看起来像"设置丢了"）。
    const PICTURE_SLIDE_INTERVALS = [0, 5, 10, 15, 30, 60, 180, 300];
    const rawPictureSlideSeconds = Math.max(0, Math.min(3600, Math.round(Number(sel.pictureSlideSeconds) || 0)));
    const pictureSlideOptions = PICTURE_SLIDE_INTERVALS.includes(rawPictureSlideSeconds)
      ? PICTURE_SLIDE_INTERVALS
      : PICTURE_SLIDE_INTERVALS.concat([rawPictureSlideSeconds]).sort((a, b) => a - b);
    const groupToken = group ? "group:" + group.id : "";
    return React.createElement(React.Fragment, null,
    // ── 自动轮播: user-defined carousel lists, each with its own
    //    wallpaper set, interval and order. Persisted as `rotationGroups` (host config.json). ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("自动轮播")),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
      React.createElement("select", {
        className: "we-picker__playlist-select",
        value: sel.rotationGroupId,
        onChange: onGroupChange,
        disabled: groups.length === 0,
        "aria-label": weT("轮播列表"),
      },
      React.createElement("option", { value: "" }, groups.length ? weT("— 选择轮播列表 —") : weT("— 暂无轮播列表 —")),
      ...groups.map((g) => React.createElement("option", {
        key: g.id, value: g.id,
      }, weT("{name}（{count} 可播放 · {interval} 分钟）", { name: g.name, count: groupWallpapers(g).length, interval: g.interval }))),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: startCreateGroup,
      }, weT("新建")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => startEditGroup(sel.rotationGroupId),
        disabled: !sel.rotationGroupId,
      }, weT("编辑")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        // 第一下只置令牌（`onArmDeleteGroup`）；落地在下面那行问句的「确认」里。
        // 待确认时**置灰**（不隐藏、不换位置）：按钮仍占着那一格，宽度就完全不变，
        // 而且它指路到问句行 —— 留着可点会让"再点一下是不是就删了"变成猜测。
        onClick: onArmDeleteGroup,
        disabled: !sel.rotationGroupId || armedConfirm === groupToken,
        title: armedConfirm === groupToken
          ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
          : weT("删除这个轮播列表（会再问一次）"),
      }, weT("删除")),
    ),
    renderConfirmRow(armedConfirm, groupToken,
      weT("删除轮播列表「{name}」？此操作不可恢复。", { name: (group && group.name) || "" }),
      onDeleteGroup, onDisarmConfirm),
    editing && React.createElement("div", { className: "we-picker__editor" },
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("名称")),
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: editing.name,
          "aria-label": weT("轮播列表名称"),
          onInput: onEditName,
        }),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("间隔")),
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(editing.interval),
          onChange: onEditInterval,
          // 推进方式选了「视频播完」时，间隔不参与推进 —— 置灰但保留可见（用户切回来时还在）
          disabled: editing.trigger === "videoEnd",
          "aria-label": weT("轮播间隔"),
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, weT("{min} 分钟", { min: minutes })),
        )),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("推进")),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.trigger === "videoEnd" ? "videoEnd" : "interval",
          onChange: onEditTrigger,
          "aria-label": weT("轮播推进方式"),
        },
        React.createElement("option", { value: "interval" }, weT("按间隔")),
        React.createElement("option", { value: "videoEnd" }, weT("视频播完就换")),
        ),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("顺序")),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.order,
          onChange: onEditOrder,
          "aria-label": weT("轮播顺序"),
        },
        React.createElement("option", { value: "sequence" }, weT("顺序", null, "seq")),
        React.createElement("option", { value: "random" }, weT("随机")),
        ),
      ),
      // 选片走**页内下钻**（与「选择壁纸」同一套库视图）：点按钮进库浏览，
      // 卡片点击 = 加入/移出草稿（pickerDraft），顶部提示已选数；「返回」回编辑器。
      // 这里**只有一行入口按钮、没有内联网格**：大库在 24px 缩略图里翻页选片不可用，
      // 全尺寸浏览 + 搜索/过滤才是选片的正确形态。
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          onClick: onOpenPickerDraft,
        }, weT("选择壁纸")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("下钻进库挑选 · 点卡片加入 / 移出")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, weT("已选 {count} 个", { count: editing.wallpaperIds.length })),
        sel.inventory.playlists.length > 0 && React.createElement("select", {
          className: "we-picker__playlist-select",
          value: "",
          onChange: (e) => {
            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
            if (p) importPlaylistIntoDraft(p);
          },
        },
        React.createElement("option", { value: "" }, weT("从 WE 播放列表导入…")),
        ...sel.inventory.playlists.map((p) => React.createElement("option", {
          key: p.id, value: p.id,
        }, weT("{name}（{count} 可播放）", { name: p.name, count: p.portableCount || 0 }))),
        ),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: saveEditingGroup,
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: cancelEditGroup,
        }, weT("取消")),
      ),
    ),
    // 图内过场：图片 / 幻灯片壁纸**内部**多张图之间的切换间隔。与上面「自动轮转」
    //（壁纸与壁纸之间、分钟）是两件事 —— 这一项单位是秒，0 = 跟随 WE 项目里
    // `imageswitchtimes` 声明的那一档。只有当前这张真是「图集 ≥2 张」的图片项目才可用，
    // 其余档置灰并说明原因（常驻不隐藏：位置稳定，切到图片项目时不跳）。
    React.createElement("div", { className: "we-picker__ctl" },
      ctlText(weT("图片轮播"),
        (sel.type === "image" && sel.slidesUrl)
          ? weT("幻灯片壁纸内部多张图之间的切换间隔；「跟随壁纸」= 用 WE 里设的周期")
          : weT("当前壁纸不是多图图片项目，此项暂不生效")),
      React.createElement("div", { className: "we-picker__ctl-side" },
        React.createElement("select", {
          className: "we-picker__picture-slide-interval",
          value: String(sel.pictureSlideSeconds || 0),
          onChange: onPictureSlideSeconds,
          disabled: !(sel.type === "image" && sel.slidesUrl),
          "aria-label": weT("图片轮播间隔"),
        },
        ...pictureSlideOptions.map((sec) =>
          React.createElement("option", { key: sec, value: String(sec) },
            sec === 0 ? weT("跟随壁纸") : (sec < 60 ? weT("{n} 秒", { n: sec }) : weT("{n} 分钟", { n: sec / 60 }))),
        )),
      ),
    ),
    // #255②：「自动轮转」是**列表的**开关 —— 没选列表 / 列表编辑器展开时整行不渲染。
    // 旧实现让这一行常驻，没列表时只能显示一句「请先选择或新建一个轮播列表」，
    // 相当于在设置页里放了一行永远点不动的控件。
    (sel.rotationGroupId && !editing) && React.createElement("div", { className: "we-picker__ctl" },
      ctlText(weT("自动轮转"),
        playableCount < 2
          ? weT("当前列表至少需要 2 个可播放壁纸")
          : (group && group.trigger === "videoEnd")
            ? weT("当前视频播完就换下一张（不看间隔）")
            : weT("每 {min} 分钟切换一次", { min: group ? group.interval : rotationIntervalDefault })),
      React.createElement("div", { className: "we-picker__ctl-side" },
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(group ? group.interval : rotationIntervalDefault),
          onChange: onGroupInterval,
          disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2
            || (group && group.trigger === "videoEnd"),
          "aria-label": weT("轮转间隔"),
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, weT("{min} 分钟", { min: minutes })),
        )),
        // 推进方式：按间隔 / 视频播完就换。常驻行直接可改（不必进「编辑」），
        // 与列表编辑器里的同名字段（onEditTrigger）写同一个 group.trigger。
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: group && group.trigger === "videoEnd" ? "videoEnd" : "interval",
          onChange: onGroupTrigger,
          disabled: !sel.rotationGroupId,
          "aria-label": weT("轮播推进方式"),
        },
        React.createElement("option", { value: "interval" }, weT("按间隔")),
        React.createElement("option", { value: "videoEnd" }, weT("视频播完就换")),
        ),
        Toggle({
          checked: sel.rotationEnabled,
          onChange: onToggleRotation,
          label: weT("自动轮转"),
          disabled: !sel.rotationGroupId || playableCount < 2,
          title: weT("按列表顺序/随机自动切换壁纸"),
        }),
      ),
    ),
    ),
    );
  }

export { renderWallpaperRotationSection };
