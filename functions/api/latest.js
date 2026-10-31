// GET /api/latest
// 只取最新一条正式版，供首屏「LATEST RELEASE」小字与下载按钮用。
// 同样全程降级，绝不 500。

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
  const withPre = url.searchParams.get('prerelease') === '1';

  const cacheKey = 'latest:' + (withPre ? 'any' : 'stable');

  if (env.YS_KV) {
    try {
      const hit = await env.YS_KV.get(cacheKey, 'json');
      if (hit && hit.tag) return json(hit, 200, { 'x-ys-source': 'kv' });
    } catch (_) { /* ignore */ }
  }

  if (!env.YS_DB) {
    return json({ error: 'no-db-binding' }, 200, { 'x-ys-source': 'none' });
  }

  try {
    const sql = withPre
      ? `SELECT id, tag, name, version, published_at, body, html_url
           FROM releases ORDER BY published_at DESC LIMIT 1`
      : `SELECT id, tag, name, version, published_at, body, html_url
           FROM releases WHERE prerelease = 0 ORDER BY published_at DESC LIMIT 1`;

    const row = await env.YS_DB.prepare(sql).first();
    if (!row) return json({ error: 'empty' }, 200, { 'x-ys-source': 'd1-empty' });

    const asset = await env.YS_DB
      .prepare(
        `SELECT name, size, sha256, abi, download_url, r2_key
           FROM assets WHERE release_id = ?1
       ORDER BY size DESC LIMIT 1`
      )
      .bind(row.id)
      .first();

    const payload = {
      tag: row.tag,
      name: row.name,
      version: row.version,
      published_at: row.published_at,
      body: row.body,
      html_url: row.html_url,
      asset: asset
        ? {
            name: asset.name,
            size: asset.size,
            sha256: asset.sha256,
            abi: asset.abi,
            download_url: asset.download_url,
            mirror: asset.r2_key ? '/dl/' + encodeURIComponent(asset.name) : null,
          }
        : null,
    };

    if (env.YS_KV) {
      try {
        await env.YS_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 });
      } catch (_) { /* ignore */ }
    }

    return json(payload, 200, { 'x-ys-source': 'd1' });
  } catch (e) {
    return json(
      { error: 'd1-error', detail: String(e && e.message ? e.message : e).slice(0, 200) },
      200,
      { 'x-ys-source': 'd1-error' }
    );
  }
}
