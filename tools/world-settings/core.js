const LABELS = {
  data_driven_items: "Holiday Creator Features",
  data_driven_biomes: "Custom biomes",
  experimental_molang_features: "Upcoming Molang features",
  upcoming_creator_features: "Upcoming Creator Features",
  gametest: "Beta APIs (scripting)",
  villager_trades_rebalance: "Villager trade rebalancing",
  cameras: "Creator cameras",
  experimental_creator_cameras: "Creator cameras",
  jigsaw_structures: "Jigsaw structures",
  short_sneaking: "Short sneaking",
  recipe_unlocking: "Recipe unlocking",
  deferred_technical_preview: "Technical preview features",
  render_dragon_features: "Graphics features (Render Dragon)",
  experiments_ever_used: null,
  saved_with_toggled_experiments: null
};

const META = ["experiments_ever_used", "saved_with_toggled_experiments"];

const MAX_UNPACK = 64 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (~c) >>> 0;
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function prettify(tag) {
  const s = tag.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const T_END = 0, T_BYTE = 1, T_SHORT = 2, T_INT = 3, T_LONG = 4, T_FLOAT = 5, T_DOUBLE = 6,
      T_BYTES = 7, T_STR = 8, T_LIST = 9, T_COMP = 10, T_INTS = 11, T_LONGS = 12;
const DEC = new TextDecoder(), ENC = new TextEncoder();
const CATALOG = ["data_driven_items", "data_driven_biomes", "experimental_molang_features",
  "upcoming_creator_features", "gametest", "villager_trades_rebalance",
  "experimental_creator_cameras", "jigsaw_structures", "recipe_unlocking",
  "deferred_technical_preview"];

class NbtReader {
  constructor(bytes) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; }
  u8() { return this.b[this.p++]; }
  i8() { const v = this.dv.getInt8(this.p); this.p += 1; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  i64() { const v = this.dv.getBigInt64(this.p, true); this.p += 8; return v; }
  f32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  str() { const n = this.u16(); const s = DEC.decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s; }
}

function readPayload(r, type) {
  switch (type) {
    case T_BYTE: return r.i8();
    case T_SHORT: return r.i16();
    case T_INT: return r.i32();
    case T_LONG: return r.i64();
    case T_FLOAT: return r.f32();
    case T_DOUBLE: return r.f64();
    case T_BYTES: { const n = r.i32(); const a = r.b.slice(r.p, r.p + n); r.p += n; return a; }
    case T_STR: return r.str();
    case T_LIST: { const et = r.u8(); const n = r.i32(); const items = []; for (let i = 0; i < n; i++) items.push(readPayload(r, et)); return { elemType: et, items: items }; }
    case T_COMP: { const m = new Map(); for (;;) { const t = r.u8(); if (t === T_END || t === undefined) break; const nm = r.str(); m.set(nm, { type: t, value: readPayload(r, t) }); } return m; }
    case T_INTS: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return a; }
    case T_LONGS: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i64()); return a; }
    default: throw new Error("nbt");
  }
}

class NbtWriter {
  constructor() { this.b = new Uint8Array(8192); this.p = 0; }
  need(n) { if (this.p + n <= this.b.length) return; let len = this.b.length; while (len < this.p + n) len *= 2; const nb = new Uint8Array(len); nb.set(this.b.subarray(0, this.p)); this.b = nb; }
  view() { return new DataView(this.b.buffer); }
  u8(v) { this.need(1); this.b[this.p++] = v & 255; }
  i8(v) { this.need(1); this.view().setInt8(this.p, v); this.p += 1; }
  i16(v) { this.need(2); this.view().setInt16(this.p, v, true); this.p += 2; }
  u16(v) { this.need(2); this.view().setUint16(this.p, v, true); this.p += 2; }
  i32(v) { this.need(4); this.view().setInt32(this.p, v, true); this.p += 4; }
  i64(v) { this.need(8); this.view().setBigInt64(this.p, typeof v === "bigint" ? v : BigInt(v), true); this.p += 8; }
  f32(v) { this.need(4); this.view().setFloat32(this.p, v, true); this.p += 4; }
  f64(v) { this.need(8); this.view().setFloat64(this.p, v, true); this.p += 8; }
  str(s) { const by = ENC.encode(s); this.u16(by.length); this.need(by.length); this.b.set(by, this.p); this.p += by.length; }
  raw(a) { this.need(a.length); this.b.set(a, this.p); this.p += a.length; }
  out() { return this.b.slice(0, this.p); }
}

function writePayload(w, type, value) {
  switch (type) {
    case T_BYTE: w.i8(value); break;
    case T_SHORT: w.i16(value); break;
    case T_INT: w.i32(value); break;
    case T_LONG: w.i64(value); break;
    case T_FLOAT: w.f32(value); break;
    case T_DOUBLE: w.f64(value); break;
    case T_BYTES: w.i32(value.length); w.raw(value); break;
    case T_STR: w.str(value); break;
    case T_LIST: w.u8(value.elemType); w.i32(value.items.length); value.items.forEach(it => writePayload(w, value.elemType, it)); break;
    case T_COMP: value.forEach((entry, name) => { w.u8(entry.type); w.str(name); writePayload(w, entry.type, entry.value); }); w.u8(T_END); break;
    case T_INTS: w.i32(value.length); value.forEach(v => w.i32(v)); break;
    case T_LONGS: w.i32(value.length); value.forEach(v => w.i64(v)); break;
    default: throw new Error("nbt");
  }
}

function parseLevelDat(bytes) {
  if (bytes.length < 12) throw new Error("nbt");
  const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = head.getInt32(0, true);
  const declared = head.getInt32(4, true);
  const len = declared > 0 && declared <= bytes.length - 8 ? declared : bytes.length - 8;
  const r = new NbtReader(bytes.subarray(8, 8 + len));
  if (r.u8() !== T_COMP) throw new Error("nbt");
  const rootName = r.str();
  return { version: version, rootName: rootName, root: { type: T_COMP, value: readPayload(r, T_COMP) } };
}

function buildLevelDat(doc) {
  const w = new NbtWriter();
  w.u8(T_COMP); w.str(doc.rootName); writePayload(w, T_COMP, doc.root.value);
  const payload = w.out();
  const out = new Uint8Array(8 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, doc.version, true);
  dv.setInt32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function experimentsOf(root) {
  const e = root.value.get("experiments");
  return e && e.type === T_COMP ? e.value : null;
}

function applySelection(root, rows) {
  const map = root.value;
  const prev = experimentsOf(root);
  const em = prev || new Map();
  rows.forEach(r => { if (r.on) em.set(r.tag, { type: T_BYTE, value: 1 }); else em.delete(r.tag); });
  if (rows.some(r => r.on)) {
    em.set("experiments_ever_used", { type: T_BYTE, value: 1 });
    em.set("saved_with_toggled_experiments", { type: T_BYTE, value: 1 });
  } else {
    em.delete("experiments_ever_used");
    em.delete("saved_with_toggled_experiments");
  }
  if (em.size === 0) map.delete("experiments");
  else map.set("experiments", { type: T_COMP, value: em });
}

function verifyRoundTrip(bytes, rows) {
  const doc = parseLevelDat(bytes);
  const em = experimentsOf(doc.root);
  const anyOn = rows.some(r => r.on);
  if (!anyOn) return em === null;
  if (!em) return false;
  for (const r of rows) {
    const e = em.get(r.tag);
    if (r.on) { if (!e || e.type !== T_BYTE || e.value !== 1) return false; }
    else if (e) return false;
  }
  const a = em.get("experiments_ever_used"), b = em.get("saved_with_toggled_experiments");
  return !!a && a.value === 1 && !!b && b.value === 1;
}


function readZip(buf){
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not-zip");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("not-zip");
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lnLen = dv.getUint16(local + 26, true);
      const leLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnLen + leLen;
      entries.push({ name, method, crc, csize, usize, data: u8.subarray(start, start + csize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

function buildZip(entries){
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const nb = enc.encode(e.name);
      const lh = new Uint8Array(30 + nb.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, e.method, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x2100, true);
      lv.setUint32(14, e.crc, true); lv.setUint32(18, e.csize, true); lv.setUint32(22, e.usize, true);
      lv.setUint16(26, nb.length, true); lv.setUint16(28, 0, true);
      lh.set(nb, 30);
      parts.push(lh, e.data);
      const ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, e.method, true); cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x2100, true); cv.setUint32(16, e.crc, true); cv.setUint32(20, e.csize, true);
      cv.setUint32(24, e.usize, true); cv.setUint16(28, nb.length, true);
      cv.setUint32(42, offset, true); ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + e.data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/octet-stream" });
  }

