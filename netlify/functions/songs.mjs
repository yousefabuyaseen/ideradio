// IDERADIO shared playlist API. One JSON blob per month in Netlify Blobs; writes use ETags so two people adding at once don't clobber each other.
import { getStore } from "@netlify/blobs";

const MAX = 5;
const SERVICES = ["spotify", "apple", "youtube", "soundcloud", "tidal", "deezer"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
const fmt = t => { const d = new Date(t); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") };
const openMonths = () => { const n = Date.now(); return new Set([fmt(n - 864e5), fmt(n), fmt(n + 864e5)]) };
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpsUrl = v => { try { const u = new URL(v); return u.protocol === "https:" && v.length < 600 ? u.href : null } catch { return null } };

// Read-modify-write one month with an ETag guard; retries when someone else wrote first.
async function update(store, month, fn) {
  for (let i = 0; i < 6; i++) {
    const cur = await store.getWithMetadata(month, { type: "json", consistency: "strong" });
    const list = (cur && cur.data) || [];
    const out = fn(list);
    if (out.error) return out;
    const res = await store.setJSON(month, out.list, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (res.modified) return out;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  return { error: "busy" };
}

export default async req => {
  const store = getStore({ name: "ideradio", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const months = blobs.map(b => b.key).filter(k => /^\d{4}-\d{2}$/.test(k));
    const lists = await Promise.all(months.map(k => store.get(k, { type: "json" })));
    const songs = lists.flat().filter(Boolean);
    const sig = await sha256(songs.map(s => s.id + s.name).join(","));
    return json({ songs, sig });
  }

  let body;
  try { body = await req.json() } catch { return json({ error: "bad request" }, 400) }
  const token = str(body.token, 200);
  if (token.length < 32) return json({ error: "bad token" }, 400);
  const owner = await sha256(token);
  const month = str(body.month, 7);
  if (!openMonths().has(month)) return json({ error: "closed" }, 403);

  if (req.method === "POST") {
    // Accepts one song or a whole crate: { songs: [...] }. All-or-nothing.
    const name = str(body.name, 24) || "anon";
    const incoming = Array.isArray(body.songs) ? body.songs.slice(0, MAX) : [body];
    const key = s => (s.title + "|" + s.artist).toLowerCase();
    const songs = [];
    for (const x of incoming) {
      const title = str(x.title, 200), artist = str(x.artist, 200);
      if (!title) continue;
      const links = {};
      for (const k of SERVICES) { const u = x.links && httpsUrl(x.links[k]); if (u) links[k] = u }
      const s = { id: crypto.randomUUID(), month, name, owner_hash: owner, title, artist,
        artwork: httpsUrl(x.artwork), preview: httpsUrl(x.preview), links, created_at: new Date(Date.now() + songs.length).toISOString() };
      if (!songs.some(o => key(o) === key(s))) songs.push(s);
    }
    if (!songs.length) return json({ error: "missing" }, 400);
    const r = await update(store, month, list => {
      if (list.filter(s => s.owner_hash === owner).length + songs.length > MAX) return { error: "limit" };
      const dup = songs.find(s => list.some(o => key(o) === key(s)));
      if (dup) return { error: "dupe", title: dup.title };
      for (const s of list) if (s.owner_hash === owner) s.name = name;
      return { list: [...list, ...songs] };
    });
    if (r.error) return json({ error: r.error, title: r.title }, r.error === "busy" ? 503 : 409);
    return json({ songs, song: songs[0] });
  }

  if (req.method === "DELETE") {
    const id = str(body.id, 64);
    const r = await update(store, month, list => ({ list: list.filter(s => !(s.id === id && s.owner_hash === owner)) }));
    return r.error ? json({ error: r.error }, 503) : json({ ok: true });
  }

  return json({ error: "method" }, 405);
};

export const config = { path: "/api/songs" };
