/**
 * about-assets.js — 「关于」页签与「更新公告」用到的**静态数据**（仓库地址 + 随包图的路径）。
 *
 * 二维码用随包 PNG（用户要求），**不内联 base64** —— 内联会把两张图压进 `lib/client.js`
 * （+240KB，每次冷启动随 bundle 一起解析），而它们与面板逻辑毫无关系。图是随包资源
 * `lib/about/*.png`，由宿主路由 `GET <BASE>/about-qr/<文件名>` 直出
 * （白名单 + ETag/304，见 packages/about-notice/lib/routes/about-qr.js）；本文件只留**路径**，`<img src>` 经
 * `apiUrl()` 拼前缀，换码只要替换那两个 PNG，不必重建客户端产物。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域）：纯数据、零依赖，
 * 必须保持浏览器安全（无 import / require / Node API）。
 */

// 项目仓库（README / package.json 的同一条地址）：关于页的按钮与可复制文本都用它。
const ABOUT_REPO_URL = "https://github.com/elysia395/dsh-wallpaper-engine";

// 两张二维码的**路由路径**（相对 BASE，交给 apiUrl 拼前缀）：
//   · QQ 群「DSHWE | LLM 讨论群」     → lib/about/qq-group.png
//   · 抖音群「dsh 交流群」            → lib/about/douyin-group.png
// 文件名与 packages/about-notice/lib/routes/about-qr.js 的白名单**逐字相同**（守卫两边对账）。
const ABOUT_QR_QQ_PATH = "/about-qr/qq-group.png";
const ABOUT_QR_DOUYIN_PATH = "/about-qr/douyin-group.png";

// 「更新公告」一次弹窗的配图（v1.3.0 起：GitHub 求星插画，JPEG 720×720）：
//   · 派生自 assets/about/update-notice-star-1254x1254.png（缩到 720px、JPEG q88）
//   · 随包发布 lib/about/update-notice.jpg，由 /about-qr 路由族直出（同一白名单）
//   · 版本换图 = 替换 lib/about/update-notice.jpg 的字节，路径与产物都不动（ETag 会变）。
const NOTICE_ART_PATH = "/about-qr/update-notice.jpg";

export {
  ABOUT_REPO_URL,
  ABOUT_QR_QQ_PATH,
  ABOUT_QR_DOUYIN_PATH,
  NOTICE_ART_PATH,
};
