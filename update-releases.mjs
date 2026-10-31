#!/usr/bin/env node
/* ============================================================
   云声官网 — 发布数据快照生成器
   把 GitHub Releases 抓下来，落成同源静态文件 data/releases.json
   好处：浏览器不再直连 api.github.com（国内常 403/超时），页面 100% 可用

   用法：
     node update-releases.mjs                 # 生成快照
     node update-releases.mjs --check         # 只比对，不写文件（CI 用）
   环境变量：
     GITHUB_TOKEN  可选，提高 API 限额（CI 里用 secrets.GITHUB_TOKEN）
   ============================================================ */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.YS_OWNER || 'wang111928';
const REPO = process.env.YS_REPO || 'yunsheng-player';
const LIMIT = 8;

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'public', 'data', 'releases.json');
const CHECK_ONLY = process.argv.includes('--check');

const api = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=${LIMIT}`;

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'yunsheng-site-release-sync',
  'X-GitHub-Api-Version': '2022-11-28',
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

function slim(rel) {
  const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name)) || null;
  return {
    tag: rel.tag_name || '',
    name: rel.name || '',
    published_at: rel.published_at || '',
    html_url: rel.html_url || '',
    prerelease: !!rel.prerelease,
    draft: !!rel.draft,
    body: (rel.body || '').slice(0, 8000),
    apk: apk
      ? { name: apk.name, url: apk.browser_download_url, size: apk.size || 0 }
      : null,
    // 顺手从说明正文里抽 SHA-256，前端不用再解析
    sha256: ((rel.body || '').match(/SHA-?256[：:]\s*`?([A-Fa-f0-9]{64})`?/) || [])[1] || null,
  };
}

async function main() {
  const res = await fetch(api, { headers });
  if (!res.ok) {
    console.error(`GitHub API 返回 ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error('没有拿到任何 release');
    process.exitCode = 1;
    return;
  }

  const stable = raw.filter((r) => !r.draft);
  const data = {
    generated_at: new Date().toISOString(),
    source: `https://github.com/${OWNER}/${REPO}/releases`,
    latest: stable.length ? slim(stable.find((r) => !r.prerelease) || stable[0]) : null,
    releases: stable.map(slim),
  };

  if (CHECK_ONLY) {
    let old = null;
    try {
      old = JSON.parse(await readFile(OUT, 'utf8'));
    } catch { /* 不存在即视为有变化 */ }
    const same = old && old.latest && data.latest && old.latest.tag === data.latest.tag;
    console.log(same ? `无变化（${data.latest.tag}）` : `有新版本：${data.latest?.tag}`);
    process.exitCode = same ? 0 : 2;
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const l = data.latest;
  console.log(`已写入 ${OUT}`);
  console.log(`最新版本 ${l.tag} · ${l.apk ? l.apk.name + ' · ' + (l.apk.size / 1048576).toFixed(2) + ' MB' : '无 APK 资产'}`);
  console.log(`共 ${data.releases.length} 条发布记录`);
}

main().catch((e) => {
  console.error('生成失败：', e.message);
  process.exitCode = 1;
});