// Reads a shared playlist link so people can pick from their own music without connecting an account.
// Apple Music: the public playlist page lists its songs (we return the song ids; the browser looks them up on iTunes).
// YouTube / YouTube Music: the Data API with our key.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const json = (body, status = 200, cache = 0) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache ? `public, max-age=${cache}` : "no-store" } });

async function apple(u) {
  const r = await fetch(u.href, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!r.ok) return null;
  const html = await r.text();
  const i = html.indexOf("schema:music-playlist");
  if (i < 0) return null;
  const a = html.indexOf(">", i) + 1, b = html.indexOf("</script>", a);
  const j = JSON.parse(html.slice(a, b));
  const ids = (j.track || []).map(t => (String(t.url || "").match(/\/song\/[^/]+\/(\d+)/) || String(t.url || "").match(/[?&]i=(\d+)/) || [])[1]).filter(Boolean);
  return { name: j.name || "Playlist", ids };
}

async function youtube(list, key) {
  const base = "https://www.googleapis.com/youtube/v3/";
  const [p, items] = await Promise.all([
    fetch(`${base}playlists?part=snippet&id=${encodeURIComponent(list)}&key=${key}`).then(r => r.json()),
    fetch(`${base}playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(list)}&key=${key}`).then(r => r.json()),
  ]);
  if (!items.items) return null;
  const songs = items.items.map(i => i.snippet).filter(s => s.resourceId && s.resourceId.videoId && s.title !== "Private video" && s.title !== "Deleted video").map(s => ({
    title: s.title, artist: (s.videoOwnerChannelTitle || "").replace(/\s+-\s+topic$/i, ""), artwork: ((s.thumbnails || {}).medium || {}).url || null, yt: s.resourceId.videoId,
  }));
  return { name: (p.items && p.items[0] && p.items[0].snippet.title) || "Playlist", songs };
}

export async function onRequestGet({ request, env, waitUntil }) {
  let u;
  try { u = new URL(new URL(request.url).searchParams.get("url") || "") } catch { return json({ error: "bad url" }, 400) }
  const cache = caches.default, key = new Request("https://cache.local/playlist?" + encodeURIComponent(u.href));
  const hit = await cache.match(key); if (hit) return hit;
  let out = null;
  try {
    if (/(^|\.)music\.apple\.com$/.test(u.hostname) && u.pathname.includes("/playlist/")) out = await apple(u);
    else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname) && u.searchParams.get("list") && env.YT_KEY) out = await youtube(u.searchParams.get("list"), env.YT_KEY);
    else return json({ error: "unsupported" }, 400);
  } catch {}
  if (!out) return json({ error: "unreadable" }, 404);
  const res = json(out, 200, 600);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
