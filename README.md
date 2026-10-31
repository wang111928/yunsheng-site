# 云声 Yunsheng 官网

`wang111928/yunsheng-player` 的官网 —— 单页静态站，唱片／印刷品风格的编辑式排版。

## 技术形态

纯 HTML + CSS + 原生 JS，**没有构建步骤**。部署时只需要 `public/` 目录。

- Cloudflare Pages，Git 集成，生产分支 `main`
- 构建命令：留空
- 输出目录：`public`

推送到 `main` 会自动部署，约 40 秒生效。

## 目录

```
public/
  index.html          单页，全部内容
  _headers            CSP 与缓存策略（Cloudflare 专用）
  404.html            自定义错误页
  robots.txt / sitemap.xml
  assets/
    style.css         全部样式，明暗双主题用语义 token 反色
    app.js            发布数据渲染、进场动画、图廊自动滚动、大图
    theme-init.js     首屏前应用主题，避免闪烁
    favicon.svg
    screens/          八张真机截图 × (720w / 1080w) × (JPEG / WebP)
  data/releases.json  版本快照，首屏直接读它
server.mjs            本地预览（静态服务）
update-releases.mjs   从 GitHub Releases 生成版本快照
setup.ps1             把占位域名替换成真实域名
```

## 本地预览

```bash
npm run dev        # http://127.0.0.1:8089
npm run sync       # 手动刷新版本快照
npm run check      # 只检查版本是否有变化
npm run deploy     # wrangler 直传（Git 集成之外的备选路径）
```

## 版本数据

三级兜底：`localStorage` 缓存（30 分钟）→ 本站 `data/releases.json` → GitHub API。

`.github/workflows/sync-releases.yml` 会在新 Release 发布时、以及每 6 小时兜底刷新一次快照并提交。

## 说明

站点代码仅用于云声项目展示。云声是第三方网易云音乐客户端，不含任何音乐内容，与网易公司无关。