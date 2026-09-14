/**
 * Where the atlas reads its data from.
 *
 * "data" keeps everything local to this site, which is how the public build
 * works. Point it at the Cloudflare Worker to serve the data out of the private
 * repository behind a Microsoft Entra sign-in instead:
 *
 *   window.ATLAS_DATA_BASE = "https://usda515-data.your-subdomain.workers.dev";
 *
 * No trailing slash. The Worker exposes the files under /data/, which the app
 * adds for you.
 */
window.ATLAS_DATA_BASE = "data";
