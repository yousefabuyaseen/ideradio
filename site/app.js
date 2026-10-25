(() => {
  "use strict";
  const CFG = window.IDERADIO_CONFIG || {};
  const MAX = 5;
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false && kid !== "") el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const put = (el, ...kids) => el && el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== ""));
  const store = {
    get(k) { try { return localStorage.getItem(k) } catch { return null } },
    set(k, v) { try { localStorage.setItem(k, v) } catch {} },
    json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  };
  const monthKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  const toDate = k => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1) };
  const monthLabel = k => toDate(k).toLocaleString("en", { month: "long", year: "numeric" });
  const monthName = k => toDate(k).toLocaleString("en", { month: "long" });
  const CURRENT = monthKey();
  const timeLeft = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 1) - n };
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  async function sha256(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  }
  const PAL = ["#1f9fe6", "#ff3d6e", "#1a9a35", "#8a5cf6", "#f08a00", "#0fa79a", "#d43f7a", "#3a6fd8"];
  const colorFor = s => { let x = 0; for (const c of (s || "").toLowerCase()) x = (x * 31 + c.charCodeAt(0)) >>> 0; return PAL[x % PAL.length] };
  const safeUrl = v => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.href : null } catch { return null } };
  const keyOf = s => ((s.title || "") + "|" + (s.artist || "")).toLowerCase();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let toastT;
  function toast(msg, link) {
    const t = $("#toast");
    put(t, h("span", {}, msg), link ? h("a", { href: link.href, target: "_blank", rel: "noopener" }, link.text) : null);
    t.hidden = false; t.style.animation = "none"; t.offsetWidth; t.style.animation = "";
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, link ? 7000 : 2600);
  }

  // ---------- services ----------
  const SERVICES = {
    spotify:    { name: "Spotify",       host: /spotify\.(com|link)/, url: q => "https://open.spotify.com/search/" + encodeURIComponent(q) },
    apple:      { name: "Apple Music",   host: /music\.apple\.com|itunes\.apple\.com/, url: q => "https://music.apple.com/us/search?term=" + encodeURIComponent(q) },
    youtube:    { name: "YouTube Music", host: /youtube\.com|youtu\.be/, url: q => "https://music.youtube.com/search?q=" + encodeURIComponent(q) },
    soundcloud: { name: "SoundCloud",    host: /soundcloud\.com/, url: q => "https://soundcloud.com/search?q=" + encodeURIComponent(q) },
    tidal:      { name: "Tidal",         host: /tidal\.com/, url: q => "https://listen.tidal.com/search?q=" + encodeURIComponent(q) },
    deezer:     { name: "Deezer",        host: /deezer\.(com|page\.link)/, url: q => "https://www.deezer.com/search/" + encodeURIComponent(q) },
  };
  const serviceOf = url => { try { const host = new URL(url).hostname; for (const [k, s] of Object.entries(SERVICES)) if (s.host.test(host)) return k } catch {} return null };

  // ---------- identity: a private token on this device; the name is optional ----------
  let token = store.get("ideradio.token");
  if (!token) { token = rand(24); store.set("ideradio.token", token) }
  let myHash = null;
  let myName = store.get("ideradio.name") || "";

  // ---------- data ----------
  function apiStore() {
    const call = async (method, body) => {
      const r = await fetch("/api/songs", { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw { message: j.error || "error", title: j.title };
      return j;
    };
    let pollT, lastSig = "";
    return {
      async list() { const j = await call("GET"); lastSig = j.sig || ""; return j.songs || [] },
      async submit(name, songs) { return (await call("POST", { token, month: CURRENT, name, songs })).songs || [] },
      async remove(id, month) { await call("DELETE", { token, id, month }) },
      subscribe(cb) {
        const tick = async () => {
          clearTimeout(pollT);
          if (!document.hidden && !state.busy) {
            try { const j = await call("GET"); if (j.sig !== lastSig) { lastSig = j.sig; cb(j.songs) } setStatus("live") }
            catch { setStatus("reconnecting") }
          }
          pollT = setTimeout(tick, 4000);
        };
        pollT = setTimeout(tick, 4000);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) tick() });
      },
    };
  }
  function demoStore() {
    const KEY = "ideradio.demo";
    const bc = "BroadcastChannel" in window ? new BroadcastChannel("ideradio") : null;
    const read = () => store.json(KEY, []);
    const write = rows => { store.set(KEY, JSON.stringify(rows)); bc && bc.postMessage("sync") };
    return {
      async list() { return read() },
      async submit(name, songs) {
        const rows = read();
        if (rows.filter(r => r.owner_hash === myHash && r.month === CURRENT).length + songs.length > MAX) throw { message: "limit" };
        const dup = songs.find(s => rows.some(r => r.month === CURRENT && keyOf(r) === keyOf(s)));
        if (dup) throw { message: "dupe", title: dup.title };
        rows.forEach(r => { if (r.owner_hash === myHash && r.month === CURRENT) r.name = name });
        const out = songs.map((s, i) => ({ ...s, id: crypto.randomUUID(), month: CURRENT, name, owner_hash: myHash, created_at: new Date(Date.now() + i).toISOString() }));
        write([...rows, ...out]); return out;
      },
      async remove(id) { write(read().filter(r => !(r.id === id && r.owner_hash === myHash))) },
      subscribe(cb) {
        bc && (bc.onmessage = () => cb(read()));
        addEventListener("storage", e => e.key === KEY && cb(read()));
      },
    };
  }
  let db = demoStore();

  // ---------- state ----------
  const state = {
    view: "mix", month: CURRENT,
    service: SERVICES[store.get("ideradio.svc")] ? store.get("ideradio.svc") : "spotify",
    songs: new Map(), loaded: false, busy: false,
    crate: store.json("ideradio.crate", []).filter(s => s && s.title),
    sheet: null, // { mode: "browse" | "crate", tab, query, results, loading, note }
  };
  const seen = new Set();
  const songsFor = k => [...state.songs.values()].filter(s => s.month === k).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const mine = () => songsFor(CURRENT).filter(s => s.owner_hash && s.owner_hash === myHash);
  const allMonths = () => [...new Set([CURRENT, ...[...state.songs.values()].map(s => s.month)])].filter(k => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  const slotsLeft = () => Math.max(0, MAX - mine().length - state.crate.length);
  const saveCrate = () => store.set("ideradio.crate", JSON.stringify(state.crate));

  // ---------- Spotify (PKCE, no server) ----------
  const SP = {
    cid: CFG.spotifyClientId,
    redirect: location.origin + "/",
    cache: store.json("ideradio.spcache", {}),
    get tok() { return store.json("ideradio.sp", null) },
    set tok(v) { store.set("ideradio.sp", JSON.stringify(v)) },
    connected() { return !!(this.cid && this.tok) },
    b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
    async login(intent) {
      const verifier = rand(48);
      const challenge = this.b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const st = rand(8);
      sessionStorage.setItem("ideradio.pkce", JSON.stringify({ verifier, st, intent }));
      location.assign("https://accounts.spotify.com/authorize?" + new URLSearchParams({
        client_id: this.cid, response_type: "code", redirect_uri: this.redirect, state: st,
        code_challenge_method: "S256", code_challenge: challenge, scope: "playlist-modify-private playlist-modify-public",
      }));
    },
    async tokenReq(body) {
      const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.cid, ...body }) });
      if (!r.ok) throw new Error("spotify auth");
      const j = await r.json();
      this.tok = { access: j.access_token, refresh: j.refresh_token || (this.tok && this.tok.refresh), exp: Date.now() + (j.expires_in - 60) * 1000 };
    },
    async callback() {
      const q = new URLSearchParams(location.search);
      if (!q.has("code") && !q.has("error")) return null;
      history.replaceState(null, "", location.pathname + location.hash);
      let saved; try { saved = JSON.parse(sessionStorage.getItem("ideradio.pkce")) } catch {}
      sessionStorage.removeItem("ideradio.pkce");
      if (q.has("error") || !saved || saved.st !== q.get("state")) { toast("Spotify not connected"); return null }
      await this.tokenReq({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: this.redirect, code_verifier: saved.verifier });
      return saved.intent || {};
    },
    async api(path, opts = {}) {
      let t = this.tok;
      if (!t) throw new Error("not connected");
      if (Date.now() > t.exp && t.refresh) { await this.tokenReq({ grant_type: "refresh_token", refresh_token: t.refresh }); t = this.tok }
      const r = await fetch("https://api.spotify.com/v1" + path, { ...opts, headers: { Authorization: "Bearer " + t.access, "Content-Type": "application/json", ...(opts.headers || {}) } });
      if (r.status === 401) { store.set("ideradio.sp", "null"); renderMix(); throw new Error("expired") }
      return r;
    },
    async find(s) {
      const key = keyOf(s);
      if (key in this.cache) return this.cache[key];
      const direct = s.links && s.links.spotify && s.links.spotify.match(/track\/([A-Za-z0-9]+)/);
      let hit = null;
      if (direct) hit = { uri: "spotify:track:" + direct[1], url: s.links.spotify };
      else {
        for (const q of [`track:${s.title} artist:${s.artist}`, `${s.title} ${s.artist}`]) {
          const r = await this.api("/search?type=track&limit=1&q=" + encodeURIComponent(q));
          if (!r.ok) break;
          const it = (await r.json()).tracks?.items?.[0];
          if (it) { hit = { uri: it.uri, url: it.external_urls.spotify }; break }
        }
      }
      this.cache[key] = hit; store.set("ideradio.spcache", JSON.stringify(this.cache));
      return hit;
    },
    async createPlaylist(name) {
      const body = JSON.stringify({ name, public: false, description: "Made with IDERADIO" });
      let r = await this.api("/me/playlists", { method: "POST", body });
      if (!r.ok) {
        const me = await (await this.api("/me")).json();
        r = await this.api(`/users/${encodeURIComponent(me.id)}/playlists`, { method: "POST", body });
      }
      if (!r.ok) throw new Error("create");
      return r.json();
    },
    async addAll(id, uris) {
      for (let i = 0; i < uris.length; i += 100) {
        const body = JSON.stringify({ uris: uris.slice(i, i + 100) });
        let r = await this.api(`/playlists/${id}/items`, { method: "POST", body });
        if (!r.ok) r = await this.api(`/playlists/${id}/tracks`, { method: "POST", body });
        if (!r.ok) throw new Error("add");
      }
    },
  };
  async function saveToSpotify(month) {
    if (!SP.connected()) return SP.login({ action: "save", month });
    const tracks = songsFor(month);
    if (!tracks.length) return toast("Nothing to save yet");
    toast("Saving to Spotify…");
    try {
      const uris = [];
      for (const t of tracks) { const f = await SP.find(t); if (f) uris.push(f.uri) }
      const pl = await SP.createPlaylist("IDERADIO · " + monthLabel(month));
      await SP.addAll(pl.id, uris);
      const miss = tracks.length - uris.length;
      toast(`Saved ${uris.length} songs${miss ? ` (${miss} not on Spotify)` : ""}`, { href: pl.external_urls.spotify, text: "Open ↗" });
    } catch { toast("Spotify save failed. Try again.") }
  }
  let resolving = false;
  async function resolveSpotify() {
    if (resolving || !SP.connected() || state.service !== "spotify") return;
    resolving = true;
    try { for (const s of songsFor(state.month)) { if (keyOf(s) in SP.cache) continue; await SP.find(s); renderRows() } }
    catch {} finally { resolving = false }
  }
  function linkFor(s) {
    const svc = state.service, l = s.links || {};
    if (l[svc]) return l[svc];
    if (svc === "spotify") { const c = SP.cache[keyOf(s)]; if (c) return c.url }
    return SERVICES[svc].url(s.artist ? s.artist + " " + s.title : s.title);
  }

  // ---------- music search (iTunes, no login) ----------
  const mapIt = x => ({
    title: x.trackName, artist: x.artistName,
    artwork: x.artworkUrl100 ? x.artworkUrl100.replace("100x100bb", "300x300bb") : null,
    preview: x.previewUrl || null, links: { apple: x.trackViewUrl },
  });
  const itCache = new Map();
  async function itunes(q, limit = 12, signal) {
    const ck = q + "|" + limit;
    if (itCache.has(ck)) return itCache.get(ck);
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=` + encodeURIComponent(q), { signal });
    const out = ((await r.json()).results || []).filter(x => x.trackName).map(mapIt);
    itCache.set(ck, out); return out;
  }
  const clean = s => (s || "").replace(/\s*[\(\[](official|lyric|audio|visuali[sz]er|music video|video|hd|4k)[^\)\]]*[\)\]]/gi, "").replace(/\s+-\s+topic$/i, "").replace(/vevo$/i, "").trim();
  async function readLink(url) {
    const svc = serviceOf(url);
    const oembed = async u => { const r = await fetch(u); if (!r.ok) throw 0; return r.json() };
    try {
      if (svc === "apple") {
        const u = new URL(url); const id = u.searchParams.get("i") || (u.pathname.match(/\/(\d+)(?:$|\?)/) || [])[1];
        if (id) { const j = await (await fetch("https://itunes.apple.com/lookup?entity=song&id=" + id)).json(); const x = (j.results || []).find(r => r.kind === "song"); if (x) return { exact: mapIt(x) } }
      }
      if (svc === "spotify") {
        const j = await oembed("https://open.spotify.com/oembed?url=" + encodeURIComponent(url));
        return { query: j.title, links: { spotify: url }, fallback: { title: j.title, artist: "", artwork: j.thumbnail_url, links: { spotify: url } } };
      }
      if (svc === "youtube") {
        const j = await oembed("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url));
        let title = clean(j.title), artist = clean(j.author_name);
        const m = title.match(/^(.+?)\s+[-–]\s+(.+)$/); if (m) { artist = m[1]; title = m[2] }
        return { query: artist + " " + title, links: { youtube: url }, fallback: { title, artist, artwork: j.thumbnail_url, links: { youtube: url } } };
      }
      if (svc === "soundcloud") {
        const j = await oembed("https://soundcloud.com/oembed?format=json&url=" + encodeURIComponent(url));
        const m = (j.title || "").match(/^(.+) by (.+)$/);
        const title = m ? m[1] : j.title, artist = m ? m[2] : j.author_name;
        return { query: artist + " " + title, links: { soundcloud: url }, fallback: { title, artist, artwork: j.thumbnail_url, links: { soundcloud: url } } };
      }
    } catch {}
    return { unreadable: true };
  }

  // ---------- suggestions ----------
  const MOODS = ["new year", "love songs", "spring", "rainy day", "sunshine", "summer", "summer night", "road trip", "back to school", "autumn", "cozy", "winter"];
  function vibeLabel() {
    const d = new Date().getDate();
    return d <= 10 ? monthName(CURRENT) + " fresh" : d <= 20 ? monthName(CURRENT) + " mood" : "Last call";
  }
  const vibeQuery = () => { const d = new Date().getDate(); return MOODS[new Date().getMonth()] + (d <= 10 ? " upbeat" : d <= 20 ? "" : " chill") };
  const sugCache = {};
  const exclude = items => {
    const taken = new Set(songsFor(CURRENT).map(keyOf));
    const out = [], seenK = new Set();
    for (const it of items) { const k = keyOf(it); if (!taken.has(k) && !seenK.has(k) && it.preview) { seenK.add(k); out.push(it) } }
    return out;
  };
  function topArtists(rows, n) {
    const c = new Map();
    for (const s of rows) if (s.artist) c.set(s.artist, (c.get(s.artist) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  const TABS = {
    foryou: { label: "For you", async load() {
      const hist = [...[...state.songs.values()].filter(s => s.owner_hash === myHash), ...store.json("ideradio.hist", [])];
      const artists = topArtists(hist, 3);
      if (!artists.length) {
        const [v, t] = await Promise.all([itunes(vibeQuery(), 10), loadCharts()]);
        return [{ h: "Start here", items: exclude([...t.slice(0, 5), ...v]).slice(0, 12) }];
      }
      const groups = await Promise.all(artists.map(async ([a]) => ({ h: "Because you picked " + a, items: exclude(await itunes(a, 12)).slice(0, 5) })));
      return groups.filter(g => g.items.length);
    } },
    trending: { label: "Trending", async load() { return [{ h: "Top songs right now", items: exclude(await loadCharts()) }] } },
    class: { label: "Class faves", async load() {
      const artists = topArtists([...state.songs.values()], 4);
      if (!artists.length) return [];
      const groups = await Promise.all(artists.map(async ([a, n]) => ({ h: `${a} · picked ${n}×`, items: exclude(await itunes(a, 10)).slice(0, 4) })));
      return groups.filter(g => g.items.length);
    } },
    vibes: { get label() { return vibeLabel() }, async load() { return [{ h: vibeLabel(), items: exclude(await itunes(vibeQuery(), 20)) }] } },
  };
  let chartsP;
  function loadCharts() {
    chartsP = chartsP || fetch("/api/charts").then(r => r.ok ? r.json() : { songs: [] }).then(j => j.songs || []).catch(() => []);
    return chartsP;
  }

  // ---------- previews: one player; the iPod shows what's playing ----------
  const pv = new Audio(); pv.preload = "none";
  let pvKey = null, pvItem = null, queue = null;
  function playPreview(item, key, q) {
    if (!item.preview) return toast("No preview for this one");
    if (pvKey === key && !pv.paused) { pv.pause(); return }
    if (pvKey !== key) { pv.src = item.preview; pv.currentTime = 0 }
    pvKey = key; pvItem = item; queue = q || null;
    pv.play().catch(() => {});
  }
  function stopPreview() { pv.pause(); pvKey = null; pvItem = null; queue = null; markPlaying(); showIpod() }
  function stepQueue(d) {
    if (!queue) return false;
    const i = queue.findIndex(x => "s:" + x.id === pvKey) + d;
    if (i < 0 || i >= queue.length) { stopPreview(); return true }
    playPreview(queue[i], "s:" + queue[i].id, queue); return true;
  }
  pv.addEventListener("play", () => { markPlaying(); showIpod() });
  pv.addEventListener("pause", () => { if (!pv.ended) { markPlaying(); showIpod() } });
  pv.addEventListener("ended", () => { if (!stepQueue(1)) { pvKey = null; pvItem = null; markPlaying(); showIpod() } });
  pv.addEventListener("timeupdate", () => {
    const d = pv.duration || 30, k = pv.currentTime / d * 100;
    document.querySelectorAll(`.row[data-key="${CSS.escape(pvKey || "")}"] .prog i`).forEach(i => i.style.width = k + "%");
    setClock(pv.currentTime, d);
  });
  function markPlaying() {
    document.querySelectorAll(".row[data-key]").forEach(r => {
      const on = r.dataset.key === pvKey && !pv.paused;
      r.classList.toggle("playing", on);
      const g = r.querySelector(".pv"); if (g) g.textContent = on ? "❚❚" : "▶";
      const b = r.querySelector(".bars"); if (b) b.hidden = !on;
      if (!on) { const i = r.querySelector(".prog i"); if (i && r.dataset.key !== pvKey) i.style.width = "0" }
    });
    const pm = $("#previewMix"); if (pm) pm.querySelector(".lbl").textContent = queue && !pv.paused ? "Stop preview" : "Preview mix";
  }

  // ---------- views ----------
  const view = $("#view");
  function setView(v, opts = {}) {
    if (v === "add") { openSheet(); v = "mix" }
    state.view = v;
    state.month = opts.month || (v === "mix" && !opts.keep ? CURRENT : state.month);
    document.querySelectorAll(".itabs button").forEach(b => b.setAttribute("aria-current", b.dataset.view === v ? "page" : "false"));
    if (v === "archive") renderArchive(); else buildMix();
  }

  function buildMix() {
    const isCur = state.month === CURRENT;
    put(view, h("section", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("h2", { class: "month-title" }, monthLabel(state.month)), h("div", { class: "meta", id: "meta" })),
        h("div", { class: "countdown", id: "countdown" })),
      isCur ? h("div", { class: "cta" },
        h("div", { class: "cta-line", id: "ctaLine" }),
        h("label", { class: "searchbox", onclick: () => openSheet() },
          h("span", { class: "ico", "aria-hidden": "true" }, "⌕"),
          h("input", { id: "q0", type: "search", readonly: true, placeholder: "Search a song or paste a link", "aria-label": "Add songs", onfocus: e => { e.target.blur(); openSheet() } }),
          h("span", { class: "go", "aria-hidden": "true" }, "+"))) : null,
      h("div", { class: "toolbar" },
        h("div", { class: "tabs", id: "svc", role: "group", "aria-label": "Listen on" }),
        h("div", { class: "actions" },
          !isCur ? h("button", { class: "btn", onclick: () => setView("mix") }, "← Now") : null,
          h("button", { class: "btn", id: "previewMix", onclick: () => { if (queue && !pv.paused) stopPreview(); else startMix() } }, "▶", h("span", { class: "lbl" }, "Preview mix")),
          SP.cid ? h("button", { class: "btn spotify", onclick: () => saveToSpotify(state.month) }, h("span", {}, "Save to Spotify")) : null,
          h("button", { class: "btn", onclick: copyList }, "⧉", h("span", { class: "lbl" }, "Copy list")))),
      h("ol", { class: "rows", id: "rows" })));
    renderMix();
  }

  function renderMix() {
    renderDock();
    if (state.view !== "mix") return;
    const k = state.month, tracks = songsFor(k), djs = new Set(tracks.map(t => t.owner_hash)).size;
    put($("#meta"), h("b", {}, tracks.length), tracks.length === 1 ? " song" : " songs", h("span", { class: "sep" }, "·"), h("b", {}, djs), djs === 1 ? " DJ" : " DJs");
    const cd = $("#countdown");
    if (cd) {
      if (k !== CURRENT) { cd.className = "countdown"; put(cd, h("span", { class: "n" }, "✓"), h("span", { class: "u" }, "closed")) }
      else {
        const ms = timeLeft(), days = Math.ceil(ms / 864e5), hours = Math.ceil(ms / 36e5);
        const [n, u] = days > 1 ? [days, "days left"] : [hours, hours === 1 ? "hour left" : "hours left"];
        cd.className = "countdown" + ((days <= 3 && mine().length < MAX) || mine().length === 0 ? " urgent" : "");
        put(cd, h("span", { class: "n" }, n), h("span", { class: "u" }, u));
      }
    }
    const cl = $("#ctaLine");
    if (cl) {
      const m = mine().length, c = state.crate.length;
      cl.className = "cta-line" + (m ? " done" : "");
      put(cl,
        h("span", { class: "flag" }, m === 0 ? "You're not in yet" : m >= MAX ? "You're in · all 5" : `You're in · ${m} of 5`),
        h("span", { class: "slots", "aria-label": `${m} added, ${c} in crate` }, Array.from({ length: MAX }, (_, i) => h("span", { class: "slot" + (i < m ? " on" : i < m + c ? " crate" : "") }))));
    }
    put($("#svc"), h("span", { class: "lbl" }, "Listen on"), Object.entries(SERVICES).map(([key, s]) =>
      h("button", { "aria-pressed": String(state.service === key), onclick: () => { state.service = key; store.set("ideradio.svc", key); renderMix(); resolveSpotify() } },
        key === "spotify" && SP.connected() ? h("span", { class: "dot" }) : null, s.name)),
      SP.cid && state.service === "spotify" && !SP.connected() ? h("button", { onclick: () => SP.login({ action: "connect" }), style: "color:var(--aqua)" }, "Connect →") : null);
    renderRows();
  }

  function renderRows() {
    const list = $("#rows"); if (!list) return;
    const k = state.month, tracks = songsFor(k), editable = k === CURRENT;
    if (!tracks.length) {
      put(list, h("li", { class: "empty" },
        h("strong", {}, state.loaded ? "Dead air" : "Tuning in"),
        state.loaded ? (editable ? h("button", { class: "btn hot lg", onclick: () => openSheet() }, "Be the first to add a song") : h("span", {}, "Nothing this month")) : h("div", { class: "aero-bar mini" }, h("div", { class: "aero-fill" }))));
      return;
    }
    put(list, tracks.map((t, i) => {
      const isNew = !seen.has(t.id); seen.add(t.id);
      const key = "s:" + t.id, on = pvKey === key && !pv.paused;
      return h("li", { class: "row" + (isNew ? " new" : "") + (on ? " playing" : ""), "data-key": key, style: isNew ? `animation-delay:${Math.min(i, 12) * 35}ms` : null },
        h("span", { class: "no" }, i + 1),
        artBtn(t, key, () => playPreview(t, key, null)),
        h("div", { class: "r-main" },
          h("span", { class: "r-t" }, t.title, h("span", { class: "bars", hidden: !on }, h("i"), h("i"), h("i"))),
          t.artist ? h("span", { class: "r-a" }, t.artist) : null,
          h("span", { class: "r-by", style: "--c:" + colorFor(t.name) }, t.name || "anon")),
        h("div", { class: "r-act" },
          h("a", { class: "btn icon", href: linkFor(t), target: "_blank", rel: "noopener", "aria-label": "Open in " + SERVICES[state.service].name, title: "Open in " + SERVICES[state.service].name }, "↗"),
          editable && t.owner_hash === myHash ? h("button", { class: "x", "aria-label": "Remove " + t.title, onclick: () => removeSong(t) }, "×") : null),
        h("span", { class: "prog" }, h("i")));
    }));
  }
  function artBtn(s, key, onclick) {
    const on = pvKey === key && !pv.paused;
    return h("button", { class: "art", "aria-label": "Preview " + s.title, onclick },
      s.artwork ? h("img", { src: s.artwork, alt: "", decoding: "async" }) : null,
      s.preview ? h("span", { class: "pv", "aria-hidden": "true" }, on ? "❚❚" : "▶") : null);
  }

  function renderArchive() {
    renderDock();
    put(view, h("section", { class: "card" },
      h("h2", { class: "month-title" }, "Archive"),
      h("div", { class: "months" }, allMonths().map((k, i) => {
        const t = songsFor(k), arts = t.filter(s => s.artwork).slice(0, 4);
        return h("button", { class: "month" + (k === CURRENT ? " cur" : ""), style: `animation-delay:${i * 50}ms`, onclick: () => setView("mix", { month: k }) },
          h("div", { class: "mosaic" }, Array.from({ length: 4 }, (_, j) => h("span", { style: arts[j] ? `background-image:url("${encodeURI(arts[j].artwork)}")` : null }))),
          h("span", { class: "m" }, monthLabel(k)),
          h("span", { class: "s" }, `${t.length} songs · ${new Set(t.map(x => x.owner_hash)).size} DJs${k === CURRENT ? " · on air" : ""}`));
      }))));
  }

  // ---------- picker sheet ----------
  function openSheet(opts = {}) {
    if (!state.sheet) state.sheet = { mode: "browse", tab: "foryou", query: "", groups: null, loading: false, note: "" };
    const fresh = !$("#sheetRoot").firstChild;
    Object.assign(state.sheet, opts, { fresh });
    document.body.style.overflow = "hidden";
    renderSheet();
    if (state.sheet.mode === "browse") { const q = $("#q"); q && setTimeout(() => q.focus({ preventScroll: true }), 60) }
    if (!state.sheet.groups && !state.sheet.query) loadTab();
  }
  function closeSheet() {
    state.sheet = null; document.body.style.overflow = "";
    put($("#sheetRoot")); if (pvKey && pvKey.startsWith("p:")) stopPreview();
    renderDock();
  }
  addEventListener("keydown", e => { if (e.key === "Escape" && state.sheet) closeSheet() });

  function renderSheet() {
    const S = state.sheet; if (!S) return;
    const browse = S.mode === "browse";
    put($("#sheetRoot"),
      h("div", { class: "scrim" + (S.fresh ? " anim" : ""), onclick: closeSheet }),
      h("div", { class: "sheet" + (S.fresh ? " anim" : ""), role: "dialog", "aria-modal": "true", "aria-label": browse ? "Add music" : "Your crate" },
        h("div", { class: "grab" }),
        h("div", { class: "sheet-head" },
          browse ? h("h3", {}, "Add music") : h("button", { class: "btn ghost", onclick: () => { S.mode = "browse"; renderSheet(); const q = $("#q"); q && q.focus() } }, "← Back"),
          !browse ? h("h3", {}, "Your crate") : null,
          h("button", { class: "btn ghost icon", "aria-label": "Close", onclick: closeSheet }, "✕")),
        browse ? h("div", { class: "sheet-search" },
          h("label", { class: "searchbox" },
            h("span", { class: "ico", "aria-hidden": "true" }, "⌕"),
            h("input", { id: "q", type: "search", autocomplete: "off", spellcheck: "false", placeholder: "Search a song or paste a link", value: S.query, oninput: e => onSearch(e.target.value), onkeydown: onSearchKey }))) : null,
        browse && !S.query ? h("div", { class: "tabs", role: "tablist" },
          Object.entries(TABS).map(([k, t]) => h("button", { role: "tab", "aria-selected": String(S.tab === k), onclick: () => { S.tab = k; S.groups = null; renderSheet(); loadTab() } }, t.label))) : null,
        h("div", { class: "sheet-body", id: "sheetBody" }),
        crateBar()));
    S.fresh = false;
    paintSheetBody();
  }
  function crateBar() {
    const c = state.crate, left = slotsLeft(), S = state.sheet;
    if (!c.length) return h("div", { class: "crate-bar" }, h("div", { class: "crate-txt" }, h("b", {}, "Your crate is empty"), `Tap + to stack up to ${MAX - mine().length}`));
    return h("div", { class: "crate-bar" },
      h("button", { class: "stack", style: "border:0;background:none;padding:0", "aria-label": "Review crate", onclick: () => { S.mode = "crate"; renderSheet() } }, c.map(s => h("span", { style: s.artwork ? `background-image:url("${encodeURI(s.artwork)}")` : null }))),
      h("div", { class: "crate-txt" }, h("b", {}, `${c.length} in your crate`), left ? `${left} more slot${left === 1 ? "" : "s"}` : "Crate full"),
      S.mode === "browse"
        ? h("button", { class: "btn hot lg", onclick: () => { S.mode = "crate"; renderSheet() } }, "Review →")
        : h("button", { class: "btn hot lg", id: "submitBtn", disabled: state.busy, onclick: submitCrate }, state.busy ? "Sending…" : `Submit ${c.length}`));
  }
  function paintSheetBody() {
    const S = state.sheet, body = $("#sheetBody"); if (!S || !body) return;
    if (S.mode === "crate") {
      put(body, h("div", { class: "checkout" },
        h("ol", { class: "rows" }, state.crate.map((s, i) => pickRow(s, "c:" + keyOf(s), true))),
        h("input", { class: "namefield", id: "name", maxlength: "24", autocomplete: "nickname", placeholder: "Name (optional, leave blank to stay anon)", value: myName, "aria-label": "Your name, optional" })));
      return;
    }
    if (S.loading && !S.groups) return put(body, h("div", { class: "aero-bar mini" }, h("div", { class: "aero-fill" })));
    if (S.note) return put(body, h("div", { class: "note" }, S.note));
    const groups = S.groups || [];
    if (!groups.length || !groups.some(g => g.items.length)) return put(body, h("div", { class: "note" }, S.query ? "No matches" : S.tab === "class" ? "No class picks yet. Yours could be the first." : "Nothing here right now. Try searching."));
    put(body, groups.map(g => [g.h ? h("div", { class: "group-h" }, g.h) : null, h("ol", { class: "rows" }, g.items.map(s => pickRow(s, "p:" + keyOf(s), false)))]));
  }
  function pickRow(s, key, inCrateView) {
    const inCrate = state.crate.some(c => keyOf(c) === keyOf(s));
    const taken = songsFor(CURRENT).some(c => keyOf(c) === keyOf(s));
    const on = pvKey === key && !pv.paused;
    const play = () => playPreview(s, key, null);
    return h("li", { class: "row" + (on ? " playing" : ""), "data-key": key, style: "grid-template-columns:48px minmax(0,1fr) auto" },
      artBtn(s, key, play),
      h("div", { class: "r-main", style: "cursor:pointer", onclick: play },
        h("span", { class: "r-t" }, s.title, h("span", { class: "bars", hidden: !on }, h("i"), h("i"), h("i"))),
        h("span", { class: "r-a" }, s.artist || "")),
      inCrateView
        ? h("button", { class: "x", "aria-label": "Remove " + s.title + " from crate", onclick: () => toggleCrate(s) }, "×")
        : h("button", { class: "add" + (inCrate ? " in" : ""), disabled: taken, title: taken ? "Already in the mix" : null, "aria-label": (inCrate ? "Remove " : "Add ") + s.title, onclick: () => toggleCrate(s) }, taken ? "✓" : inCrate ? "✓" : "+"),
      h("span", { class: "prog" }, h("i")));
  }
  async function loadTab() {
    const S = state.sheet; if (!S) return;
    const tab = S.tab; S.loading = true; S.note = ""; paintSheetBody();
    try {
      sugCache[tab] = sugCache[tab] || await TABS[tab].load();
      if (state.sheet && state.sheet.tab === tab && !state.sheet.query) { S.groups = sugCache[tab].map(g => ({ ...g, items: exclude(g.items) })) }
    } catch { S.note = "Couldn't load suggestions. Try searching." }
    S.loading = false; paintSheetBody();
  }
  let seq = 0, debounceT, searchCtl;
  function onSearch(v) {
    const S = state.sheet; const had = !!S.query; S.query = v;
    if (!!v !== had) { renderSheet(); const q = $("#q"); q.focus(); q.setSelectionRange(v.length, v.length) }
    clearTimeout(debounceT); debounceT = setTimeout(() => runSearch(v.trim()), 170);
    if (!v) { S.groups = null; loadTab() }
  }
  async function runSearch(v) {
    const S = state.sheet; if (!S || !v) return;
    const my = ++seq; S.loading = true; S.note = ""; S.groups = null; paintSheetBody();
    try {
      let items = [];
      if (/^https?:\/\//i.test(v)) {
        const r = await readLink(v); if (my !== seq) return;
        if (r.exact) items = [r.exact];
        else {
          const found = r.query ? await itunes(r.query, 8) : [];
          items = found.slice(0, 5).map(x => ({ ...x, links: { ...x.links, ...r.links } }));
          if (r.fallback && r.fallback.title) items.push(r.fallback);
          if (!items.length) S.note = "Can't read that link. Type the song name instead.";
        }
      } else {
        searchCtl && searchCtl.abort(); searchCtl = new AbortController();
        items = await itunes(v, 15, searchCtl.signal);
      }
      if (my !== seq || !state.sheet) return;
      S.groups = [{ items }];
    } catch (e) { if (e.name === "AbortError") return; if (my === seq) S.note = "Search is offline. Try again." }
    if (my === seq && state.sheet) { S.loading = false; paintSheetBody() }
  }
  function onSearchKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = state.sheet.groups && state.sheet.groups[0] && state.sheet.groups[0].items[0];
      if (first) toggleCrate(first);
    }
  }

  // ---------- crate ----------
  function toggleCrate(s) {
    const refocus = document.activeElement && document.activeElement.id === "q";
    const i = state.crate.findIndex(c => keyOf(c) === keyOf(s));
    if (i >= 0) state.crate.splice(i, 1);
    else {
      if (mine().length >= MAX) return toast("You've added all 5 this month");
      if (!slotsLeft()) return toast(`Crate's full. Remove one to swap`);
      if (songsFor(CURRENT).some(c => keyOf(c) === keyOf(s))) return toast("Already in the mix");
      state.crate.push({ title: s.title, artist: s.artist || "", artwork: s.artwork || null, preview: s.preview || null, links: s.links || {} });
    }
    saveCrate();
    if (state.sheet) { if (state.sheet.mode === "crate" && !state.crate.length) state.sheet.mode = "browse"; renderSheet() }
    if (refocus) { const q = $("#q"); q && q.focus({ preventScroll: true }) }
    renderMix();
  }
  async function submitCrate() {
    if (!state.crate.length || state.busy) return;
    const nameEl = $("#name");
    const typed = (nameEl ? nameEl.value : myName).trim().slice(0, 24);
    myName = typed; store.set("ideradio.name", typed);
    const songs = state.crate.map(s => ({ ...s, artwork: s.artwork ? safeUrl(s.artwork) : null, preview: s.preview ? safeUrl(s.preview) : null }));
    state.busy = true; renderSheet();
    try {
      const rows = await db.submit(typed || "anon", songs);
      for (const r of rows) state.songs.set(r.id, r);
      const hist = store.json("ideradio.hist", []); store.set("ideradio.hist", JSON.stringify([...songs.map(s => ({ artist: s.artist })), ...hist].slice(0, 60)));
      Object.keys(sugCache).forEach(k => delete sugCache[k]);
      const n = state.crate.length; state.crate = []; saveCrate();
      state.busy = false; closeSheet(); setView("mix");
      toast(n === 1 ? "You're in. 1 song added" : `You're in. ${n} songs added`);
    } catch (e) {
      state.busy = false;
      const m = String((e && e.message) || "");
      if (m === "dupe") { state.crate = state.crate.filter(s => s.title !== e.title); saveCrate(); toast(`"${e.title}" was just added by someone else. Removed it from your crate`) }
      else toast(m === "limit" ? `Only ${MAX - mine().length} slots left` : m === "closed" ? "This month is closed" : "Couldn't submit. Try again.");
      renderSheet();
    }
  }
  function renderDock() {
    const root = $("#dockRoot");
    if (!state.crate.length || state.sheet) return put(root);
    if (root.firstChild) { const t = root.querySelector(".crate-txt b"); if (t) { t.textContent = `${state.crate.length} in your crate`; return } }
    put(root, h("div", { class: "dock" },
      h("div", { class: "stack" }, state.crate.map(s => h("span", { style: s.artwork ? `background-image:url("${encodeURI(s.artwork)}")` : null }))),
      h("div", { class: "crate-txt" }, h("b", {}, `${state.crate.length} in your crate`), "Not sent yet"),
      h("button", { class: "btn hot", onclick: () => openSheet({ mode: "crate" }) }, "Review & submit")));
  }

  async function removeSong(s) {
    state.songs.delete(s.id); renderMix();
    try { await db.remove(s.id, s.month) } catch { state.songs.set(s.id, s); renderMix(); toast("Couldn't remove. Try again.") }
  }
  async function copyList() {
    const t = songsFor(state.month);
    if (!t.length) return toast("Nothing to copy yet");
    const text = t.map(s => (s.artist ? s.artist + " - " : "") + s.title).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste into", { href: "https://www.tunemymusic.com/", text: "TuneMyMusic ↗" }) }
    catch { toast("Couldn't copy") }
  }
  function setStatus(s) { if (s) $("#status").textContent = "ver. 1.2 · " + s }
  document.querySelectorAll(".itabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  // ---------- the iPod: now-playing strip + click wheel drive the song previews ----------
  const device = $("#onair"), playBtn = $("#playBtn");
  const clock = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0") };
  function setClock(cur, dur) { $("#prog").style.width = dur ? (cur / dur * 100) + "%" : "0"; $("#tNow").textContent = clock(cur); $("#tLeft").textContent = "-" + clock(dur - cur) }
  function showIpod() {
    const on = !!pvItem && !pv.paused;
    device.classList.toggle("playing", on);
    $(".ipod-state").textContent = on ? "▶" : "❚❚";
    $("#ipodTitle").textContent = pvItem ? "Now Playing" : "IDERADIO";
    $("#np").hidden = !pvItem;
    if (pvItem) {
      $("#npArt").style.backgroundImage = pvItem.artwork ? `url("${encodeURI(pvItem.artwork)}")` : "";
      $("#npT").textContent = pvItem.title; $("#npS").textContent = pvItem.artist || "";
    }
    playBtn.setAttribute("aria-pressed", String(on)); playBtn.setAttribute("aria-label", on ? "Pause" : "Play the mix");
  }
  const mixQueue = () => songsFor(state.month).filter(s => s.preview);
  function startMix(at = 0) {
    const q = mixQueue();
    if (!q.length) return toast("Nothing to play yet");
    const i = Math.max(0, Math.min(q.length - 1, at));
    playPreview(q[i], "s:" + q[i].id, q);
  }
  const playPause = () => { if (pvItem) { pv.paused ? pv.play().catch(() => {}) : pv.pause() } else startMix() };
  playBtn.addEventListener("click", playPause);
  $("#ppBtn").addEventListener("click", playPause);
  $("#prevBtn").addEventListener("click", () => { if (!stepQueue(-1)) startMix() });
  $("#nextBtn").addEventListener("click", () => { if (!stepQueue(1)) startMix() });
  $("#menuBtn").addEventListener("click", () => {
    if (state.sheet) return closeSheet();
    if (state.view === "archive" || state.month !== CURRENT) setView("mix"); else setView("archive");
  });
  addEventListener("keydown", e => {
    if (state.sheet || /input|textarea/i.test(document.activeElement.tagName)) return;
    if (e.key === " ") { e.preventDefault(); playPause() }
    else if (e.key === "ArrowRight") { if (!stepQueue(1)) startMix() }
    else if (e.key === "ArrowLeft") { if (!stepQueue(-1)) startMix() }
  });
  showIpod();

  // ---------- a few drifting bubbles ----------
  const cv = $("#fx"), ctx = cv.getContext("2d");
  let W, H, bubbles = [];
  function seedFx() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bubbles = Array.from({ length: W < 640 ? 4 : 7 }, () => newBubble(true));
  }
  function newBubble(anywhere) { const rad = 8 + Math.random() * 26; return { x: Math.random() * W, y: anywhere ? Math.random() * H : H + rad + 10, r: rad, v: .1 + Math.random() * .25, ph: Math.random() * 6.28 } }
  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      if (!reduce) { b.y -= b.v; b.x += Math.sin(t / 1800 + b.ph) * .2 }
      if (b.y < -b.r - 10) Object.assign(b, newBubble(false));
      const g = ctx.createRadialGradient(b.x - b.r * .35, b.y - b.r * .4, b.r * .05, b.x, b.y, b.r);
      g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(.35, "rgba(255,255,255,.15)"); g.addColorStop(.85, "rgba(140,210,240,.18)"); g.addColorStop(1, "rgba(255,255,255,.75)");
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.stroke();
    }
    if (!reduce && !document.hidden) requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !reduce) requestAnimationFrame(frame) });
  seedFx(); requestAnimationFrame(frame);
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { seedFx(); if (reduce) frame(0) }, 150) });

  // ---------- boot ----------
  (() => {
    const fill = $("#introFill"), pct = $("#introPct"), dur = reduce ? 1 : 900, t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      fill.style.width = (e * 100) + "%"; pct.textContent = Math.round(e * 100) + "%";
      if (k < 1) requestAnimationFrame(step);
      else { setTimeout(() => $("#intro").classList.add("out"), 120); setTimeout(() => $("#intro").remove(), 900) }
    };
    requestAnimationFrame(step);
  })();
  setView("mix");
  setInterval(() => { if (state.view === "mix") renderMix() }, 60000);

  function applyRows(rows) {
    state.songs = new Map(rows.map(r => [r.id, r]));
    state.loaded = true;
    if (state.view === "archive") renderArchive(); else renderMix();
    if (state.sheet && state.sheet.mode === "browse") paintSheetBody();
  }
  async function load() {
    try { applyRows(await db.list()) }
    catch { setStatus("offline, retrying"); setTimeout(load, 4000); return }
    resolveSpotify();
  }
  (async () => {
    myHash = await sha256(token);
    try {
      const r = await fetch("/api/songs", { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) { db = apiStore(); setStatus("live") } else setStatus("demo mode");
    } catch { setStatus("demo mode") }
    try {
      const intent = await SP.callback();
      if (intent) { toast("Spotify connected"); state.service = "spotify"; store.set("ideradio.svc", "spotify") }
      await load();
      if (intent && intent.action === "save") saveToSpotify(intent.month || CURRENT);
    } catch { await load() }
    db.subscribe(applyRows);
  })();
})();
