#!/usr/bin/env node
/* 本地预览服务器：node server.mjs [端口]
   模拟 Cloudflare Pages 的行為：静态文件 + 目录 index + 404.html 兜底 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.argv[2] || process.env.PORT || 8088);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isDirectory()) return tryFile(join(p, 'index.html'));
    return await readFile(p);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const target = join(ROOT, safe);

  let body = await tryFile(target);
  let status = 200;

  if (!body) {
    body = await tryFile(join(ROOT, '404.html'));
    status = 404;
    if (!body) body = Buffer.from('404 Not Found');
  }

  const ext = extname(urlPath) || (status === 404 ? '.html' : '.html');
  res.writeHead(status, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`云声官网预览： http://127.0.0.1:${PORT}`);
  console.log(`部署目录： ${ROOT}`);
});