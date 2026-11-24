# 上手地图（改 UI / 加功能）

> 本文件是本地笔记，未纳入 git。项目本体见 [README.md](README.md)、规则见 [AGENTS.md](AGENTS.md)。

## 0. 环境已就绪（我这边已验证）

| 项 | 状态 |
|---|---|
| Node / npm | v24.14.0 / 11.9.0（要求 ≥22.12） |
| 依赖 | `npm ci` 成功，390 包 |
| 踩坑 1 | `~/.npm` 有 root 残留导致 EPERM → 改用项目内缓存 `--cache ./.npm-cache` |
| 踩坑 2 | `prebuild:react` 会从 raw.githubusercontent 拉 24 个 AVPlayer WASM，单文件 60s 超时 → 已用 jsDelivr 预取到 `public/software/`（16 MB，SHA256 全部校验通过），脚本现在会直接跳过 |
| 踩坑 3 | `npm ci` 时 Electron 的 postinstall 静默失败（`node_modules/electron/dist` 缺失，`npx electron` 会一直挂着下载）→ 已补装：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ electron_config_cache=$PWD/.electron-cache node node_modules/electron/install.js`；Electron **v24.22.0** 已就位 |
| 踩坑 4 | `~/Library/Caches` 不可写（EPERM）→ 所有缓存都指到项目内：`.npm-cache/`、`.electron-cache/`（装完可删，共 175 MB） |
| 构建 | `npm run build:react` ✅ 802 ms → `dist-react/`；`node --check` 主进程/preload/native 全通过 |

## 1. 常用命令

```bash
npm run dev          # Vite(5173) + Electron 窗口，热更新，日常改 UI 用这个
npm run build:react  # 只构建前端
npm run test         # scripts/test.cjs
npm run build:mac    # 会先编译 FFmpeg/x264，首次几分钟，别轻易跑
```

> 只想调样式时也可以 `npx vite` 开浏览器版，但 `window.electronAPI` 不存在，涉及 IPC 的页面会报错。

## 2. 目录地图（改 UI 只需要这几处）

| 文件 | 作用 | 规模 |
|---|---|---|
| `index.html` | 入口 + CSP（加了新协议/外链要改 CSP） | 21 行 |
| `src/main.jsx` | 挂载 App、ErrorBoundary、初始化语言/海报尺寸 | 20 行 |
| `src/App.jsx` | **侧边栏 MENU、9 个页面 switch、横竖屏/小窗/置顶/隐藏按钮** | 299 行 |
| `src/components/*.jsx` | 33 个页面/面板组件，各自同名 `.css`（22 个） | 最大 Player 2474 行 |
| `src/index.css` | 全局样式、CSS 变量、深浅色 | 182 行 |
| `src/theme.js` | 主题（system/light/dark）+ 海报尺寸 → `<html data-theme data-poster-size>` | 51 行 |
| `src/i18n/` | 文案字典：`en.json`(104 KB)、`templates.json`、`index.js`、`translator.mjs` | — |
| `src/store.js` | 前端状态与持久化 | 449 行 |
| `preload.js` | **141 个 IPC 方法**，暴露成 `window.electronAPI.*` | 286 行 |
| `main.js` | 主进程：源解析、下载、转码、代理、窗口、自定义协议 | 5849 行 |
| `src/native/` | **真正的后端**：`app-source.js`(58 KB，源与签名)、`danmaku-sign.js`、下载/合并/账号… 每个都有 `.test.cjs` | 105 个文件 |
| `server/` | Docker 版 Web/API | — |

## 3. 九个页面 → 文件

| page id | 组件 | 行数 |
|---|---|---|
| `browse` 发现短剧 | `Browse.jsx` | 840 |
| `feed` 热播推荐 | `DramaFeed.jsx` | — |
| `download` 搜索与下载 | `HongguoDownload.jsx` | 563 |
| `player` 我的剧库 | `Player.jsx` | 2474 |
| `history` 观看记录 | `WatchHistory.jsx` | — |
| `calendar` 收藏与上新 | `ReleaseCalendar.jsx` | — |
| `manager` 下载管理 | `DownloadManager.jsx` | 911 |
| `account` 红果账号 | `AccountManagement.jsx` | — |
| `settings` 设置 | `Settings.jsx` + `AppearanceSettings` / `LanguageSettings` / `BossKeySettings` / `BuiltinSources` / `CustomSources` | 594 |

## 4. 五类改动的落点

1. **改文案** → `src/i18n/`。组件里所有中文都过 `t('...')`；新字符串必须进字典，否则英文界面会回落中文。
2. **加页面 / 加 tab** → `App.jsx` 的 `MENU` 数组 + `renderPage()` 的 switch；`visited` 控制惰性挂载。
3. **改样式** → 对应组件的同名 `.css`；全局变量和深浅色在 `src/index.css` 的 `[data-theme]` 下。
4. **改窗口/布局** → `App.jsx` 的 `layout`/`stealthMode`/`borderless` 状态 → `window.electronAPI.setWindowLayout()` → `main.js`。
5. **加功能（要动数据）** → 三处：`preload.js` 加方法 → `main.js` 里 `ipcMain.handle` → `src/native/` 里实现逻辑。

## 5. 四个坑（会咬人）

- **页面保活**：`visited.map(...)` 用 `hidden` 切页，组件不会卸载。副作用要么放 `active` 里，要么自己清理。
- **i18n 双向**：改中文要同步 `en.json`；`templates.json` 是模板/占位符机制，别绕开。
- **CommonJS**：主进程/preload/native 都是 CJS。**不要**给 `package.json` 加 `"type": "module"`（AGENTS.md 明确禁止）。
- **测试素材**：按 AGENTS.md，播放类验收必须真实下载红果剧集、全程静音，禁止彩条图。

## 6. 和逆向那款（Go/Wails）的对应关系

| 逆向产物 | 本项目对应 |
|---|---|
| `pkg/hgapi` + `pkg/crypto`（签名栈） | `src/native/app-source.js` + `danmaku-sign.js` |
| `pkg/media/proxy` + `pkg/media/cenc` | `main.js` 的 `hongguo-stream:` / `hongguo-local:` 协议 + 转码 |
| `pkg/service/player` | `Player.jsx` + `main.js` 播放会话 |
| `internal/update` + `pkg/updproto` | `app-update-installer.js` + `electron-updater` |
| 前端 156 个 Wails 绑定 | `preload.js` 141 个 IPC 方法 |

两边都用 **Anime4K WebGPU** 做画质增强 —— 本项目那个 3.45 MB 的 chunk 就是它，这也是为什么两款的包体积很接近。

## 7. 许可

GPL-3.0：改了再分发（含发安装包）必须开源对应修改。自己用/内部改无所谓。
