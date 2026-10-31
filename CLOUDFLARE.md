# 云声站点：Cloudflare 数据层 + 拆页方案

本方案涉及**两个仓库**，先分清，后面所有步骤才不会放错位置：

| 仓库 | 角色 | 本文要动它什么 |
| --- | --- | --- |
| `wang111928/yunsheng-site`（本地 `D:\py\yunsheng-site`） | **站点仓库**：Pages 的 Git 源，部署根 `public/`，构建命令留空，自动 SSL | 新增 `functions/`、`migrations/`，以及拆页的三个 HTML |
| `wang111928/yunsheng-player` | **应用仓库**：云声 APK 发版发生在这里 | 挂一个 GitHub Webhook 指向本站 |

线上 `https://0721ciallo.xyz` · Pages 项目名 `yunsheng-2bj`
托管：Cloudflare Pages（Git 连接，部署根 `public/`，构建命令留空，自动 SSL）

本文分两部分：

1. **数据层方案** —— 用 Pages Functions + D1 + KV + R2 替掉现在「GitHub Actions 定时生成 `data/releases.json` + 前端三层兜底」的链路
2. **拆页方案** —— 回答「这个只能一页一直走？」，给出可执行的拆法

---

## 0. 现状与痛点

现在前端取版本信息的顺序是：

```
localStorage(ys_rel_v2, 30min) → data/releases.json → api.github.com → HTML 里的硬编码兜底
```

`data/releases.json` 由 `.github/workflows/sync-releases.yml` 在 `release: [published, edited, deleted]`、定时 `17 */6 * * *`、以及手动 `workflow_dispatch` 时重新生成并提交。

四个已经暴露的问题：

| 问题 | 现象 |
| --- | --- |
| 页内直连 `api.github.com` 403 | 匿名限额按 IP 算，浏览器里经常直接 403，`curl` 却是 200 |
| 定时任务有窗口 | 最多 6 小时延迟；GitHub Actions 自己也偶发排队失败 |
| 存量文件要提交 | 每次发版都要产生一个 `chore: sync` commit，污染历史 |
| 没有写能力 | 下载次数、留言、公告开关之类的东西完全做不了 |
| **`release` 触发器其实是死的** | 工作流放在 `yunsheng-site`，而 `on: release` 只监听**本仓库**的发版事件；云声是在 `yunsheng-player` 发版 —— 所以现在唯一真正在刷新快照的是 `17 */6 * * *` 那个 cron，发版后最多 6 小时页面上还是旧版本号 |

最后一条是核实过的：`update-releases.mjs` 里写死 `OWNER='wang111928'` / `REPO='yunsheng-player'`，但 `.github/workflows/sync-releases.yml` 自己躺在 `yunsheng-site` 里，它的 `release:` 事件永远等不到。**数据层顺手把这个问题一起解决**——Webhook 挂在真正发版的 `yunsheng-player` 上，是即时的。

数据层直接解决前三条，并打开第四条。

---

## 1. 选型

| 产品 | 用在本站的什么位置 | 是否采用 |
| --- | --- | --- |
| **Pages Functions** | API 层。跟静态站点同一个仓库、同一次部署，不用单独管一个 Worker | ✅ 核心 |
| **D1**（SQLite） | 版本表、附件表、计数器、留言。关系型，SQL 直接写 | ✅ 核心 |
| **KV** | 只读缓存（`/api/releases` 的结果）+ 站点配置（公告文案、功能开关） | ✅ 辅助 |
| **R2** | APK 镜像 + 截图原图。**出站流量免费**，这是对国内用户价值最大的一项 | ✅ 可选但推荐 |
| Durable Objects | 强一致并发计数 | ❌ 不需要，D1 单语句 upsert 就是原子的 |
| Analytics Engine | 高频埋点（每次请求一行） | ❌ 现在这点量用不上 |
| Queues / Workers AI / Vectorize | — | ❌ 不需要 |

**结论：Pages Functions + D1 + KV + R2。**

### 免费额度（按官网当前额度，够不够用一目了然）

| 项 | 免费额度 | 本站量级 |
| --- | --- | --- |
| Pages Functions | 100,000 请求 / 天 | 每天几百 → 用不到 1% |
| D1 | 5 GB 存储；500 万行读 / 天；10 万行写 / 天 | 版本表几十行，写完就命中 KV → 用不到 1% |
| KV | 100,000 读 / 天；**1,000 写 / 天** | ⚠️ 写配额极低 → **计数绝对不能走 KV**（见 §3 计数器） |
| R2 | 10 GB 存储；Class A 100 万次 / 月；Class B 1,000 万次 / 月；**出站 0 费用** | 一个 APK 19.81 MB，一个月的版本全存下也远不到 10 GB |

**总成本：0 元。** 不需要绑卡，免费套餐即可跑完全部功能。

---

## 2. 目录结构

关键点：**`functions/` 必须在构建根目录（仓库根）下，不能放进 `public/`**，否则会被当成静态资源原样上传，不会变成接口。

```
yunsheng-site/                     ← 构建根（Pages 克隆后在这里执行构建）
├─ public/                         ← 部署根：静态资源
│  ├─ index.html
│  ├─ changelog.html               ← §7 拆页后新增
│  ├─ help.html                    ← §7 拆页后新增
│  ├─ 404.html                     ← §7 必须新增（原因见下）
│  ├─ _headers
│  ├─ data/releases.json           ← 保留，作为 API 挂掉时的静态兜底
│  └─ assets/
├─ functions/                      ← 新增：Pages Functions
│  ├─ _middleware.js
│  ├─ api/
│  │  ├─ releases.js
│  │  ├─ latest.js
│  │  ├─ hit.js
│  │  └─ stats.js
│  ├─ dl/
│  │  └─ [[path]].js
│  └─ webhook/
│     └─ sync.js
├─ migrations/
│  └─ 0001_init.sql
├─ seed.sql                        ← 首次灌数据
└─ wrangler.toml                   ← 可选，见 §6 的注意事项
```

路由规则（Pages 文件名即路由）：

| 文件 | 路由 |
| --- | --- |
| `functions/api/releases.js` | `GET /api/releases` |
| `functions/dl/[[path]].js` | `GET /dl/*`（`[[path]]` 是 catch-all，能吃到 `/dl/latest`、`/dl/v0.2.42`、`/dl/<文件名>`） |
| `functions/webhook/sync.js` | `POST /webhook/sync` |

---

## 3. D1 表结构

`migrations/0001_init.sql`。普通 `;` 分隔；如果 Wrangler 报 multiple statements，就改用 `--> statement-breakpoint` 分隔（D1 认这个标记）。

```sql
-- 版本
CREATE TABLE IF NOT EXISTS releases (
  id           INTEGER PRIMARY KEY,          -- GitHub release id
  tag          TEXT    NOT NULL UNIQUE,      -- v0.2.42
  name         TEXT    NOT NULL,             -- "云声 0.2.42 · QQ 授权回跳修复"
  version      TEXT    NOT NULL,             -- 0.2.42
  published_at TEXT    NOT NULL,             -- ISO8601
  prerelease   INTEGER NOT NULL DEFAULT 0,
  body         TEXT    NOT NULL DEFAULT '',
  html_url     TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_releases_pub ON releases(published_at DESC);

-- 附件（APK）
CREATE TABLE IF NOT EXISTS assets (
  id           INTEGER PRIMARY KEY,          -- GitHub asset id
  release_id   INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,             -- Yunsheng-full-v0.2.42-vc242-arm64-v8a.apk
  size         INTEGER NOT NULL,             -- 19813295
  sha256       TEXT,
  abi          TEXT,                         -- arm64-v8a
  download_url TEXT    NOT NULL,             -- GitHub 原始地址（兜底）
  r2_key       TEXT,                         -- 镜像到 R2 后的对象键，为空表示没镜像
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_rel_name ON assets(release_id, name);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);

-- 计数器：键形如 dl:latest / dl:v0.2.42 / dl:<文件名> / hit:/api/releases
CREATE TABLE IF NOT EXISTS counters (
  key        TEXT PRIMARY KEY,
  n          INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 留言板（可选，先只做只读 + 手动放行）
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nick       TEXT NOT NULL,
  body       TEXT NOT NULL,
  ua         TEXT,
  country    TEXT,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
```

### 为什么计数器放 D1 而不是 KV

KV 免费版**每天只有 1,000 次写**，计数器一次自增就是一次写，几个爬虫就能打爆；而且 KV 是最终一致的，读回来可能是旧值。D1 免费版每天 10 万行写，单条 upsert 语句在 D1 里是原子的：

```sql
INSERT INTO counters (key, n) VALUES (?1, 1)
ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = datetime('now');
```

**这一条语句就是原子自增，不需要事务、不需要 Durable Objects。**

---

## 4. Functions 代码

### `functions/_middleware.js` —— 统一响应头与错误兜底

```js
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  let res;
  try {
    res = await next();
  } catch (err) {
    return Response.json(
      { error: 'internal', message: String(err && err.message || err) },
      { status: 500 }
    );
  }

  const h = new Headers(res.headers);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');

  // /api/* 的缓存由各接口自己声明；这里只保证不被中间层乱缓存
  if (url.pathname.startsWith('/api/') && !h.has('cache-control')) {
    h.set('cache-control', 'no-store');
  }

  return new Response(res.body, { status: res.status, headers: h });
}
```

### `functions/api/releases.js` —— 版本列表（KV 缓存 5 分钟）

```js
const KV_KEY = 'releases:index';
const TTL = 300;

const json = (obj, maxAge) =>
  new Response(JSON.stringify(obj), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}`
    }
  });

export async function onRequestGet({ env }) {
  const cached = await env.YS_KV.get(KV_KEY, 'json');
  if (cached) return json({ ...cached, cached: true }, TTL);

  const { results: rel } = await env.YS_DB.prepare(
    `SELECT id, tag, name, version, published_at, prerelease, body, html_url
       FROM releases
      ORDER BY published_at DESC
      LIMIT 20`
  ).all();

  const { results: ast } = await env.YS_DB.prepare(
    `SELECT release_id, name, size, sha256, abi, download_url, r2_key
       FROM assets
      ORDER BY id`
  ).all();

  const byRel = new Map();
  for (const a of ast) {
    const list = byRel.get(a.release_id) || [];
    list.push(a);
    byRel.set(a.release_id, list);
  }

  const releases = rel.map((r) => ({ ...r, assets: byRel.get(r.id) || [] }));
  const latest = releases.find((r) => !r.prerelease) || releases[0] || null;

  const out = {
    source: 'd1',
    cached: false,
    builtAt: new Date().toISOString(),
    latest: latest
      ? {
          tag: latest.tag,
          version: latest.version,
          published_at: latest.published_at,
          asset: latest.assets[0] || null,
          download: '/dl/latest'
        }
      : null,
    releases
  };

  await env.YS_KV.put(KV_KEY, JSON.stringify(out), { expirationTtl: TTL });
  return json(out, TTL);
}
```

### `functions/api/latest.js` —— 只取最新版（给 `#pill-ver` 这类轻量点用）

```js
export async function onRequestGet({ env }) {
  const r = await env.YS_DB.prepare(
    `SELECT r.tag, r.version, r.published_at,
            a.name AS asset_name, a.size, a.sha256, a.abi
       FROM releases r
       LEFT JOIN assets a ON a.release_id = r.id
      WHERE r.prerelease = 0
      ORDER BY r.published_at DESC
      LIMIT 1`
  ).first();

  if (!r) return Response.json({ error: 'empty' }, { status: 404 });

  return new Response(JSON.stringify(r), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300'
    }
  });
}
```

### `functions/api/hit.js` —— 下载 / 访问计数

```js
const KEY_RE = /^[a-z0-9:_\-./]{1,80}$/;

export async function onRequestPost({ request, env }) {
  let key;
  try {
    ({ key } = await request.json());
  } catch {
    return new Response('bad json', { status: 400 });
  }
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return new Response('bad key', { status: 400 });
  }

  await env.YS_DB.prepare(
    `INSERT INTO counters (key, n) VALUES (?1, 1)
       ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = datetime('now')`
  ).bind(key).run();

  return Response.json({ ok: true });
}
```

### `functions/api/stats.js` —— 读计数

```js
export async function onRequestGet({ env }) {
  const { results } = await env.YS_DB.prepare(
    `SELECT key, n FROM counters ORDER BY n DESC LIMIT 50`
  ).all();

  const map = Object.fromEntries(results.map((r) => [r.key, r.n]));
  return new Response(
    JSON.stringify({
      total: map['dl:latest'] || 0,
      all: map
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60'
      }
    }
  );
}
```

### `functions/dl/[[path]].js` —— 下载分发器（计数 + R2 镜像 + GitHub 兜底）

```js
export async function onRequestGet({ params, env, request }) {
  const raw = Array.isArray(params.path) ? params.path.join('/') : (params.path || 'latest');
  const want = decodeURIComponent(raw);

  const asset =
    want === 'latest' || /^v\d/i.test(want)
      ? await env.YS_DB.prepare(
          `SELECT a.* FROM assets a
             JOIN releases r ON r.id = a.release_id
            WHERE (?1 = 'latest' OR r.tag = ?1)
            ORDER BY r.published_at DESC, a.id
            LIMIT 1`
        ).bind(want).first()
      : await env.YS_DB.prepare(
          `SELECT * FROM assets WHERE name = ?1 LIMIT 1`
        ).bind(want).first();

  if (!asset) return new Response('not found', { status: 404 });

  // 计数失败不阻断下载
  try {
    await env.YS_DB.prepare(
      `INSERT INTO counters (key, n) VALUES (?1, 1)
         ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = datetime('now')`
    ).bind('dl:' + (want === 'latest' ? 'latest' : asset.name)).run();
  } catch {}

  // 有 R2 镜像就走 R2（出站免费、国内可达），否则 302 回 GitHub
  if (asset.r2_key) {
    const obj = await env.YS_R2.get(asset.r2_key);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          'content-type': 'application/vnd.android.package-archive',
          'content-disposition': `attachment; filename="${asset.name}"`,
          'content-length': String(asset.size),
          'etag': obj.httpEtag,
          'cache-control': 'public, max-age=31536000, immutable'
        }
      });
    }
  }

  return Response.redirect(asset.download_url, 302);
}
```

> R2 的 `content-length` 用表里的 `size`，避免依赖 R2 对象元数据；`obj.body` 是流，Functions 可以直通返回，19.81 MB 没有出站大小限制。

### `functions/webhook/sync.js` —— GitHub 发版即落库（含签名校验）

```js
async function verify(sigHeader, body, secret) {
  if (!secret || !sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expect =
    'sha256=' +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expect.length !== sigHeader.length) return false;
  // 定长比较，避免时序侧信道
  let diff = 0;
  for (let i = 0; i < expect.length; i++) {
    diff |= expect.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  }
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const ok = await verify(request.headers.get('x-hub-signature-256'), raw, env.GH_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 401 });

  const event = request.headers.get('x-github-event');
  if (event !== 'release') return Response.json({ ok: true, skipped: event });

  const payload = JSON.parse(raw);
  const action = payload.action; // published | edited | deleted
  const rel = payload.release;
  if (!rel) return new Response('no release', { status: 400 });

  if (action === 'deleted') {
    await env.YS_DB.prepare(`DELETE FROM releases WHERE id = ?1`).bind(rel.id).run();
  } else {
    const version = String(rel.tag_name || '').replace(/^v/i, '');
    await env.YS_DB.prepare(
      `INSERT INTO releases (id, tag, name, version, published_at, prerelease, body, html_url, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         tag = excluded.tag,
         name = excluded.name,
         version = excluded.version,
         published_at = excluded.published_at,
         prerelease = excluded.prerelease,
         body = excluded.body,
         html_url = excluded.html_url,
         updated_at = datetime('now')`
    ).bind(
      rel.id,
      rel.tag_name,
      rel.name || rel.tag_name,
      version,
      rel.published_at,
      rel.prerelease ? 1 : 0,
      rel.body || '',
      rel.html_url
    ).run();

    // 附件：先清后插，保持与 GitHub 一致
    await env.YS_DB.prepare(`DELETE FROM assets WHERE release_id = ?1`).bind(rel.id).run();
    for (const a of rel.assets || []) {
      const abi = /arm64-v8a/i.test(a.name)
        ? 'arm64-v8a'
        : /armeabi-v7a/i.test(a.name)
        ? 'armeabi-v7a'
        : null;
      await env.YS_DB.prepare(
        `INSERT INTO assets (id, release_id, name, size, sha256, abi, download_url, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, size = excluded.size, sha256 = excluded.sha256,
           abi = excluded.abi, download_url = excluded.download_url, updated_at = datetime('now')`
      ).bind(a.id, rel.id, a.name, a.size, a.digest || null, abi, a.browser_download_url).run();
    }
  }

  await env.YS_KV.delete('releases:index');
  return Response.json({ ok: true, action, tag: rel.tag_name });
}
```

> 注意 `a.digest` 是 GitHub 新字段，形如 `sha256:de26…`；入库前按需剥掉前缀。

---

## 5. 前端接法（改动极小）

`assets/app.js` 里现在的取数顺序，把 `/api/releases` 插到 `data/releases.json` 之前即可：

```
localStorage(ys_rel_v2, 30min)
  → /api/releases          ← 新增，同源，不会 403
  → data/releases.json     ← 保留，API 挂了或没部署 Functions 时的静态兜底
  → api.github.com
  → HTML 硬编码
```

这样做的两个好处：

- **任何一层失败都不会白屏**，`data/releases.json` 继续留在仓库里当保险丝
- 想回滚数据层，只要删掉 `functions/` 目录重新部署，前端自动落回第二层，**零改动回滚**

下载按钮从 GitHub 直链换成站内分发器：

```html
<!-- 现在 -->
<a id="dl-main" href="https://github.com/wang111928/yunsheng-player/releases/download/v0.2.42/Yunsheng-full-v0.2.42-vc242-arm64-v8a.apk">

<!-- 换成 -->
<a id="dl-main" href="/dl/latest" rel="noopener">
```

`/dl/latest` 会 302/流式返回同一份文件，同时记一次数；不想要计数就直接把 `href` 写回 GitHub 直链。

⚠️ `_headers` 里的 CSP 是 `connect-src 'self' https://api.github.com`，`/api/releases` 是同源，**不用改 CSP**。

---

## 6. 绑定怎么加（这一步最容易踩坑）

Pages 项目是 **Git 连接**的，绑定有两种加法：

**方式 A：控制台加（推荐）**

Workers & Pages → 选中项目 → Settings → Bindings → Add：

| 类型 | Variable name | 目标 |
| --- | --- | --- |
| D1 database | `YS_DB` | `yunsheng` |
| KV namespace | `YS_KV` | `yunsheng-site` |
| R2 bucket | `YS_R2` | `yunsheng-releases` |
| Secret（Text，加密） | `GH_WEBHOOK_SECRET` | 自己生成的一串随机值 |

**加完必须重新部署一次（Redeploy）绑定才生效** —— 这是官方文档明确写的，也是 90% 的「绑定加了但 `env.YS_DB` 是 undefined」的原因。

**方式 B：仓库根放 `wrangler.toml`**

```toml
name = "yunsheng-2bj"              # ⚠️ 必须与 Pages 项目名完全一致
compatibility_date = "2026-11-01"
pages_build_output_dir = "public"  # ⚠️ 必须等于现在的部署根

[[d1_databases]]
binding = "YS_DB"
database_name = "yunsheng"
database_id = "<D1_DATABASE_ID>"

[[kv_namespaces]]
binding = "YS_KV"
id = "<KV_NAMESPACE_ID>"

[[r2_buckets]]
binding = "YS_R2"
bucket_name = "yunsheng-releases"
```

⚠️ **风险**：加了 `wrangler.toml` 之后 Pages 会优先读它。`name` 或 `pages_build_output_dir` 写错会直接把 Git 构建弄挂（表现为部署失败或站点变空）。项目名去 `https://<id>.yunsheng-2bj.pages.dev` 里核对。**第一次加之前先确认这两个值，或者干脆用方式 A。**

---

## 7. 「这个只能一页一直走？」

**不是。** Pages 是静态托管，想要多少路由就有多少路由，零配置。

而且官方文档明确了两条关键行为（`/pages/configuration/serving-pages/`）：

1. **自动去扩展名**：`/contact.html` 会被 301 到 `/contact`，`/about/index.html` 会 301 到 `/about/`
   → 所以 `public/changelog.html` 直接就是 `https://0721ciallo.xyz/changelog`，不用写任何重写规则
2. **没有顶层 `404.html` 时，Pages 会当成 SPA**，把所有未匹配的路径都返回首页
   → 拆页时必须补一个 `public/404.html`，否则打错的链接会静默变成首页

### 两条路线

| | A. 多 HTML（MPA） | B. 单页 + History API |
| --- | --- | --- |
| 做法 | 每页一个 HTML，共享 `assets/style.css` 和 `assets/app.js` | 一个 HTML，`history.pushState` 切视图 |
| 配置 | **零配置** | 要加 `_redirects` 的 `/* /index.html 200` SPA 兜底 |
| 首屏 | 小（首页少 3000px） | 大（还是得下载整页 DOM） |
| 深链 / SEO | 天然正确，每页独立 `<title>`/canonical/og | 要自己在客户端补 title 和 meta |
| 404 | 正常 404 | SPA 兜底会把 404 也吞成首页 |
| 代价 | 切页要重新请求 HTML | 无刷新 |

**建议走 A**，并且只拆三页 —— 保留首页的叙事完整性：

| 路由 | 文件 | 内容 | 理由 |
| --- | --- | --- | --- |
| `/` | `public/index.html` | hero + 截图 + 功能 + 机型 + 下载 | 这是"读一遍"的叙事，留着 |
| `/changelog` | `public/changelog.html` | 更新日志 | 最长的一块（现在 5 条就 2769px），而且外部最常直接链接到这里 |
| `/help` | `public/help.html` | 安装步骤 + FAQ | "查"而不是"读"的内容，用户出问题才来看 |

拆完首页高度大约从 10281px 掉到 6000px 左右，滚动条不再"一直走"。

### 具体改法

1. 新增 `public/changelog.html`、`public/help.html`、`public/404.html`
2. 每页 `<head>` 独立：`<title>`、`<meta name="description">`、`<link rel="canonical">`、`og:*`
3. 导航栏 5 个锚点改成真实链接：
   ```html
   <!-- 首页 -->
   <a href="/#screens">截图</a>
   <a href="/#features">功能</a>
   <a href="/changelog">更新日志</a>
   <a href="/help">安装与问答</a>
   <!-- 子页 -->
   <a href="/">首页</a> <a href="/#screens">截图</a> <a href="/#features">功能</a>
   <a href="/changelog">更新日志</a> <a href="/help">安装与问答</a>
   ```
4. `assets/app.js` 里 `#shots`、`#lightbox`、`#releases`、`#progress` 这些初始化的目标元素在子页不存在，需要**逐个判空**（现在的代码是 `document.querySelector(...)` 直接取，一旦为 `null` 后续属性访问会抛错）。这是拆页唯一的真实代码风险，改法：

   ```js
   const el = document.getElementById('shots');
   if (el) shotsAuto(el);
   ```
5. 子页上把 `?v=` 与 `assets/*` 的引用保持和首页一致 —— 因为 `/assets/*` 是 `max-age=31536000, immutable`，三页共享同一份 CSS/JS，切页时命中缓存，不会有额外开销
6. **不要**动 `_headers`；CSP `default-src 'self'` 对三个页面同样有效

### `public/404.html` 要写什么

因为页面是纯静态、无后端渲染，`404.html` 只需要给"回首页 / 去更新日志 / 去安装说明"三条出路，并且主题跟随逻辑复用 `theme-init.js`：

```html
<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>404 · 云声</title>
  <link rel="stylesheet" href="/assets/style.css?v=20261102">
  <script src="/assets/theme-init.js?v=20261102"></script>
</head>
<body>
  <main class="wrap" style="padding:120px 0">
    <p class="mono">404</p>
    <h1>这里没有声音。</h1>
    <p class="hero-note">你要找的页面不存在，或者链接已经过期。</p>
    <p><a href="/">回首页</a> · <a href="/changelog">更新日志</a> · <a href="/help">安装与问答</a></p>
  </main>
</body>
</html>
```

---

## 8. 落地顺序

```bash
# 0. 前置：Node 20+，npx 可用
cd D:/py/yunsheng-site

# 1. 建资源
npx wrangler d1 create yunsheng
npx wrangler kv namespace create YS_KV
npx wrangler r2 bucket create yunsheng-releases

# 2. 建表
mkdir -p functions/api functions/dl functions/webhook migrations
#   → 落 §2 的文件、§3 的 0001_init.sql
npx wrangler d1 migrations apply yunsheng --remote

# 3. 加绑定（控制台 Settings → Bindings），然后 Redeploy

# 4. 首次灌数据
node -e "…读 public/data/releases.json 生成 seed.sql…"
npx wrangler d1 execute yunsheng --remote --file seed.sql

# 5. 本地联调（不需要联网部署）
npx wrangler pages dev public --d1=YS_DB=<D1_DATABASE_ID> --kv=YS_KV
#   → http://127.0.0.1:8788（本站现有的 server.mjs 是 8089，两者不冲突）

# 6. 提交 functions/ 与 migrations/，Git 推送即自动部署

# 7. 配 GitHub Webhook
#    必须挂在「应用仓库」yunsheng-player 上 —— 挂在 yunsheng-site 上不会触发，
#    这正是现在 release 触发器失效的原因
#    https://github.com/wang111928/yunsheng-player/settings/hooks
#    Payload URL: https://0721ciallo.xyz/webhook/sync
#    Content type: application/json
#    Secret: 与 GH_WEBHOOK_SECRET 相同
#    Events: 只勾 Release
```

### 验收

```bash
curl -s https://0721ciallo.xyz/api/releases | jq '.latest.tag, .source'
# → "v0.2.42"  "d1"

curl -sI https://0721ciallo.xyz/dl/latest | head -3
# → HTTP/2 302  (或 200 + content-type: application/vnd.android.package-archive，如果镜像已就绪)

curl -s https://0721ciallo.xyz/api/stats
# → {"total":N,"all":{...}}

curl -s -X POST https://0721ciallo.xyz/api/hit \
     -H 'content-type: application/json' -d '{"key":"hit:test"}'
# → {"ok":true}
```

### 回滚

| 想回滚 | 做法 |
| --- | --- |
| 数据层 | 删掉 `functions/` 目录，重新部署。前端自动落回 `data/releases.json` 那一层，页面照常 |
| 下载直链 | `<a href="/dl/latest">` 改回 GitHub Releases 直链 |
| 拆页 | 三个新 HTML 删掉，导航锚点改回 `#id`；`404.html` 可留着（无害） |
| 表结构 | `wrangler d1 migrations` 不做自动回滚；改表一律新增 `0002_*.sql`，不要改 `0001` |

### 可以顺手退役的东西

数据层跑顺之后，`.github/workflows/sync-releases.yml` 的 cron 与 `release` 触发都可以删掉 —— Webhook 是即时的，比定时可靠。**但先保留一个版本周期观察**，确认 Webhook 没漏事件再删。

---

## 9. 一页速查

| 问题 | 答案 |
| --- | --- |
| 要花钱吗 | 不要，免费额度用不到 1% |
| 需要单独部署 Worker 吗 | 不需要，Pages Functions 跟静态站点同仓库同一次部署 |
| 会白屏吗 | 不会，`data/releases.json` 静态兜底留着，API 挂了自动降级 |
| 要改 CSP 吗 | 不用，`/api/*` 和 `/dl/*` 都是同源 |
| DNS 要动吗 | 不用，Functions 挂在同一个域名下 |
| 计数能用 KV 吗 | 不能，KV 免费版 1,000 写/天；用 D1 的 upsert |
| 拆页要写重写规则吗 | 不用，Pages 自动把 `/x.html` 301 到 `/x` |
| 拆页最容易翻车的地方 | `app.js` 对子页不存在的元素没判空；以及忘写 `404.html`（会被当 SPA 吞掉 404） |