// POST /api/hit  { key: "dl:latest" }
// 计数自增。D1 的 upsert 单语句就是原子的，不需要事务也不需要 Durable Objects。
// 只做微小的键白名单，防止被写成任意垃圾键。

const KEY_RE = /^[a-z0-9:_\-./]{1,80}$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

const CORS = {
  'access-control-allow-origin': 'https://0721ciallo.xyz',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.YS_DB) {
    return json({ ok: false, error: 'no-db-binding' }, 200, CORS);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'bad-json' }, 400, CORS);
  }

  const key = body && typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY_RE.test(key)) {
    return json({ ok: false, error: 'bad-key' }, 400, CORS);
  }

  try {
    const row = await env.YS_DB
      .prepare(
        `INSERT INTO counters (key, n) VALUES (?1, 1)
         ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = datetime('now')
         RETURNING n`
      )
      .bind(key)
      .first();

    return json({ ok: true, key, n: row ? row.n : null }, 200, CORS);
  } catch (e) {
    return json(
      { ok: false, error: 'd1-error', detail: String(e && e.message ? e.message : e).slice(0, 200) },
      200,
      CORS
    );
  }
}
