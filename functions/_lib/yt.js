// Finds the YouTube video for a song (YouTube Data API, free key in env.YT_KEY) and stores it on the row.
export async function findYt(env, s) {
  if (!env.YT_KEY) return null;
  const q = [s.artist, s.title].filter(Boolean).join(" ");
  const u = "https://www.googleapis.com/youtube/v3/search?part=id&type=video&maxResults=1&videoCategoryId=10&q=" + encodeURIComponent(q) + "&key=" + env.YT_KEY;
  const r = await fetch(u);
  if (!r.ok) return null;
  const id = (await r.json()).items?.[0]?.id?.videoId || null;
  if (id) await env.DB.prepare("UPDATE songs SET yt = ? WHERE id = ?").bind(id, s.id).run();
  return id;
}
