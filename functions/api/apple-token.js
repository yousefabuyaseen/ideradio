// Apple Music developer token (ES256 JWT). Needs an Apple Developer MusicKit key:
// APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8 file contents) as Cloudflare secrets.
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));

export async function onRequestGet({ env }) {
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) return json({ enabled: false });
  const pem = env.APPLE_PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "ES256", kid: env.APPLE_KEY_ID }), body = enc({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 60 * 60 * 12 });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + body));
  return json({ enabled: true, token: head + "." + body + "." + b64url(sig) });
}
