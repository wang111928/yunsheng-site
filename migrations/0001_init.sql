-- 云声站点 D1 初始化
-- 用法：wrangler d1 execute yunsheng-db --remote --file=migrations/0001_init.sql
-- 或在控制台 D1 → Console 里逐段执行

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_releases_pub ON releases(published_at DESC);
--> statement-breakpoint

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
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_rel_name ON assets(release_id, name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
--> statement-breakpoint

-- 计数器：dl:latest / dl:v0.2.42 / dl:<文件名> / hit:/api/releases
-- 放 D1 不放 KV：KV 免费版每天只有 1000 次写，计数器一次自增就是一次写
CREATE TABLE IF NOT EXISTS counters (
  key        TEXT PRIMARY KEY,
  n          INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
