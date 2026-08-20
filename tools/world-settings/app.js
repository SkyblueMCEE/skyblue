/* SKYBLUE — UI layer.
   All world parsing lives in core.js. This file only wires the DOM.
   No framework, no build step, no network calls. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var state = { zip: null, levelEntry: null, level: null, worldName: "", rows: [] };

  var el = {
    zone: $("zone"), file: $("file"), zoneTitle: $("zone-title"), zoneSub: $("zone-sub"),
    note: $("note"), status: $("status"), panelSec: $("panel-sec"), panelH: $("panel-h"),
    panelMeta: $("panel-meta"), rows: $("rows"), count: $("count"),
    allOff: $("alloff"), download: $("download")
  };

  /* ---------- messages ---------- */
  var ERRORS = {
    "not-zip":    "That file is not a Minecraft world export. Look for a file ending in .mcworld.",
    "no-level":   "There is no level.dat inside this file, so there is nothing to change. It may be a resource pack or add-on.",
    "too-big":    "Something inside this file is unexpectedly large, so it was not opened.",
    "unreadable": "That world could not be read. It may be from a much newer or older version of the game."
  };

  function say(msg, isError) {
    el.note.hidden = !msg;
    el.note.textContent = msg || "";
    el.note.className = "sky-zone-note" + (isError ? " is-error" : "");
    el.status.textContent = msg || "";
  }

  /* ---------- loading a world ---------- */
  el.zone.addEventListener("click", function () { el.file.click(); });
  el.file.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) load(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (t) {
    el.zone.addEventListener(t, function (e) { e.preventDefault(); el.zone.classList.add("is-drag"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    el.zone.addEventListener(t, function (e) { e.preventDefault(); el.zone.classList.remove("is-drag"); });
  });
  el.zone.addEventListener("drop", function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
  });

  function load(file) {
    say("Reading " + file.name + "…", false);
    el.zoneTitle.textContent = "Reading…";
    el.zone.classList.remove("is-error", "is-drag");
    el.zone.classList.add("is-loading");

    file.arrayBuffer().then(function (buf) {
      var entries = readZip(buf);
      var levelEntry = entries.find(function (en) {
        return en.name.replace(/^.*\//, "") === "level.dat";
      });
      if (!levelEntry) throw new Error("no-level");
      if (levelEntry.usize > MAX_UNPACK) throw new Error("too-big");

      var lvlP = levelEntry.method === 8
        ? inflateRaw(levelEntry.data)
        : Promise.resolve(new Uint8Array(levelEntry.data));

      return lvlP.then(function (level) {
        var doc = parseLevelDat(level);
        var em = experimentsOf(doc.root);

        var name = file.name.replace(/\.(mcworld|mctemplate|zip)$/i, "");
        var nameEntry = entries.find(function (en) {
          return en.name.replace(/^.*\//, "") === "levelname.txt";
        });
        var nameP = nameEntry
          ? (nameEntry.method === 8 ? inflateRaw(nameEntry.data)
                                    : Promise.resolve(new Uint8Array(nameEntry.data)))
          : Promise.resolve(null);

        return nameP.then(function (raw) {
          if (raw) {
            var txt = new TextDecoder().decode(raw).trim();
            if (txt) name = txt;
          }
          state.zip = entries;
          state.levelEntry = levelEntry;
          state.level = level;
          state.worldName = name;
          state.rows = buildRows(em);
          el.zone.classList.remove("is-loading");
          render();
        });
      });
    }).catch(function (err) {
      var code = ERRORS[err.message] ? err.message : "unreadable";
      say(ERRORS[code], true);
      el.zone.classList.remove("is-loading");
      el.zone.classList.add("is-error");
      el.zoneTitle.textContent = "Drop your .mcworld here";
      el.panelSec.hidden = true;
      console.error("[skyblue]", err);
    });
  }

  /* Known experiments plus anything already present in this world. */
  function buildRows(em) {
    var tags = Object.keys(LABELS).filter(function (t) { return META.indexOf(t) === -1; });
    if (em) {
      em.forEach(function (_v, k) {
        if (META.indexOf(k) === -1 && tags.indexOf(k) === -1) tags.push(k);
      });
    }
    return tags.map(function (tag) {
      var cur = em && em.get(tag);
      var on = !!(cur && cur.value === 1);
      return { tag: tag, label: LABELS[tag] || prettify(tag), on: on, original: on };
    });
  }

  /* ---------- rendering ---------- */
  function render() {
    el.zoneTitle.textContent = "Choose a different world";
    el.zoneSub.textContent = state.worldName;
    say("", false);

    el.panelSec.hidden = false;
    el.panelH.textContent = state.worldName;

    var onNow = state.rows.filter(function (r) { return r.on; }).length;
    el.panelMeta.textContent = onNow
      ? onNow + " experiment" + (onNow === 1 ? "" : "s") + " enabled"
      : "No experiments enabled";

    el.rows.textContent = "";
    state.rows.forEach(function (row, i) {
      var li = document.createElement("li");
      if (row.on !== row.original) li.className = "is-changed";

      // structure must match styles.css: label.sky-switch, then .sky-row-text, then optional .sky-chip
      var label = document.createElement("label");
      label.className = "sky-switch";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = row.on;
      input.setAttribute("aria-label", row.label);
      input.addEventListener("change", function () {
        state.rows[i].on = input.checked;
        render();
      });

      var track = document.createElement("span");
      track.className = "sky-track";
      label.appendChild(input);
      label.appendChild(track);

      var text = document.createElement("span");
      text.className = "sky-row-text";
      var l1 = document.createElement("span");
      l1.className = "sky-row-label";
      l1.textContent = row.label;                       // textContent, never innerHTML
      var l2 = document.createElement("span");
      l2.className = "sky-row-tag";
      l2.textContent = row.tag;
      text.appendChild(l1);
      text.appendChild(l2);

      li.appendChild(label);
      li.appendChild(text);

      if (row.on !== row.original) {
        var chip = document.createElement("span");
        chip.className = "sky-chip";
        chip.textContent = row.on ? "on" : "off";
        li.appendChild(chip);
      }

      el.rows.appendChild(li);
    });

    var changed = state.rows.filter(function (r) { return r.on !== r.original; }).length;
    el.count.textContent = changed ? changed + " change" + (changed === 1 ? "" : "s") + " pending" : "No changes yet";
    el.download.textContent = state.rows.some(function (r) { return r.on; })
      ? "Save a new copy" : "Save a copy with experiments removed";
  }

  el.allOff.addEventListener("click", function () {
    state.rows.forEach(function (r) { r.on = false; });
    render();
  });

  /* ---------- writing the new world ---------- */
  el.download.addEventListener("click", function () {
    try {
      var doc = parseLevelDat(state.level);
      applySelection(doc.root, state.rows);
      var level = buildLevelDat(doc);

      // never hand over a file we cannot read back
      if (!verifyRoundTrip(level, state.rows)) {
        say("Safety check failed, so nothing was saved. Your original file is untouched. Please report this world.", true);
        return;
      }

      var out = state.zip.map(function (e) {
        return e === state.levelEntry
          ? { name: e.name, method: 0, crc: crc32(level), csize: level.length, usize: level.length, data: level }
          : e;
      });

      var blob = buildZip(out);
      var base = (state.worldName || "world").replace(/[^\w\- ]+/g, "").trim() || "world";
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = base + "-skyblue.mcworld";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      say("Saved " + a.download + ". Your original file is unchanged.", false);
    } catch (err) {
      say("Could not write the new world. Your original file is untouched.", true);
      console.error("[skyblue]", err);
    }
  });
})();
