// Song search through Deezer, which (unlike Apple's open search) returns the explicit versions of songs.
// GET ?q=...&limit=  -> { songs }
// GET ?id=<deezer track id> -> { preview }  (Deezer preview links expire after about 15 minutes)
const json = (body, status = 200, cache = 0) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache ? `public, max-age=${cache}` : "no-store" } });

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url), q = (url.searchParams.get("q") || "").trim().slice(0, 120), id = url.searchParams.get("id");
  if (id) {
    if (!/^\d+$/.test(id)) return json({ error: "bad id" }, 400);
    const t = await fetch("https://api.deezer.com/track/" + id).then(r => r.json()).catch(() => ({}));
    return t.preview ? json({ preview: t.preview }) : json({ error: "not found" }, 404);
  }
  if (!q) return json({ songs: [] });
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 15));
  const cache = caches.default, key = new Request("https://cache.local/search?" + limit + "&" + encodeURIComponent(q.toLowerCase()));
  const hit = await cache.match(key); if (hit) return hit;
  const d = await fetch(`https://api.deezer.com/search?limit=${Math.min(50, limit * 2)}&q=` + encodeURIComponent(q)).then(r => r.json()).catch(() => ({}));
  if (!d.data) return json({ error: "search down" }, 502);
  const songs = d.data.filter(x => x.type === "track" && x.readable !== false).map(x => ({
    title: x.title, artist: x.artist && x.artist.name || "", artwork: x.album && (x.album.cover_big || x.album.cover_medium) || null,
    preview: x.preview || null, explicit: !!x.explicit_lyrics, links: { deezer: "https://www.deezer.com/track/" + x.id },
  }));
  const res = json({ songs }, 200, 600);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
