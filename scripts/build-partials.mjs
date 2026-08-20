#!/usr/bin/env node
/**
 * Pastes partials/header.html and partials/footer.html into every page that
 * carries the matching marker comments, then writes the result back.
 *
 * Edit the partial, run this, and all pages update:
 *
 *     node scripts/build-partials.mjs
 *     node scripts/build-partials.mjs --check   # exit 1 if anything is stale
 *
 * In a page, the markers look like this — everything between them is
 * generated, so don't hand-edit it:
 *
 *     <!-- HEADER:START -->
 *     ...generated...
 *     <!-- HEADER:END -->
 *
 * {{root}} inside a partial becomes the relative path back to the repo root
 * for whichever page it lands in: "./" at the top, "../" one level down,
 * "../../" two levels down. That is what keeps the logo link and image src
 * correct on every page without maintaining them by hand.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK  = process.argv.includes('--check');
const SKIP   = new Set(['.git', 'node_modules', 'partials', 'assets', 'scripts']);
const BLOCKS = ['HEADER', 'FOOTER'];

/* every .html file in the repo, minus the directories above */
async function pages(dir = ROOT, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) await pages(join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/* "videos/index.html" -> "../"   ;   "index.html" -> "./" */
function rootPath(file) {
  const depth = relative(ROOT, dirname(file)).split(sep).filter(Boolean).length;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/* re-indent a partial so it lines up with the marker it replaces */
const indent = (text, pad) =>
  text.trimEnd().split('\n').map((l) => (l ? pad + l : l)).join('\n');

function replaceBlock(src, name, body) {
  const START = `<!-- ${name}:START -->`;
  const END   = `<!-- ${name}:END -->`;
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a === -1 || b === -1) return null;          // page opts out
  if (b < a) throw new Error(`${END} comes before ${START}`);

  const lineStart = src.lastIndexOf('\n', a) + 1;
  const pad = src.slice(lineStart, a);            // whitespace before the marker
  return src.slice(0, a + START.length)
       + '\n' + indent(body, pad) + '\n' + pad
       + src.slice(b);
}

const partial = Object.fromEntries(
  await Promise.all(
    BLOCKS.map(async (n) => [n, await readFile(join(ROOT, 'partials', `${n.toLowerCase()}.html`), 'utf8')])
  )
);

let stale = 0;
for (const file of (await pages()).sort()) {
  const before = await readFile(file, 'utf8');
  let after = before;
  const applied = [];

  for (const name of BLOCKS) {
    const body = partial[name].replaceAll('{{root}}', rootPath(file));
    const next = replaceBlock(after, name, body);
    if (next !== null) { after = next; applied.push(name.toLowerCase()); }
  }

  const label = relative(ROOT, file).replaceAll(sep, '/').padEnd(30);
  if (!applied.length)      console.log(`${label} no markers, skipped`);
  else if (after === before) console.log(`${label} ${applied.join(' + ')} already current`);
  else {
    stale++;
    if (!CHECK) await writeFile(file, after);
    console.log(`${label} ${applied.join(' + ')} ${CHECK ? 'STALE' : 'updated'}`);
  }
}

if (CHECK && stale) {
  console.error(`\n${stale} file(s) out of date — run: node scripts/build-partials.mjs`);
  process.exit(1);
}
console.log(stale ? `\n${stale} file(s) ${CHECK ? 'stale' : 'written'}` : '\neverything already current');
