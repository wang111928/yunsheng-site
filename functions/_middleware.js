// Pages Functions 全局中间件
// 只做三件事：安全响应头、清除 D1 意外落下的 CORS 头、把异常收敛成 500 JSON。
// 注意：CSP 已经在 public/_headers 里，这里不重复设置，避免两处冲突。

export async function onRequest(context) {
  const { next } = context;

  let res;
  try {
    res = await next();
  } catch (e) {
    res = new Response(
      JSON.stringify({ error: 'internal', detail: String(e && e.message ? e.message : e).slice(0, 200) }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }

  const h = new Headers(res.headers);
  if (!h.has('x-content-type-options')) h.set('x-content-type-options', 'nosniff');
  if (!h.has('referrer-policy')) h.set('referrer-policy', 'strict-origin-when-cross-origin');

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}
