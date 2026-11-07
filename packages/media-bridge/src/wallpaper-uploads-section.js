/**
 * wallpaper-uploads-section.js — 「壁纸库」页签第四节「自定义壁纸」的渲染器。
 *
 * 父页签 renderWallpaperTab 仍在主包组装点（`src/panel-tabs.js`），按面板节注册表
 * （`src/extension-registry.js`）的顺序续接本包的节（library / order 40）。
 *
 * 归属（ADR-0013 D20）：随包走的是**渲染器**；上传目录 / 官方资源目录 / 上传列表 /
 * 确认令牌这些键、默认值、持久化与动作体全留主包，本文件只读 ctx 值 + 经 host 显式键集
 * 调主包动作。键集真源 = `src/host-bridge.js` 的 `HOST_BRIDGE_BINDINGS`（71 键；ADR-0014 S5.1），
 * 本包的申报表是 `WALLPAPER_SECTIONS_HOST_REQUIRED`（`packages/media-bridge/src/client.js`，
 * 源码留空表，构建期从同文件的 `} = host;` 解构逐键派生）。
 *
 * 唯一跨包通道 = 主 bundle 的显式键集（ADR-0014 S5.1 / S5.4）；本文件里出现的 React / weT /
 * changeUploadDir / changeWeAssetsDir / uploadWallpaperFile / removeUploadWallpaper /
 * renderConfirmRow 都会由构建期配方内联后的入口从 host 解构进**同一个工厂作用域**。
 */
  function renderWallpaperUploadsSection(ctx) {
    const { armedConfirm, group, onArmConfirm, onCancelEditUploadDir, onCancelEditWeAssetsDir, onDisarmConfirm, onStartEditUploadDir, onStartEditWeAssetsDir, onUploadDirDraft, onWeAssetsDirDraft, playableCount, playableList, sel, uploadedList } = ctx;
    const uploadToken = (w) => "upload:" + w.id;
    return React.createElement(React.Fragment, null,
    // ── 自定义壁纸: local JPG/PNG/MP4 as wallpapers. Files are written by the
    //    host into its plugin-managed directory and served through the same
    //    media/preview routes (read-A storage: survives restarts, no quota
    //    limits). Uploads merge into the inventory on the host side. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("自定义壁纸")),
      ),
      React.createElement("div", { className: "we-picker__uploads" },
      // Storage location — users can point uploads at a non-system drive
      // (most people don't want wallpaper files piling up on C:). The host
      // persists the choice and migrates existing files on change.
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("存储位置")),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.uploadDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: onStartEditUploadDir,
        }, weT("更改")),
      ),
      sel.editingUploadDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: sel.uploadDirDraft,
          placeholder: weT("绝对路径，如 D:\\MyWallpapers"),
          onInput: onUploadDirDraft,
          onKeyDown: (e) => {
            if (e.key === "Enter") changeUploadDir(sel.uploadDirDraft, true);
            if (e.key === "Escape") onCancelEditUploadDir();
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: () => changeUploadDir(sel.uploadDirDraft, true),
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onCancelEditUploadDir,
        }, weT("取消")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          weT("已有文件会迁移到新位置")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("支持 ~ 表示用户主目录")),
      ),
      // ── 官方资源路径（local-assets）：场景实时渲染的 util、particle、
      // gradient 贴图默认是程序化复刻（观感近似）；指向本机 WE 安装目录的
      // assets 树后按名取官方像素，与官方引擎逐像素对齐。素材属 WE 版权
      // 内容，只从本机路径只读取用，不会被复制/上传。路径不硬编码 ——
      // 持久化在宿主 config.json（weAssetsDir），经 we-assets-dir 端点读写。
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("官方资源路径")),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.weAssetsDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onStartEditWeAssetsDir,
        }, sel.inventory.weAssetsDir ? weT("更改") : weT("设置")),
      ),
      sel.editingWeAssetsDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: sel.weAssetsDirDraft,
          placeholder: weT("WE assets 绝对路径，留空保存=清除"),
          onInput: onWeAssetsDirDraft,
          onKeyDown: (e) => {
            if (e.key === "Enter") changeWeAssetsDir(sel.weAssetsDirDraft);
            if (e.key === "Escape") onCancelEditWeAssetsDir();
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => changeWeAssetsDir(sel.weAssetsDirDraft),
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onCancelEditWeAssetsDir,
        }, weT("取消")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          sel.inventory.weAssetsAvailable
            ? weT("已启用 · 场景实时渲染取官方像素")
            : (sel.inventory.weAssetsDir
              ? weT("目录不可用（缺 materials/），场景实时渲染走程序化复刻")
              : weT("未配置 · 场景实时渲染贴图走程序化复刻"))),
        React.createElement("span", { className: "we-picker__hint" },
          weT("指向 Wallpaper Engine 安装目录的 assets（或其拷贝）")),
      ),
      sel.weAssetsError && React.createElement("div", { className: "we-picker__error" },
        sel.weAssetsError,
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("自定义")),
        React.createElement("input", {
          className: "we-picker__file", type: "file",
          accept: ".jpg,.jpeg,.png,.mp4",
          disabled: sel.uploading,
          onChange: (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) uploadWallpaperFile(f);
            e.target.value = "";
          },
        }),
        sel.uploading && React.createElement("span", { className: "we-picker__hint" }, weT("上传中…")),
      ),
      sel.uploadError && React.createElement("div", { className: "we-picker__error" }, sel.uploadError),
      sel.uploadNote && React.createElement("div", { className: "we-picker__note" }, sel.uploadNote),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, weT("已上传 {count} 个", { count: uploadedList.length })),
        React.createElement("span", { className: "we-picker__hint" }, weT("支持 JPG / PNG / MP4，及含 project.json 的 WE 壁纸目录")),
      ),
      uploadedList.length > 0 && React.createElement("div", { className: "we-picker__uploads-list" },
        uploadedList.map((w) => React.createElement(React.Fragment, { key: w.id },
          React.createElement("div", { className: "we-picker__uploads-item" },
          React.createElement("span", { className: "we-picker__uploads-name", title: w.title }, w.title),
          React.createElement("span", { className: "we-picker__hint" }, w.type === "video" ? "MP4" : weT("图片")),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            // **会删本地文件** ⇒ 这一处最需要两下：第一下只置令牌。
            onClick: () => onArmConfirm(uploadToken(w)),
            disabled: sel.uploading || armedConfirm === uploadToken(w),
            title: armedConfirm === uploadToken(w)
              ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
              : weT("移除这个自定义壁纸（会再问一次，且会删除本地文件）"),
          }, weT("移除")),
          ),
          // 问句行紧跟它自己那一项（挂在同一个 `key` 下，位置不会串到别的壁纸那里）。
          renderConfirmRow(armedConfirm, uploadToken(w),
            weT("移除自定义壁纸「{name}」？此操作会删除本地文件，且不可恢复。", { name: w.title }),
            () => removeUploadWallpaper(w.id), onDisarmConfirm),
        )),
      ),
      ),
    ),
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint" },
        (group
          ? weT("列表「{name}」：{count} 项 · {playable} 可播放 · 每 {interval} 分钟 · {order}{rotating}", {
            name: group.name,
            count: group.wallpaperIds.length,
            playable: playableCount,
            interval: group.interval,
            order: group.order === "random" ? weT("随机") : weT("顺序", null, "seq"),
            rotating: sel.rotationEnabled ? weT(" · 自动轮转中") : "",
          })
          : weT("{count} 个可播放壁纸{rotating}", { count: playableList.length, rotating: sel.rotationEnabled ? weT(" · 自动轮转中") : "" }))),
    ),
    );
  }

// 挂载台（test/verify-scene-live.mjs 等）按文件 import 本模块时没有构建期内联作用域，
// 所以必须显式导出；构建期配方（packages/media-bridge/client.build.json）会把这段 export 剥掉
// （与 packages/fonts/src/appearance-font-section.js 尾部同款）。
export { renderWallpaperUploadsSection };
