# 云声官网 · 部署手册

纯静态站点：零框架、零构建步骤、零后端、零外部 CDN。约 62 KB 全站资源，Cloudflare Pages 免费额度完全够用。

```
yunsheng-site/
├── public/                     ← 只有这个目录会被部署
│   ├── index.html              首页（Hero + 抽象云 / 界面 / 功能 / 更新日志 / 安装 / 下载 / FAQ）
│   ├── 404.html                Cloudflare Pages 自动接管的自定义 404
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── _headers                Pages 专用：CSP 安全头 + 缓存策略
│   ├── assets/
│   │   ├── style.css           全部样式，无外部字体、无 CDN 请求
│   │   ├── app.js              渲染发布数据、进场动画、图廊自动滚动、截图大图
│   │   ├── favicon.svg
│   │   └── screens/            六张真机截图，720w + 1080w 两档（共 2.3 MB）
│   └── data/
│       └── releases.json       GitHub Releases 快照（由脚本生成，勿手改）
├── update-releases.mjs         抓 GitHub Releases → 生成 data/releases.json
├── server.mjs                  本地预览服务器（模拟 Pages 行为）
├── setup.ps1                   一键替换占位域名
├── package.json
└── .github/workflows/
    └── sync-releases.yml       发版后自动刷新快照并触发重新部署
```

---

## 一、上线前 2 分钟

### 1. 换掉占位域名

站点里的占位域名 `yunsheng.example.xyz` 已经替换成 **0721ciallo.xyz**（出现在 `index.html` 的 canonical、og:url、JSON-LD，以及 `sitemap.xml`、`robots.txt`）：

```powershell
cd D:\py\yunsheng-site
.\setup.ps1 -Domain "0721ciallo.xyz"
```

如果以后换域名，把上面的参数换成新域名再跑一次即可，脚本是幂等的（找不到占位符就跳过）。

### 2. 确认仓库指向

`public/assets/app.js` 顶部：

```js
var OWNER = 'wang111928';
var REPO  = 'yunsheng-player';
```

现在的值就是你已有的仓库，通常不用改。改了以后：版本号、下载按钮直链、体积、日期、SHA-256、更新日志全部自动跟着 GitHub Releases 走。

### 3. 本地看一眼

```powershell
npm run dev            # → http://127.0.0.1:8088
```

---

## 二、部署（三选一）

### 方案 A：命令行直传（最快）

```powershell
npm install -g wrangler
wrangler login
cd D:\py\yunsheng-site
npm run deploy
```

首次会询问是否创建项目 → 选 yes，生产分支填 `main`。结束后打印 `https://yunsheng.pages.dev`。

### 方案 B：Git 自动部署（推荐长期使用）

1. 新建仓库，把 `yunsheng-site/` 全部内容推上去（`public/` 必须保留层级）。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 构建配置全部留空：
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`public`
4. Save and Deploy。此后每次 `git push` 或 Actions 提交快照，都会自动重新发布。

### 方案 C：拖拽上传

Dashboard → Workers & Pages → Create → Pages → **Upload assets** → 拖入 `public` 文件夹内容 → Deploy。

> 注意拖拽时进到 `public` 里面再拖，否则站点根目录会多一层 `public/`。

---

## 三、绑定 .xyz 域名

域名已在 Cloudflare 托管，这一步几乎是自动的：

1. Pages 项目 → **Custom domains** → **Set up a custom domain** → 填你的 `.xyz`，再加一条 `www`。
2. NS 已在 Cloudflare 时它会自动写 CNAME，状态 `Initializing → Active` 一般 1–3 分钟。

手动建也行：

| 类型 | 名称 | 目标 | 代理 |
|---|---|---|---|
| CNAME | `@` | `yunsheng.pages.dev` | 已代理（橙云） |
| CNAME | `www` | `yunsheng.pages.dev` | 已代理（橙云） |

根域 CNAME 依赖 Cloudflare 默认开启的 CNAME Flattening，直接填即可。

**如果一直卡在 Initializing**，检查两件事：

1. 阿里云控制台里域名的 NS 是否真的改成了 Cloudflare 给的两个 NS —— 没改的话 Cloudflare 侧所有配置都不会生效。
2. Cloudflare DNS 里是否还留着阿里云时期指向旧 IP 的 A/AAAA 记录，删掉，否则和 Pages 的 CNAME 冲突。

### 建议一并打开的开关

| 位置 | 设置 | 值 |
|---|---|---|
| SSL/TLS → Overview | 加密模式 | Full (strict) |
| SSL/TLS → Edge Certificates | Always Use HTTPS | 开 |
| SSL/TLS → Edge Certificates | Automatic HTTPS Rewrites | 开 |
| Speed → Optimization | Brotli | 开 |
| Caching → Configuration | Browser Cache TTL | 4 hours |
| Rules → Redirect Rules | `www` → 根域（可选） | 301 |

**国内访问说明**：Cloudflare 免费版大陆方向走境外节点（香港/新加坡/美西），首屏多 300–800 ms。本站已按此优化：单 CSS、单 JS、零字体、零第三方 CDN、图形全是 CSS 渐变与内联 SVG，全站 62 KB。要再快只有两条路——备案后接国内 CDN，或把 `public/` 同步一份到阿里云 OSS + CDN 做境内分线路解析。

---

## 四、数据是怎么流动的

```
GitHub 发布新 Release
        │
        ├── .github/workflows/sync-releases.yml（release published 触发）
        │        └─ node update-releases.mjs
        │              └─ 写 public/data/releases.json ── git push ── Cloudflare Pages 重新部署
        │
        └── 没有 CI 时：本地 npm run sync 后手动部署

浏览器
  ├─ 1. localStorage 缓存（30 分钟）
  ├─ 2. 同源 public/data/releases.json   ← 主路径，国内零阻塞
  ├─ 3. api.github.com（快照缺失时兜底）
  └─ 4. HTML 里写死的静态文案（前两者都失败时，页面照常可读）
```

> 之所以不直接让浏览器打 `api.github.com`：国内直连经常 403 / 超时，而且未认证接口限流 60 次/小时/IP。落成本地快照后，官网不依赖任何外部请求。

手动同步一次：

```powershell
npm run sync     # 生成 public/data/releases.json
npm run check    # 只比对有没有新版本，CI 用
```

---

## 五、日常维护对照表

| 想做的事 | 改哪里 |
|---|---|
| 发新版 App | 什么都不用做（Actions 自动同步；无 CI 时跑 `npm run sync`） |
| 改首页文案、加功能卡 | `public/index.html` 的 `<article class="feature">` |
| 改配色 | `public/assets/style.css` 的 `:root`（`--brand`、`--bg`） |
| 加访问统计 | Cloudflare Web Analytics（免费无 Cookie），把 script 粘到 `</body>` 前，同时把 CSP `script-src` 加上它的域名 |
| 加独立更新日志页 | 复制 `#changelog` 区块成 `public/changelog.html`，复用 `assets/app.js` |
| 加扫码下载 | 首页放一个 `<canvas>` 生成当前页二维码 |
| 想统计下载量 | Pages Functions 加 `/api/dl`：302 到 GitHub 直链 + 写 KV/D1 计数，按钮指向它 |

---

## 六、页面内容的事实来源

所有技术描述取自仓库 `README.md` 与 `docs/releases/`，与发布说明一致：

| 项目 | 值 |
|---|---|
| 版本 | 0.2.42（versionCode 242） |
| 构建日期 | 2026-10-11 |
| 安装包 | `Yunsheng-full-v0.2.42-vc242-arm64-v8a.apk` |
| 体积 | 19,813,295 字节 ≈ 19.81 MB |
| SHA-256 | `DE268009…8AA8BBD1`（页面自动从发布说明读取） |
| 包名 | `com.litemusic.app.full.debug` |
| SDK | minSdk 28（Android 9）／ targetSdk 36（Android 16） |
| ABI | 仅 arm64-v8a |
| 功能 | 登录会员、逐字歌词、音质降级链、离线播放、睡眠定时、收藏歌单、评论私信、一起听、签到云贝、本地音乐、应用内更新（11 项） |
| 主题 | 星夜 / 拾穗 / 睡莲 / 松林（四套名画主题，各自启动画面） |

版本、体积、日期、SHA、更新日志这几项由 `app.js` 动态渲染，发版后自动更新；功能描述属于固定文案，功能有增减时手动改 `index.html`。

## 七、截图素材

`public/assets/screens/` 下八张真机截图，文件名与内容固定对应：

| 文件 | 主题 | 页面 |
| --- | --- | --- |
| shot-1 | 松林 | 首页（心动推荐 / 每日推荐 / 歌单广场 / 排行榜） |
| shot-2 | 松林 | 歌单（精选歌单 / 飙升榜 / 新歌榜 / 原创榜） |
| shot-3 | 松林 | 笔记（关注动态 / 话题） |
| shot-4 | 拾穗 | 首页发现页（每日推荐 / 排行榜） |
| shot-5 | 拾穗 | 歌单广场（飙升榜 / 新歌榜 / 原创榜） |
| shot-6 | 睡莲 | 播客（热门电台 / 热门播客） |
| shot-7 | 星夜 | 播放（唱片 / FLAC / 唱针进度） |
| shot-8 | 星夜 | 歌词（逐句双语 / 高潮自动识别） |

每张三种编码：`shot-N.jpg` 720×1600、`shot-N@2x.jpg` 1080×2400、外加同名的 `.webp`（720w / 1080w）。WebP 比 JPEG 小 39–49%，所以页面用 `<picture>` + `<source type="image/webp">` 优先发 WebP，JPEG 只作为兜底。

首屏只加载前两张（`eager`，其余 `lazy`）：JPEG 时代约 335 KB，转 WebP 后约 201 KB。`sizes` 写 `(max-width: 760px) 62vw, 312px`，DPR 1–2 的设备基本只挑 720w 那一档。星夜那两张以暗部为主，压缩比更高（59 → 30 KB、70 → 38 KB）。

整个 `assets/screens/` 目录 4.2 MB（32 个文件），但任何单次访问最多只下载其中几张。

换素材时保持 1260×2800 原图直接覆盖同名文件，再跑一次缩放 + WebP 转换即可；图片走 `/assets/screens/*` 的 7 天缓存规则（不同于 `/assets/*` 默认的一年 immutable，避免替换后长期不生效）。

点任意一张会打开 `<dialog>` 大图，看的是 `@2x` 原图。

图廊会自己缓慢横向滚动：JS 把六张 `figure` 克隆一份接在后面，滚到一半时 `scrollLeft` 减去半幅，所以循环处没有接缝（克隆节点上去掉了 `href` 和 `tabindex`，不会被键盘或点击选中）。速度 0.034 px/ms ≈ 34 px/s，一轮约 62 秒。

**任何手动操作都会立刻停住**：在图廊上按下、横向滚轮、触摸、拖动进度滑块、点开大图，全都走同一条 `halt()`；停下后右下角的按钮变成「继续」，点它才恢复。另外 `IntersectionObserver` 让图廊滚出视口就停掉 `requestAnimationFrame`，切到别的标签页也会停——不占后台 CPU。`prefers-reduced-motion` 下默认不自动滚。

进度滑块是自定义的（不是原生滚动条，原生那条已经隐藏）：58 px 宽的红色滑块，点击轨道直接定位，拖动实时跟随，键盘左右箭头按 60% 视口宽步进，`role="slider"` + `aria-valuenow` 跟着位置更新。

## 八、视觉层与主题

页面是唱片／印刷品风格的编辑式排版，不依赖任何外部字体，图形部分全部由 CSS 与内联 SVG 生成（黑胶纹路、噪点层、Hero 里的抽象云、页脚云的回声），所以 CSP 里的 `default-src 'self'` 不需要任何放宽。

几个不显眼但占份量的细节：

- **首字下沉**：每节导语的第一个字用 `::first-letter` 放大到 2.55em、红色、`float: left`，后面的文字绕排。中文 CJK 首字同样有效（实测首字单独占一个 42×42 的矩形，第二行文字从 x+47 开始，首字浮高用完后文字回到左边）。`prefers-reduced-motion` 不影响它，但移动端把字号收到 2.3em 避免挤压。
- **中段设备锚点**：功能区和更新日志之间插了一节，左边文案、右边一部 CSS 画的手机，屏幕里三张截图每 7 秒交叉淡入（21 秒一轮），用纯 CSS `@keyframes` + `animation-delay` 错开，没有 JS。`prefers-reduced-motion` 下只留第一张不动。
- **页脚云的回声**：把 Hero 的云路径复用到页脚，三层同心轮廓、透明度 0.11（浅色 0.07），只露上半截，和首屏打个照面。

**Hero 的云**是一组等压线式的同心轮廓：同一个云形 path 用 `scale` 叠 6 层，透明度逐层递减，最外圈一条用 `--red` 描边当气压锋面；上层比下层慢（96s / 132s）反向漂移，配 `mask-image` 做上淡下浓，让线稿只在下半幅显形。颜色走 `--cloud-stroke` 变量，深色 `rgba(244,241,234,.42)`、浅色 `rgba(21,19,15,.30)`，`prefers-reduced-motion` 下完全静止。

版式上只有**一条左基准线**：所有标题、正文、日志、FAQ 问答一律落在 `wrap` 内容边缘，桌面 112.3px、平板 40px、手机 22px（随 `--gut`）。章节序号（`.sec-num`）、功能条目序号（`.feat .n`）、FAQ 的 `Q1` 这类标记用 `position: absolute; left: calc(-1 * var(--gut))` **悬挂到左内边距里**，占的是留白、不占排版流，所以不会把标题推离基准线。`#features` 与 `#changelog` 只收窄右侧留白（`padding-right` 加量）而不用 `max-width`，这样左轴始终不会漂移。

> 这里踩过一个坑：早先版本把序号和标题放在同一行（`grid-template-columns: 60px 1fr`），结果是**标题比它下面的正文多缩进 60px**，正是"标题没左对齐、内容却左对齐"的观感来源。改成悬挂标记后才真正同线。另外 `.sec-head/.feat/.log` 都用 `display: block` 而不是 grid —— 让标记脱离流，比压缩列宽更可靠。

**双主题**：深色是默认，另有整套浅色（暖白纸感）。两套只是同一组 CSS 变量的不同取值：

| 变量 | 深色 | 浅色 |
|---|---|---|
| `--ink` | `#07070a` | `#f6f3ec` |
| `--paper` | `#f4f1ea` | `#15130f` |
| `--red` | `#e8452c` | `#c2381f` |
| `--grain-blend` | `overlay` | `multiply` |

变量名读作「底色 / 前景色」，所以浅色主题是把 `--ink` 换成米白、`--paper` 换成墨黑，其余组件不用改一行。要换主色（比如更贴近网易云的 `#ec4141`，或去掉音乐感的青灰 `#5f8f8a`），只改 `--red` / `--red-2` / `--red-hover` 三个值。

**不闪烁**：`assets/theme-init.js` 在 `<head>` 里同步加载（不加 defer/async），首屏渲染前就把 `data-theme` 写到 `<html>` 上。它读取 `localStorage.ys_theme`，没有记录时跟随系统的 `prefers-color-scheme`。

**切换规则**：
- 导航栏右侧按钮手动切换，选择写入 `localStorage.ys_theme`，之后不再跟随系统；
- 页脚「跟随系统主题」清除该记录，回到自动模式；系统主题变化时会实时跟随；
- `<meta name="theme-color">` 同步更新，手机浏览器地址栏跟着变色。

**对比度**（实测，按 token 而不是按元素列，改色时照这张表核）：

| token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--paper` | ≈17.0:1 | ≈16.7:1 | 标题、正文强调 |
| `--paper-2` | ≈9.8:1 | ≈9.8:1 | 正文 |
| `--paper-3` | ≈7.0:1 | ≈5.7:1 | 辅助信息、说明文字 |
| `--paper-4` | ≈4.2:1 | ≈3.4:1 | 仅非必要信息，不上正文 |
| `--paper-5` | ≈2.1:1 | ≈2.0:1 | **只做装饰**，不承载文字 |
| `--red`（当文字/细线） | ≈5.3:1 | ≈5.5:1 | 序号、`Q1`、缩略图编号 |
| `--red-fill`（当填充、压白字） | 4.90:1 | 5.48:1 | 主按钮 |

≥4.5:1 的线由前三档 `--paper*` 与 `--red` 扛住；`--paper-4` 只用于弱化信息，`--paper-5` 不承载文字。

**主按钮红为什么要单独一档**：`--red`（深色 `#e8452c`）当作近黑底上的文字和 1px 细线时约 5.3:1，够用；但当作填充、白字压上去只有 **3.95:1**，hover 的 `#ff5a3c` 更低到 **3.10:1**，都没过 4.5:1。所以填充走独立的 `--red-fill`（深色 `#d0391d` = 4.90:1，浅色 `#c2381f` = 5.48:1）与 `--red-fill-hover`（`#b82f16` = 6.06:1 / `#a92f19` = 6.77:1），**`--red` 本身不动**，细线与序号配色不受影响。要改主色，这两个填充值要一起改并重新核算。

`--paper-5` 是**刻意压到 AA 线以下的一档**，只用来做非同层装饰（细线、悬停底）：深色下 alpha 最低（0.26）、最贴近底色，浅色下同样最贴近纸白。**不要拿它承载任何需要阅读的文字**——想要"更弱的文字"请用 `--paper-4`（深色 4.2:1 / 浅色 3.4:1），且只用于非必要信息。

**字体栈**：`--sans` 同时负责拉丁与中文，两个语种解析到同一物理字体（本机实测 `ABCDE` 宽 99.38 = 微软雅黑，既非 Segoe UI 91.44 也非 Arial 98.72），所以同一行里的字母和汉字不会出现两套字形。`--mono` 只用于不含汉字的等宽场景，并补了 CJK 回退以防万一。两条硬规则：**含汉字的小标签不要用 `--mono`**（等宽栈里的汉字会掉到回退字体，与同行字母明显不同），以及 **`<button>` 默认不继承 `font-family`**（UA 样式表给的是 Arial），所以全局加了 `button, input, select, textarea { font-family: inherit }`。
---

## 本机推送排障：`git push` 卡死

**症状**：`git push origin main` 长时间无任何输出（重定向的日志 0 字节），进程列表里能看到 `git-credential-helper-selector.exe` 一直挂着。

**根因**：DSH 自带的 Git 在**系统级** `etc/gitconfig` 里写了 `credential.helper=helper-selector`，那是个**交互式**辅助选择器，会弹窗等人选。而 `credential.helper` 是**多值键**——在全局再写一条 `credential.helper=manager` 并不会替换掉系统那条，两条都留在列表里，选择器永远先跑。只设 `credential.helperselector.selected=manager` 同样不够。

**修法**（已应用，永久有效）：

```bash
git config --global --add credential.helper ""       # 空值把此前累积的 helper 列表清空
git config --global --add credential.helper manager  # 之后只留 GCM
```

验证（应当直接返回凭据、不弹任何窗口）：

```bash
printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill
```

**应急绕过**（不改配置也能推）：

```bash
GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 git push origin main
```

**网络**：GitHub 只能走本机代理，且已写进全局配置——`http.https://github.com/.proxy = http://127.0.0.1:7890`，所以正常推送不必再带 `-c http.proxy=...`。

**推送操作两条纪律**：

- 别把 `git push` 接进 `| tail` 之类的管道。输出被吃掉就看不出到底卡在认证还是卡在上传。重定向到文件，再单独 `echo $?`。
- 出现 `[exit code: 1]` 且没有信号标记时，在 Windows 上通常表示进程被外部终止，而不是命令本身失败——先看进程列表里有没有挂着的 helper。
