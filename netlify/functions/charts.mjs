// Apple Music top songs (no CORS on the feed), enriched with 30-second previews. Cached at the edge for an hour.
export default async () => {
  try {
    const feed = await (await fetch("https://rss.marketingtools.apple.com/api/v2/us/music/most-played/25/songs.json")).json();
    const ids = (feed.feed?.results || []).map(r => r.id).join(",");
    const look = ids ? await (await fetch("https://itunes.apple.com/lookup?entity=song&id=" + ids)).json() : { results: [] };
    const songs = (look.results || []).filter(x => x.kind === "song").map(x => ({
      title: x.trackName, artist: x.artistName,
      artwork: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", "300x300bb") : null,
      preview: x.previewUrl || null, links: { apple: x.trackViewUrl },
    }));
    return new Response(JSON.stringify({ songs }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600", "netlify-cdn-cache-control": "public, s-maxage=3600" } });
  } catch {
    return new Response(JSON.stringify({ songs: [] }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
export const config = { path: "/api/charts" };
