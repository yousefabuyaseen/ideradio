# IDERADIO

Class playlist site on Netlify. Static files are in `site/`. The shared playlist API is `netlify/functions/songs.mjs`, which stores data in Netlify Blobs, so no separate database is needed.

## Update the live site
From this folder: `npx netlify-cli deploy --prod` (needs Node 22.12+).

## Spotify button (optional)
1. Create an app at https://developer.spotify.com/dashboard. Choose **Web API**.
2. Add your site's address as a **Redirect URI** with a trailing slash, e.g. `https://ideradio.netlify.app/`.
3. Paste the **Client ID** into `site/config.js`, then deploy again.
4. New Spotify apps run in development mode, so only accounts listed under **User Management** can connect.

## Moderation
Netlify → your site → **Blobs** → store `ideradio`. There is one entry per month, in the form `YYYY-MM`.

## Audio
`site/audio/ambient.mp3` is retuned to A=432 Hz and slowed to about 79% speed.
