// Fill in YouTube video ids for songs that don't have one yet (older songs, or if the key was added later).
import { findYt } from "../_lib/yt.js";
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!env.YT_KEY) return json({ enabled: false, found: {} });
  let ids = [];
  try { ids = ((await request.json()).ids || []).filter(x => typeof x === "string").slice(0, 10) } catch {}
  if (!ids.length) return json({ enabled: true, found: {} });
  const { results } = await env.DB.prepare(`SELECT id, title, artist, yt FROM songs WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  const found = {};
  for (const s of results) found[s.id] = s.yt || await findYt(env, s);
  return json({ enabled: true, found });
}
export async function onRequestGet({ env }) { return json({ enabled: !!env.YT_KEY }) }
