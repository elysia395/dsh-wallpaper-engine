#!/usr/bin/env node
/**
 * verify-we-folders.mjs —— issue #264「选择器复刻 WE 的已安装文件夹」的四段判据。
 *
 * 回答的问题：**WE 自己整理好的文件夹，插件是不是真的读到了、并且只影响它该影响的那一栏。**
 * 在此之前没有任何守卫碰 `<安装根>/config.json` 的 `general.folders`（播放列表有
 * `readPlaylistsP` 的消费者，但文件夹是另一个字段）。
 *
 *   ① **宿主读取**：`readFoldersP` 的树形（嵌套 subfolders）、跨 profile 去重、空夹过滤、
 *      id 可解释（base64url(profile + 名称路径)）、坏 JSON / 无 config 不得抛。
 *   ② **清单映射**：文件夹成员键（workshop id / 本地项目路径）→ 壁纸 id 仍走
 *      `playlistItemId` 那**一条**解析（两个真源会让文件夹与播放列表对同一张壁纸给出不同答案）。
 *   ③ **客户端筛选**：`pickerModel` 的文件夹档**只收窄网格**，不碰轮换编辑器候选
 *      （改一次筛选不该改动轮播）。
 *   ④ **设置键**：`folderFilter` 在 schema 里（默认 `"all"`）—— 不在就说明写进去的值
 *      会被 sanitize 静默丢掉，界面每次都跳回「全部」。
 *
 * 判据纪律（docs/DEV-GUIDE.md §4.7 约定 5）：每条判据只定义一次，负对照喂**变异输入**
 * （变异夹具 / 变异期望 / 变异源码），不另抄一份判据。
 *
 * Usage: node test/verify-we-folders.mjs
 */
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWallpaperScanKit } from '../lib/wallpaper-scan.js';
import { DEFAULTS, KINDS, PRESET_EXCLUDED_KEYS } from '../lib/settings-schema.js';
import { pickerModel } from '../src/picker-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// ── 判据本体（正判据与负对照共用）──────────────────────────────────────────────
const kit = createWallpaperScanKit({
  WE_APPID: '431960',
  pathExistsP: async () => true,
  isFileP: async () => true,
  isDirectoryP: async () => true,
});

/** 判据：树 → 「名称 / 直接成员数 / 子夹」的投影。负对照换的是**期望**，不是这条。 */
const treeShape = (nodes) => nodes.map((n) => [n.name, n.items.length, treeShape(n.subfolders)]);
const sameShape = (nodes, want) => JSON.stringify(treeShape(nodes)) === JSON.stringify(want);
/** id 是 `base64url(profile + \0 + 名称路径)`：解出来能回答「这是谁的哪个夹子」。 */
const decodeFolderId = (id) => Buffer.from(id, 'base64url').toString('utf8').split('\0');

// 贴近真实的夹具：文件夹在 `general.browser.folders`（WE 2.x 实测位置）；R18 在
// **两个 Steam profile** 里各存一份（内容相同 ⇒ 只出去一份）、一个自身没有成员的父夹
// （只靠子夹存活）、一个空夹（必须被丢掉）。另有一份把 folders 放在 `general.folders`
// 的旧布局夹具，用来钉住「两种布局都认」。
const FIXTURE = {
  cream: {
    general: {
      browser: {
        folders: [
          { type: 'folder', title: 'R18', items: { 1186645315: 1, 2861659344: 1 }, subfolders: [] },
          {
            type: 'folder', title: 'Wallpapers', items: {}, subfolders: [
              { type: 'folder', title: 'Night', items: { 3002543195: 1 }, subfolders: [] },
            ],
          },
          { type: 'folder', title: 'Empty', items: {}, subfolders: [] },
        ],
      },
    },
  },
  other: {
    general: {
      browser: {
        folders: [
          { type: 'folder', title: 'R18', items: { 1186645315: 1, 2861659344: 1 }, subfolders: [] },
        ],
      },
    },
  },
};
const LEGACY_FIXTURE = {
  cream: {
    general: {
      folders: [{ type: 'folder', title: 'Old', items: { 1: 1 }, subfolders: [] }],
    },
  },
};
const EXPECTED_SHAPE = [
  ['R18', 2, []],
  ['Wallpapers', 0, [['Night', 1, []]]],
];

async function withInstallDir(configText, run) {
  const dir = await mkdtemp(join(tmpdir(), 'we-folders-'));
  try {
    await mkdir(dir, { recursive: true });
    if (configText !== null) await writeFile(join(dir, 'config.json'), configText);
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── ① 宿主读取 ────────────────────────────────────────────────────────────────
const folders = await withInstallDir(JSON.stringify(FIXTURE), (dir) => kit.readFoldersP(dir));
check('① 嵌套 / 去重 / 空夹：树形与期望一致（R18 两个 profile 只出一份，Empty 不出现）',
  sameShape(folders, EXPECTED_SHAPE), JSON.stringify(treeShape(folders)));
check('① 负对照：变异期望（Wallpapers 成员数写成 1）⇒ 同一条判据判红',
  !sameShape(folders, [['R18', 2, []], ['Wallpapers', 1, [['Night', 1, []]]]]));
check('① 只有子夹的父夹也保留（自身 0 成员不算"空夹"）',
  folders.some((n) => n.name === 'Wallpapers' && n.subfolders.length === 1));
check('① id 可解释：base64url 解出 `profile\\0名称路径`（子夹带完整路径）',
  decodeFolderId(folders[0].id).join('/') === 'cream/R18'
  && decodeFolderId(folders[1].subfolders[0].id).join('/') === 'cream/Wallpapers/Night',
  decodeFolderId(folders[1].subfolders[0].id).join('/'));
check('① 负对照：同一份 config 但把 R18 改名 ⇒ id 跟着变（不是随便一个序号）',
  await withInstallDir(JSON.stringify({
    cream: { general: { browser: { folders: [{ type: 'folder', title: 'Renamed', items: { 1: 1 }, subfolders: [] }] } } },
  }), (dir) => kit.readFoldersP(dir)).then((r) => decodeFolderId(r[0].id)[1] === 'Renamed'));
check('① 旧布局 general.folders 也认（同一读者，两种落点）',
  await withInstallDir(JSON.stringify(LEGACY_FIXTURE), (dir) => kit.readFoldersP(dir))
    .then((r) => r.length === 1 && r[0].name === 'Old'));
check('① 负对照：夹具换成"没有 folders 字段"的同一份 config ⇒ 空数组',
  await withInstallDir(JSON.stringify({ cream: { general: { browser: { playlists: [] } } } }), (dir) => kit.readFoldersP(dir))
    .then((r) => r.length === 0));
check('① 坏 JSON 不得抛（返回空数组）',
  await withInstallDir('{ not json', (dir) => kit.readFoldersP(dir))
    .then((r) => Array.isArray(r) && r.length === 0));
check('① config.json 不存在 ⇒ 空数组',
  await withInstallDir(null, (dir) => kit.readFoldersP(dir)).then((r) => r.length === 0));

// ── ② 清单映射：成员 → 壁纸 id（纯函数 foldersWithIds）───────────────────────
{
  // ⚠️ `byId` 的值在**生产代码里是壁纸条目对象**（`playlistItemId` 取 `project.id`）。
  // 夹具照生产形状来 —— 喂字符串会让「成员被当成对象返回」这个真实缺陷溜过去（实测撞过）。
  const byPath = new Map([['e:\\steam\\steamapps\\workshop\\content\\431960\\3158822835\\scene.pkg', '3158822835']]);
  const byId = new Map([
    ['1186645315', { id: '1186645315', title: 'A' }],
    ['3158822835', { id: '3158822835', title: 'B' }],
    ['alpha', { id: 'alpha', title: 'Alpha' }],
  ]);
  const raw = [
    {
      id: 'f1', name: 'Mixed', subfolders: [
        { id: 'f1a', name: 'Inner', items: ['3158822835'], subfolders: [] },
      ],
      // 三种成员形态：裸工坊 id / 相对安装根的本地项目 / 映射不上的残留 id。
      // `3158822835` 在父子夹里**都**出现 —— 并集必须去重。
      items: ['1186645315', 'projects\\myprojects\\alpha', '3158822835', '999999'],
    },
    { id: 'f2', name: 'AllMissing', items: ['888888', '777777'], subfolders: [] },
  ];
  const mapped = kit.foldersWithIds(raw, byPath, byId);
  check('② 成员映射：裸 id + 相对路径 + 丢弃残留 ⇒ [1186645315, alpha, 3158822835]',
    JSON.stringify(mapped.map((f) => f.wallpaperIds)) === JSON.stringify([[ '1186645315', 'alpha', '3158822835' ]]),
    JSON.stringify(mapped.map((f) => f.wallpaperIds)));
  check('② 计数与播放列表同口径：total=3 / unresolvedCount=1',
    mapped[0].total === 3 && mapped[0].unresolvedCount === 1,
    'total=' + mapped[0].total + ' unresolved=' + mapped[0].unresolvedCount);
  check('② 嵌套子夹保留（父夹自身成员与子夹各自计数）',
    mapped[0].subfolders.length === 1
    && mapped[0].subfolders[0].wallpaperIds.join(',') === '3158822835');
  // 选父夹要连子夹一起看（WE 的树是"父夹包含子夹"）；父子重复的 id 只算一次。
  check('② deepWallpaperIds = 自身 ∪ 子夹，且去重（父子同 id 不重复）',
    mapped[0].deepWallpaperIds.join(',') === '1186645315,alpha,3158822835',
    mapped[0].deepWallpaperIds.join(','));
  check('② deepUnresolvedCount = 自身 + 各子夹的残留数',
    mapped[0].deepUnresolvedCount === 1 && mapped[0].subfolders[0].deepUnresolvedCount === 0);
  // 真实缺陷形态：父夹自己 0 成员、只有子夹 ⇒ 只按直接成员过滤会得到 0 张（空网格）。
  const parentOnly = kit.foldersWithIds([{
    id: 'p', name: 'Parent', items: [],
    subfolders: [{ id: 'c', name: 'Child', items: ['3158822835'], subfolders: [] }],
  }], byPath, byId);
  check('② 父夹 0 直接成员、只有子夹 ⇒ deepWallpaperIds 仍有 1 张（否则选中父夹是空网格）',
    parentOnly.length === 1 && parentOnly[0].wallpaperIds.length === 0
    && parentOnly[0].deepWallpaperIds.join(',') === '3158822835');
  check('② 负对照：同一条判据对"只读直接成员"的输入判红',
    parentOnly[0].wallpaperIds.join(',') !== '3158822835');
  check('② 空夹（成员全部映射失败）被丢弃',
    mapped.length === 1 && mapped.every((f) => f.name !== 'AllMissing'));
  check('② 负对照：映射表清空 ⇒ 整棵为空（与"空夹丢弃"共用同一判据）',
    kit.foldersWithIds(raw, new Map(), new Map()).length === 0);

  const inventorySrc = await readFile(resolve(ROOT, 'lib', 'inventory.js'), 'utf8');
  // 判据：清单把 readFoldersP 的结果交给 foldersWithIds（唯一一处映射），并挂进载荷。
  const wiresFolders = (src) => /foldersWithIds\(await readFoldersP\(installDir\), byPath, byId\)/.test(src)
    && /^\s*folders,$/m.test(src);
  check('② 清单：readFoldersP → foldersWithIds → folders 进载荷',
    wiresFolders(inventorySrc));
  check('② 负对照：把 readFoldersP 换成 readPlaylistsP（同一处变异源码）⇒ 判据判红',
    !wiresFolders(inventorySrc.replace(/readFoldersP\(installDir\)/g, 'readPlaylistsP(installDir)')));
}

// ── ③ 客户端筛选：只收窄网格，不动轮换候选 ────────────────────────────────────
{
  const w = (id) => ({ id, title: id, type: 'video', playable: true, contentrating: 'Everyone' });
  const wallpapers = [w('a'), w('b'), w('c')];
  const idsOf = (list) => list.map((x) => x.id).join(',');
  const withFolder = (folderFilter, folderWallpaperIds) => pickerModel({
    wallpapers, hiddenIds: [], search: '', ratingFilter: 'all', typeFilter: 'all',
    folderFilter, folderWallpaperIds,
  });
  check('③ 选中文件夹 ⇒ 网格只留成员', idsOf(withFolder('f1', ['a', 'c']).playableList) === 'a,c',
    idsOf(withFolder('f1', ['a', 'c']).playableList));
  check('③ 轮换编辑器候选不受文件夹档影响（换筛选不改轮播）',
    idsOf(withFolder('f1', ['a', 'c']).editorList) === 'a,b,c',
    idsOf(withFolder('f1', ['a', 'c']).editorList));
  check('③ 负对照：folderFilter="all" ⇒ 网格恢复全量',
    idsOf(withFolder('all', ['a', 'c']).playableList) === 'a,b,c');
  check('③ 负对照：成员表是空数组 ⇒ 网格为空（不是"没筛"）',
    withFolder('f1', []).playableList.length === 0);
}

// ── ④ 设置键 ──────────────────────────────────────────────────────────────────
check('④ schema 里有 folderFilter，默认 "all"', DEFAULTS.folderFilter === 'all', String(DEFAULTS.folderFilter));
check('④ 校验种类是自由字符串（id 由宿主生成，不能是固定枚举）',
  Boolean(KINDS.folderFilter) && KINDS.folderFilter.kind === 'str');
check('④ 负对照：不存在的键读不到（判据不是恒真）', KINDS.folderFilterThatDoesNotExist === undefined);
// 文件夹 id 只在本机成立（profile + 名称路径的 base64url）⇒ 不许随「整机配置预设」跨机搬。
check('④ folderFilter 不进预设（跨机导入只会得到指向别人家夹子的 id）',
  PRESET_EXCLUDED_KEYS.includes('folderFilter'));
check('④ 负对照：预设排除表读得到、且不是空的（上面那条不是空对空）',
  Array.isArray(PRESET_EXCLUDED_KEYS) && PRESET_EXCLUDED_KEYS.includes('id'));

if (failed) {
  console.log('\nWE FOLDERS CHECKS FAILED — ' + failed + ' failed');
  process.exitCode = 1;
} else {
  console.log('\nALL WE FOLDER CHECKS PASSED');
}
