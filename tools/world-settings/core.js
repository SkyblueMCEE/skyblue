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

// Minecraft's toggle screen changes between releases. Keep this list separate
// from LABELS: LABELS names anything we may discover in an existing world,
// while this catalog contains the known tags the editor may offer to add.
const AVAILABLE_EXPERIMENTS = [
  { tag: "data_driven_items", label: "Holiday Creator Features", description: "Legacy data-driven item features used by some older creator worlds." },
  { tag: "data_driven_biomes", label: "Custom Biomes", description: "Custom biome definitions supplied by behavior packs." },
  { tag: "experimental_molang_features", label: "Upcoming Molang Features", description: "Molang queries and behavior that are still experimental." },
  { tag: "upcoming_creator_features", label: "Upcoming Creator Features", description: "Creator components and formats that have not reached stable yet." },
  { tag: "gametest", label: "Beta APIs (scripting)", description: "Beta Script API modules and related creator features." },
  { tag: "villager_trades_rebalance", label: "Villager Trade Rebalancing", description: "Mojang's experimental villager trade changes." },
  { tag: "experimental_creator_cameras", label: "Experimental Creator Cameras", description: "Experimental camera controls used by creator content." },
  { tag: "jigsaw_structures", label: "Data-Driven Jigsaw Structures", description: "Data-driven structure pools and jigsaw generation." },
  { tag: "short_sneaking", label: "Short Sneaking", description: "The older experimental short-sneaking behavior." },
  { tag: "recipe_unlocking", label: "Recipe Unlocking", description: "The older experiment for unlocking recipes through gameplay." },
  { tag: "deferred_technical_preview", label: "Technical Preview Features", description: "Preview-only rendering and technical features." },
  { tag: "render_dragon_features", label: "Render Dragon Features for Creators", description: "Experimental Render Dragon graphics features for creator content." }
];

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

const WORLD_SETTING_GROUPS = [
  {
    id: "world-setup",
    title: "World setup",
    description: "The world's default mode, difficulty, seed, and startup rules.",
    settings: [
      { key: "GameType", label: "Default game mode", description: "The mode new players use when they first join.", kind: "select", nbtType: T_INT, defaultValue: 0,
        options: [{ value: 0, label: "Survival" }, { value: 1, label: "Creative" }, { value: 2, label: "Adventure" }] },
      { key: "Difficulty", label: "Difficulty", description: "Controls hostile mobs, damage, and hunger.", kind: "select", nbtType: T_INT, defaultValue: 2,
        options: [{ value: 0, label: "Peaceful" }, { value: 1, label: "Easy" }, { value: 2, label: "Normal" }, { value: 3, label: "Hard" }] },
      { key: "hardcore", label: "Hardcore", description: "Locks the world to Survival on Hard difficulty with cheats off.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "RandomSeed", label: "World seed", description: "Read directly from level.dat as a signed 64-bit number. Changing it only affects chunks generated later.", kind: "long", nbtType: T_LONG, defaultValue: "0", min: "-9223372036854775808", max: "9223372036854775807" },
      { key: "ForceGameType", label: "Force default game mode", description: "Forces joining players back into the world's default mode.", kind: "boolean", nbtType: T_BYTE, defaultValue: false }
    ]
  },
  {
    id: "player-access",
    title: "Player access",
    description: "Choose what new players can do and whether commands are available.",
    settings: [
      { key: "defaultPlayerPermissionLevel", label: "Default player permission", description: "Visitor is view-only; Members can play normally; Operators can use commands.", kind: "select", nbtType: T_INT, defaultValue: 1,
        options: [{ value: 0, label: "Visitor" }, { value: 1, label: "Member" }, { value: 2, label: "Operator" }, { value: 3, label: "Custom" }] },
      { key: "commandsEnabled", label: "Cheats", description: "Allows commands and disables achievements for the world.", kind: "boolean", nbtType: T_BYTE, defaultValue: false }
    ]
  },
  {
    id: "world-options",
    title: "World options",
    description: "Common gameplay choices that are useful to reach quickly.",
    settings: [
      { key: "showcoordinates", label: "Show coordinates", description: "Displays the player's position on screen.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "naturalregeneration", label: "Natural regeneration", description: "Lets players regain health naturally when their hunger is high enough.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "pvp", label: "Friendly fire", description: "Lets players damage one another.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "keepinventory", label: "Keep inventory", description: "Players keep their items and experience after dying.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "domobspawning", label: "Mob spawning", description: "Allows mobs to spawn naturally.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "mobgriefing", label: "Mob griefing", description: "Allows mobs such as creepers and endermen to change blocks.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "bonusChestEnabled", label: "Bonus chest", description: "Enables a starter chest near the world spawn.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "startWithMapEnabled", label: "Starting map", description: "Gives new players a map when they join.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "educationFeaturesEnabled", label: "Education features", description: "Enables Minecraft Education world features when supported by the game.", kind: "boolean", nbtType: T_BYTE, defaultValue: false }
    ]
  },
  {
    id: "gamerules",
    title: "Gamerules",
    description: "Detailed rules for time, weather, drops, commands, and respawning.",
    settings: [
      { key: "dodaylightcycle", label: "Daylight cycle", description: "Allows time to move from day to night.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "doweathercycle", label: "Weather cycle", description: "Allows the weather to change naturally.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "dofiretick", label: "Fire spreads", description: "Allows fire to spread and burn out.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "tntexplodes", label: "TNT explodes", description: "Allows TNT blocks to ignite and explode.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "domobloot", label: "Mob loot", description: "Mobs drop items when killed.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "dotiledrops", label: "Block drops", description: "Blocks drop items when broken.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "doimmediaterespawn", label: "Immediate respawn", description: "Skips the death screen and respawns players immediately.", kind: "boolean", nbtType: T_BYTE, defaultValue: false },
      { key: "doinsomnia", label: "Insomnia", description: "Allows phantoms to spawn when players have not slept.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "showdeathmessages", label: "Death messages", description: "Shows a chat message when a player dies.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "commandblocksenabled", label: "Command blocks", description: "Allows command blocks to run.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "commandblockoutput", label: "Command block output", description: "Shows command block output in chat.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "sendcommandfeedback", label: "Command feedback", description: "Shows command results to the player who ran them.", kind: "boolean", nbtType: T_BYTE, defaultValue: true },
      { key: "randomtickspeed", label: "Random tick speed", description: "Controls random block updates; Bedrock's default is 1.", kind: "integer", nbtType: T_INT, defaultValue: "1", min: 0, max: 4096 },
      { key: "spawnradius", label: "Respawn radius", description: "Maximum distance from world spawn used for player respawning.", kind: "integer", nbtType: T_INT, defaultValue: "5", min: 0, max: 128 },
      { key: "playerssleepingpercentage", label: "Players needed to sleep", description: "Percentage of online players needed to skip the night.", suffix: "%", kind: "integer", nbtType: T_INT, defaultValue: "100", min: 0, max: 100 }
    ]
  }
];

const PACK_REQUIREMENT_SETTING = {
  key: "texturePacksRequired",
  label: "Require resource packs",
  description: "Players must accept the world's resource packs before joining.",
  kind: "boolean",
  nbtType: T_BYTE,
  defaultValue: false,
  groupId: "packs"
};

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

function worldSettingDefinitions() {
  const defs = [];
  WORLD_SETTING_GROUPS.forEach(group => {
    group.settings.forEach(setting => defs.push(Object.assign({ groupId: group.id }, setting)));
  });
  defs.push(PACK_REQUIREMENT_SETTING);
  return defs;
}

function normalizedSettingValue(setting, value) {
  if (setting.kind === "boolean") return Number(value) !== 0;
  if (setting.kind === "select") return Number(value);
  return String(value);
}

function readWorldSettings(root) {
  const map = root.value;
  return worldSettingDefinitions().map(setting => {
    const entry = map.get(setting.key);
    const value = normalizedSettingValue(setting, entry ? entry.value : setting.defaultValue);
    return Object.assign({}, setting, {
      value: value,
      original: value,
      existed: !!entry,
      sourceType: entry ? entry.type : null
    });
  });
}

function settingChanged(setting) {
  return setting.value !== setting.original;
}

function validateSetting(setting) {
  if (setting.kind === "boolean") return null;

  if (setting.kind === "select") {
    if (!Number.isInteger(setting.value)) return setting.label + " has an invalid selection.";
    if (settingChanged(setting) && !setting.options.some(option => option.value === setting.value)) {
      return setting.label + " has an unsupported value.";
    }
    return null;
  }

  const text = String(setting.value).trim();
  if (!/^-?\d+$/.test(text)) return setting.label + " must be a whole number.";

  if (setting.kind === "long") {
    const value = BigInt(text);
    if (value < BigInt(setting.min) || value > BigInt(setting.max)) {
      return setting.label + " is outside Minecraft's supported range.";
    }
    return null;
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < setting.min || value > setting.max) {
    return setting.label + " must be from " + setting.min + " to " + setting.max + ".";
  }
  return null;
}

function validateWorldSettings(settings) {
  for (const setting of settings) {
    const message = validateSetting(setting);
    if (message) return { valid: false, key: setting.key, message: message };
  }
  return { valid: true };
}

function encodedSettingValue(setting) {
  if (setting.kind === "boolean") return setting.value ? 1 : 0;
  if (setting.kind === "long") return BigInt(String(setting.value).trim());
  return Number(setting.value);
}

function applyWorldSettings(root, settings) {
  const map = root.value;
  settings.forEach(setting => {
    if (!settingChanged(setting)) return;
    map.set(setting.key, { type: setting.nbtType, value: encodedSettingValue(setting) });
  });
}

function applySelection(root, rows) {
  const changed = rows.some(r => r.on !== r.original);
  if (!changed) return;

  const map = root.value;
  const prev = experimentsOf(root);
  const em = prev || new Map();
  rows.forEach(r => {
    if (r.on === r.original) return;
    if (r.on) em.set(r.tag, { type: T_BYTE, value: 1 });
    else em.delete(r.tag);
  });
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

function verifyRoundTrip(bytes, rows, settings) {
  const doc = parseLevelDat(bytes);
  const em = experimentsOf(doc.root);
  const experimentsChanged = rows.some(r => r.on !== r.original);
  const anyOn = rows.some(r => r.on);
  if (experimentsChanged) {
    for (const r of rows) {
      if (r.on === r.original) continue;
      const e = em && em.get(r.tag);
      if (r.on) { if (!e || e.type !== T_BYTE || e.value !== 1) return false; }
      else if (e) return false;
    }
    if (anyOn) {
      if (!em) return false;
      const a = em.get("experiments_ever_used"), b = em.get("saved_with_toggled_experiments");
      if (!a || a.value !== 1 || !b || b.value !== 1) return false;
    } else if (em && (em.has("experiments_ever_used") || em.has("saved_with_toggled_experiments"))) {
      return false;
    }
  }

  const map = doc.root.value;
  for (const setting of settings || []) {
    if (!settingChanged(setting)) continue;
    const entry = map.get(setting.key);
    if (!entry || entry.type !== setting.nbtType || entry.value !== encodedSettingValue(setting)) return false;
  }
  return true;
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
