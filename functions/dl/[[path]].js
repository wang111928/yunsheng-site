// GET /dl/latest  或  /dl/v0.2.42  或  /dl/<文件名>
// 计数 + 302 跳 GitHub 原始地址。
// 若该 APK 已镜像到 R2（assets.r2_key 非空），直接流式返回，不走 GitHub。

const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;
const TAG_RE = /^v?\d+\.\d+\.\d+$/;

async function bump(env, key) {
  if (!env.YS_DB) return;
  try {
    await env.YS_DB
      .prepare(
        `INSERT INTO counters (key, n) VALUES (?1, 1)
         ON CONFLICT(key) DO UPDATE SET n = n + 1, updated_at = datetime('now')`
      )
      .bind(key)
      .run();
  } catch (_) { /* 计数失败不阻断下载 */ }
}

function goto(url, extra = {}) {
  return new Response(null, {
    status: 302,
    headers: { location: url, 'cache-control': 'no-store', ...extra },
  });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const seg = (params.path || []).join('/');
  if (!seg) return goto('https://github.com/wang111928/yunsheng-player/releases/latest');

  const isLatest = seg === 'latest';
  const isTag = TAG_RE.test(seg);
  const isName = NAME_RE.test(seg);

  if (!isLatest && !isTag && !isName) {
    return new Response('bad request', { status: 400 });
  }

  if (!env.YS_DB) {
    return goto('https://github.com/wang111928/yunsheng-player/releases/latest');
  }

  try {
    let asset = null;

    if (isLatest) {
      asset = await env.YS_DB
        .prepare(
          `SELECT a.name, a.download_url, a.r2_key
             FROM assets a
             JOIN releases r ON r.id = a.release_id
            WHERE r.prerelease = 0
         ORDER BY r.published_at DESC, a.size DESC
            LIMIT 1`
        )
        .first();
      await bump(env, 'dl:latest');
    } else if (isTag) {
      const tag = seg.startsWith('v') ? seg : 'v' + seg;
      asset = await env.YS_DB
        .prepare(
          `SELECT a.name, a.download_url, a.r2_key
             FROM assets a
             JOIN releases r ON r.id = a.release_id
            WHERE r.tag = ?1
         ORDER BY a.size DESC LIMIT 1`
        )
        .bind(tag)
        .first();
      await bump(env, 'dl:' + tag);
    } else {
      asset = await env.YS_DB
        .prepare(
          `SELECT name, download_url, r2_key FROM assets
            WHERE name = ?1 ORDER BY updated_at DESC LIMIT 1`
        )
        .bind(seg)
        .first();
      await bump(env, 'dl:' + seg);
    }

    if (!asset) {
      return goto('https://github.com/wang111928/yunsheng-player/releases/latest');
    }

    // R2 镜像优先
    if (asset.r2_key && env.YS_R2) {
      const obj = await env.YS_R2.get(asset.r2_key);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            'content-type': 'application/vnd.android.package-archive',
            'content-disposition':
              'attachment; filename="' + asset.name.replace(/"/g, '') + '"',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }

    return goto(asset.download_url);
  } catch (e) {
    return goto('https://github.com/wang111928/yunsheng-player/releases/latest');
  }
}
