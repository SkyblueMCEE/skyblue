#!/usr/bin/env node
/**
 * Regenerates the video card list in videos/index.html from the YouTube Data API,
 * and refreshes the local thumbnail fallbacks in assets/thumbs/.
 *
 * Needs env YT_API_KEY. Node 20+ (uses global fetch).
 *
 * Quota cost per run: ~1 + ceil(videos/50) + ceil(videos/50) units.
 * With a 10,000/day quota this is negligible even hourly.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL_ID = 'UCWKqaC0pPlyLXo5qYwXrGjA';
const TOP_N      = 9;
const PAGE       = join(ROOT, 'videos', 'index.html');
const THUMB_DIR  = join(ROOT, 'assets', 'thumbs');
const KEY        = process.env.YT_API_KEY;

if (!KEY) {
  console.error('YT_API_KEY is not set.');
  process.exit(1);
}

async function api(path, params) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M views';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K views';
  return n + ' views';
}

/* ---------- 1. every uploaded video id ---------- */
const ch = await api('channels', { part: 'contentDetails', id: CHANNEL_ID });
const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
if (!uploads) throw new Error('could not resolve uploads playlist for ' + CHANNEL_ID);

const ids = [];
let pageToken;
do {
  const page = await api('playlistItems', {
    part: 'contentDetails', playlistId: uploads, maxResults: 50,
    ...(pageToken ? { pageToken } : {})
  });
  page.items.forEach((i) => ids.push(i.contentDetails.videoId));
  pageToken = page.nextPageToken;
} while (pageToken);
console.log(`found ${ids.length} uploads`);

/* ---------- 2. titles + view counts ---------- */
const videos = [];
for (const group of chunk(ids, 50)) {
  const r = await api('videos', { part: 'snippet,statistics,status', id: group.join(',') });
  r.items.forEach((v) => {
    if (v.status?.privacyStatus !== 'public') return;
    videos.push({
      id: v.id,
      title: v.snippet.title,
      views: Number(v.statistics?.viewCount || 0)
    });
  });
}

const top = videos.sort((a, b) => b.views - a.views).slice(0, TOP_N);
console.log('\ntop by views:');
top.forEach((v, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${v.views.toLocaleString().padStart(9)}  ${v.title}`));

/* ---------- 3. refresh local thumbnail fallbacks ---------- */
await mkdir(THUMB_DIR, { recursive: true });
for (const v of top) {
  for (const q of ['maxresdefault', 'hqdefault']) {
    const res = await fetch(`https://img.youtube.com/vi/${v.id}/${q}.jpg`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5000) {
        await writeFile(join(THUMB_DIR, `${v.id}.jpg`), buf);
        console.log(`  thumb ${v.id} (${q}, ${buf.length} bytes)`);
        break;
      }
    }
  }
}

/* ---------- 4. rewrite the card list ---------- */
const cards = top.map((v) => `          <li class="sky-vid">
            <a href="https://www.youtube.com/watch?v=${v.id}" rel="noopener">
              <img src="https://img.youtube.com/vi/${v.id}/maxresdefault.jpg"
                   data-fallback-1="https://img.youtube.com/vi/${v.id}/hqdefault.jpg"
                   data-fallback-2="../assets/thumbs/${v.id}.jpg"
                   alt="" width="480" height="270" loading="lazy">
              <span class="sky-vid-body">
                <p class="sky-vid-title">${esc(v.title)}</p>
                <p class="sky-vid-meta">${formatViews(v.views)}</p>
              </span>
            </a>
          </li>`).join('\n');

let html = await readFile(PAGE, 'utf8');
const START = '<!-- VIDEOS:START -->';
const END   = '<!-- VIDEOS:END -->';
if (!html.includes(START) || !html.includes(END)) {
  throw new Error(`markers ${START} / ${END} not found in videos/index.html`);
}
const before = html.slice(0, html.indexOf(START) + START.length);
const after  = html.slice(html.indexOf(END));
const next   = `${before}\n${cards}\n          ${after}`;

if (next === html) {
  console.log('\nno change');
} else {
  await writeFile(PAGE, next);
  console.log('\nvideos/index.html updated');
}
