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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickThumbnail(thumbnails, order, exclude = '') {
  for (const name of order) {
    const url = thumbnails?.[name]?.url;
    if (url && url !== exclude) return url;
  }
  return '';
}

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
    const thumbnails = v.snippet.thumbnails || {};
    const thumbnailUrl = pickThumbnail(thumbnails, ['maxres', 'standard', 'high', 'medium', 'default']);
    const fallbackThumbnailUrl = pickThumbnail(
      thumbnails,
      ['high', 'medium', 'default', 'standard', 'maxres'],
      thumbnailUrl
    );
    videos.push({
      id: v.id,
      title: v.snippet.title,
      views: Number(v.statistics?.viewCount || 0),
      seconds: isoToSeconds(v.contentDetails?.duration || ''),
      thumbnailUrl,
      fallbackThumbnailUrl
    });
  });
}

/* ---------- 2b. split shorts from long-form ----------
   The API exposes no "is this a Short" flag. Duration alone is unreliable
   (plenty of normal tutorials run under 3 minutes), so we use duration only
   to narrow the candidates, then confirm each one by asking YouTube whether
   /shorts/<id> resolves. A Short returns 200; a regular video redirects to
   /watch?v=<id>. Unexpected responses are retried and then fail the build so
   a temporary YouTube/network problem cannot move a Short into Videos. */
const candidates = videos.filter((v) => v.seconds > 0 && v.seconds <= 185);
console.log(`\nchecking ${candidates.length} short-duration candidates...`);

async function isShort(v) {
  const url = 'https://www.youtube.com/shorts/' + v.id;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; SkyBlueVideoUpdater/1.0)'
        }
      });

      if (r.status === 200) return true;

      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get('location');
        if (location) {
          const target = new URL(location, 'https://www.youtube.com');
          if (target.pathname === '/watch' && target.searchParams.get('v') === v.id) {
            return false;
          }
        }
      }

      lastError = new Error(`unexpected ${r.status}${r.headers.get('location') ? ` -> ${r.headers.get('location')}` : ''}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 3) await sleep(500 * (2 ** (attempt - 1)));
  }

  throw new Error(
    `could not classify ${v.id} (${v.title}) after 3 attempts: ${lastError?.message || lastError}`
  );
}

const shortIds = new Set();
for (const group of chunk(candidates, 8)) {
  const results = await Promise.all(group.map(async (v) => ({ v, short: await isShort(v) })));
  results.forEach(({ v, short }) => {
    if (short) shortIds.add(v.id);
  });
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
  const thumbnailCandidates = [...new Set([
    v.thumbnailUrl,
    v.fallbackThumbnailUrl,
    `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`
  ].filter(Boolean))];

  for (const url of thumbnailCandidates) {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5000) {
        await writeFile(join(THUMB_DIR, `${v.id}.jpg`), buf);
        console.log(`  thumb ${v.id} (${buf.length} bytes)`);
        break;
      }
    }
  }
}

/* ---------- 4. rewrite both card lists ---------- */
const card = (v, isShort) => `          <li class="sky-vid">
            <a href="https://www.youtube.com/${isShort ? 'shorts/' : 'watch?v='}${v.id}" rel="noopener">
              <img src="${esc(v.thumbnailUrl || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`)}"
                   data-fallback-1="${esc(v.fallbackThumbnailUrl || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`)}"
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
