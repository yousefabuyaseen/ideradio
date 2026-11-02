// Apple Music top songs. The feed has no CORS, so we relay it; the browser then looks up previews itself
// (Apple refuses lookups from Cloudflare's servers).
export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default, key = new Request(new URL(request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let ids = [];
  try {
    const r = await fetch("https://rss.marketingtools.apple.com/api/v2/us/music/most-played/25/songs.json", {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", accept: "application/json" },
    });
    ids = ((await r.json()).feed?.results || []).map(x => x.id).filter(Boolean);
  } catch {}
  const res = new Response(JSON.stringify({ ids }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  if (ids.length) waitUntil(cache.put(key, res.clone()));
  return res;
}
