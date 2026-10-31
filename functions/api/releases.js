// GET /api/releases?limit=12
// 读 D1 的 releases + assets；尽力用 KV 缓存 300s。
// 设计原则：任何一层失败都不能让接口 500 —— 一路降级，最后返回空数组，
// 让前端回落到 localStorage 快照或 data/releases.json。

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, stale-while-revalidate=300',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  let limit = parseInt(url.searchParams.get('limit') || '12', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 12;
  if (limit > 50) limit = 50;

  const cacheKey = 'releases:index:' + limit;

  // 1) KV 缓存
  if (env.YS_KV) {
    try {
      const hit = await env.YS_KV.get(cacheKey, 'json');
      if (hit && Array.isArray(hit.releases)) {
        return json(hit, 200, { 'x-ys-source': 'kv' });
      }
    } catch (_) { /* KV 不可用就继续往下走 */ }
  }

  // 2) D1
  if (!env.YS_DB) {
    return json({ releases: [], error: 'no-db-binding' }, 200, { 'x-ys-source': 'none' });
  }

  try {
    const { results } = await env.YS_DB
      .prepare(
        `SELECT id, tag, name, version, published_at, prerelease, body, html_url
           FROM releases
       ORDER BY published_at DESC
          LIMIT ?1`
      )
      .bind(limit)
      .all();

    const rows = results || [];
    if (!rows.length) {
      return json({ releases: [] }, 200, { 'x-ys-source': 'd1-empty' });
    }

    // 一次取回这批 release 的全部附件
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map((_, i) => '?i'.replace('i', String(i + 1))).join(',');
    const assetsRes = await env.YS_DB
      .prepare(
        `SELECT release_id, name, size, sha256, abi, download_url, r2_key
           FROM assets
          WHERE release_id IN (${placeholders})`
      )
      .bind(...ids)
      .all();

    const byRelease = new Map();
    for (const a of assetsRes.results || []) {
      if (!byRelease.has(a.release_id)) byRelease.set(a.release_id, []);
      byRelease.get(a.release_id).push({
        name: a.name,
        size: a.size,
        sha256: a.sha256,
        abi: a.abi,
        download_url: a.download_url,
        mirror: a.r2_key ? '/dl/' + encodeURIComponent(a.name) : null,
      });
    }

    const payload = {
      generated_at: new Date().toISOString(),
      releases: rows.map((r) => ({
        id: r.id,
        tag: r.tag,
        name: r.name,
        version: r.version,
        published_at: r.published_at,
        prerelease: !!r.prerelease,
        body: r.body,
        html_url: r.html_url,
        assets: byRelease.get(r.id) || [],
      })),
    };

    // 3) 回填 KV，失败无所谓
    if (env.YS_KV) {
      try {
        await env.YS_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 });
      } catch (_) { /* 免费版 KV 每天 1000 次写，写不进去不影响读 */ }
    }

    return json(payload, 200, { 'x-ys-source': 'd1' });
  } catch (e) {
    return json(
      { releases: [], error: 'd1-error', detail: String(e && e.message ? e.message : e).slice(0, 200) },
      200,
      { 'x-ys-source': 'd1-error' }
    );
  }
}
