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
const TOP_N      = 9;   // long-form cards
const TOP_SHORTS = 10;  // shorts cards
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

/* PT1M32S -> 92 */
function isoToSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/* strip the hashtag tail Shorts titles usually carry */
function cleanTitle(t) {
  return String(t).replace(/(\s*#[^\s#]+)+\s*$/, '').replace(/\s*\.\.\.\s*$/, '').trim() || t;
}

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
  const r = await api('videos', { part: 'snippet,statistics,status,contentDetails', id: group.join(',') });
  r.items.forEach((v) => {
    if (v.status?.privacyStatus !== 'public') return;
    videos.push({
      id: v.id,
      title: v.snippet.title,
      views: Number(v.statistics?.viewCount || 0),
      seconds: isoToSeconds(v.contentDetails?.duration || '')
    });
  });
}

/* ---------- 2b. split shorts from long-form ----------
   The API exposes no "is this a Short" flag. Duration alone is unreliable
   (plenty of normal tutorials run under 3 minutes), so we use duration only
   to narrow the candidates, then confirm each one by asking YouTube whether
   /shorts/<id> resolves. A Short returns 200; anything else redirects. */
const candidates = videos.filter((v) => v.seconds > 0 && v.seconds <= 185);
console.log(`\nchecking ${candidates.length} short-duration candidates...`);

const shortIds = new Set();
for (const group of chunk(candidates, 8)) {
  await Promise.all(group.map(async (v) => {
    try {
      const r = await fetch('https://www.youtube.com/shorts/' + v.id, { redirect: 'manual' });
      if (r.status === 200) shortIds.add(v.id);
    } catch { /* network hiccup: treat as long-form */ }
  }));
}
console.log(`  ${shortIds.size} confirmed shorts`);

const longForm = videos.filter((v) => !shortIds.has(v.id));
const shorts   = videos.filter((v) =>  shortIds.has(v.id));

const top       = longForm.sort((a, b) => b.views - a.views).slice(0, TOP_N);
const topShorts = shorts.sort((a, b) => b.views - a.views).slice(0, TOP_SHORTS);
console.log('\ntop videos by views:');
top.forEach((v, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${v.views.toLocaleString().padStart(9)}  ${v.title}`));
console.log('\ntop shorts by views:');
topShorts.forEach((v, i) =>
  console.log(`  ${String(i + 1).padStart(2)}. ${v.views.toLocaleString().padStart(9)}  ${v.title}`));

/* ---------- 3. refresh local thumbnail fallbacks ---------- */
await mkdir(THUMB_DIR, { recursive: true });
for (const v of [...top, ...topShorts]) {
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

/* ---------- 4. rewrite both card lists ---------- */
const card = (v, isShort) => `          <li class="sky-vid">
            <a href="https://www.youtube.com/${isShort ? 'shorts/' : 'watch?v='}${v.id}" rel="noopener">
              <img src="https://img.youtube.com/vi/${v.id}/${isShort ? 'oar2' : 'maxresdefault'}.jpg"
                   data-fallback-1="https://img.youtube.com/vi/${v.id}/hqdefault.jpg"
                   data-fallback-2="../assets/thumbs/${v.id}.jpg"
                   alt="" width="${isShort ? 270 : 480}" height="${isShort ? 480 : 270}" loading="lazy">
              <span class="sky-vid-body">
                <p class="sky-vid-title">${esc(cleanTitle(v.title))}</p>
                <p class="sky-vid-meta">${formatViews(v.views)}</p>
              </span>
            </a>
          </li>`;

const cards       = top.map((v) => card(v, false)).join('\n');
const shortsCards = topShorts.map((v) => card(v, true)).join('\n');

let html = await readFile(PAGE, 'utf8');
const original = html;

function replaceBlock(src, name, body) {
  const START = `<!-- ${name}:START -->`;
  const END   = `<!-- ${name}:END -->`;
  if (!src.includes(START) || !src.includes(END)) {
    throw new Error(`markers ${START} / ${END} not found in videos/index.html`);
  }
  return src.slice(0, src.indexOf(START) + START.length)
       + `\n${body}\n          `
       + src.slice(src.indexOf(END));
}

html = replaceBlock(html, 'VIDEOS', cards);
html = replaceBlock(html, 'SHORTS', shortsCards);
const next = html;

if (next === original) {
  console.log('\nno change');
} else {
  await writeFile(PAGE, next);
  console.log('\nvideos/index.html updated');
}
