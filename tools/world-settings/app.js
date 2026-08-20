/* SKYBLUE — UI layer.
   All world parsing lives in core.js. This file only wires the DOM.
   No framework or build step; the only network calls update anonymous counters. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    zip: null,
    levelEntry: null,
    level: null,
    worldName: "",
    experiments: [],
    settings: [],
    packs: [],
    activeSection: "world-setup"
  };

  var el = {
    zone: $("zone"), file: $("file"), zoneTitle: $("zone-title"), zoneSub: $("zone-sub"),
    note: $("note"), status: $("status"), panelSec: $("panel-sec"), panelH: $("panel-h"),
    panelMeta: $("panel-meta"), settingsNav: $("settings-nav"), settingsGroups: $("settings-groups"),
    count: $("count"), reset: $("reset"), download: $("download"),
    viewCount: $("view-count"), downloadCount: $("download-count"),
    editorStartSec: $("editor-start-sec"), downloadReadySec: $("download-ready-sec"),
    downloadReady: $("download-ready"), downloadReadyKicker: $("download-ready-kicker"),
    downloadReadyHeading: $("download-ready-h"), downloadReadyCopy: $("download-ready-copy"),
    downloadReadyStatus: $("download-ready-status")
  };

  var LINKVERTISE_LIVE_URL = "https://link-center.net/7806078/HB8fxxmmD4Y2";
  var LINKVERTISE_URL = ["localhost", "127.0.0.1", "::1"].indexOf(window.location.hostname) !== -1
    ? window.location.pathname + "?download=ready"
    : LINKVERTISE_LIVE_URL;
  var PENDING_DOWNLOAD_DB = "skyblue-world-settings";
  var PENDING_DOWNLOAD_STORE = "pending-downloads";
  var PENDING_DOWNLOAD_KEY = "latest";
  var PENDING_DOWNLOAD_MAX_AGE = 2 * 60 * 60 * 1000;

  var COUNTER_API = "https://page-views-api.ratneshc.com/api/v1";
  var COUNTER_SITE = window.location.hostname.toLowerCase();

  function normalizedCounterPath(path) {
    var clean = (path || "/").replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return clean || "/";
  }

  var VIEW_COUNTER_PATH = normalizedCounterPath(window.location.pathname);
  var DOWNLOAD_COUNTER_PATH = normalizedCounterPath(VIEW_COUNTER_PATH + "/downloads");

  function countersEnabled() {
    return window.location.protocol === "https:" &&
      COUNTER_SITE &&
      ["localhost", "127.0.0.1", "::1"].indexOf(COUNTER_SITE) === -1;
  }

  function counterUrl(action, path) {
    return COUNTER_API + "/" + action +
      "?site=" + encodeURIComponent(COUNTER_SITE) +
      "&path=" + encodeURIComponent(path);
  }

  function formatCounter(value) {
    return new Intl.NumberFormat().format(value);
  }

  function showCounter(node, value) {
    if (node && Number.isFinite(value) && value >= 0) node.textContent = formatCounter(value);
  }

  function readCounter(path, node) {
    if (!countersEnabled()) {
      if (node) node.title = "Counters are available on the published HTTPS site.";
      return Promise.resolve();
    }
    return fetch(counterUrl("views", path), {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).then(function (response) {
      if (!response.ok) throw new Error("counter-read");
      return response.json();
    }).then(function (data) {
      showCounter(node, Number(data.views));
    }).catch(function () {
      if (node) node.title = "Counter temporarily unavailable.";
    });
  }

  function incrementCounter(path, node) {
    if (!countersEnabled()) return Promise.resolve();
    return fetch(counterUrl("track", path), {
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer"
    }).catch(function () {
      return null;
    }).then(function () {
      return readCounter(path, node);
    });
  }

  function initializeCounters() {
    incrementCounter(VIEW_COUNTER_PATH, el.viewCount);
    readCounter(DOWNLOAD_COUNTER_PATH, el.downloadCount);
  }

  function openPendingDownloadDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("indexeddb-unavailable"));
        return;
      }

      var request = window.indexedDB.open(PENDING_DOWNLOAD_DB, 1);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(PENDING_DOWNLOAD_STORE)) {
          database.createObjectStore(PENDING_DOWNLOAD_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("indexeddb-open")); };
    });
  }

  function usePendingDownloadStore(mode, operation) {
    return openPendingDownloadDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction;
        var request;
        try {
          transaction = database.transaction(PENDING_DOWNLOAD_STORE, mode);
          request = operation(transaction.objectStore(PENDING_DOWNLOAD_STORE));
        } catch (error) {
          database.close();
          reject(error);
          return;
        }

        var result;
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () { reject(request.error || new Error("indexeddb-request")); };
        transaction.oncomplete = function () {
          database.close();
          resolve(result);
        };
        transaction.onerror = function () {
          database.close();
          reject(transaction.error || new Error("indexeddb-transaction"));
        };
        transaction.onabort = function () {
          database.close();
          reject(transaction.error || new Error("indexeddb-abort"));
        };
      });
    });
  }

  function storePendingDownload(blob, fileName) {
    return usePendingDownloadStore("readwrite", function (store) {
      return store.put({
        id: PENDING_DOWNLOAD_KEY,
        blob: blob,
        fileName: fileName,
        createdAt: Date.now()
      });
    });
  }

  function readPendingDownload() {
    return usePendingDownloadStore("readonly", function (store) {
      return store.get(PENDING_DOWNLOAD_KEY);
    });
  }

  function clearPendingDownload() {
    return usePendingDownloadStore("readwrite", function (store) {
      return store.delete(PENDING_DOWNLOAD_KEY);
    });
  }

  function saveBlobToDevice(blob, fileName) {
    var objectUrl = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () { anchor.remove(); }, 1000);

    // Firefox-based browsers may not consume a blob URL until after their
    // download prompt closes. Revoking it after a few seconds can turn that
    // pending download into a "File not found" page. Keep it alive for the
    // same window as the pending download; the browser also releases it when
    // this document is unloaded.
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, PENDING_DOWNLOAD_MAX_AGE);
  }

  function isDownloadReturn() {
    return new URLSearchParams(window.location.search).get("download") === "ready";
  }

  function showMissingPendingDownload(message) {
    el.downloadReadyKicker.textContent = "Download unavailable";
    el.downloadReadyHeading.textContent = "We could not find your modified world";
    el.downloadReadyCopy.textContent = "Modified worlds are stored only in the browser that created them. Nothing was uploaded or saved on our servers.";
    el.downloadReady.hidden = true;
    el.downloadReadyStatus.textContent = message;
  }

  function initializeDownloadReturn() {
    if (!isDownloadReturn()) return;

    el.editorStartSec.hidden = true;
    el.panelSec.hidden = true;
    el.downloadReadySec.hidden = false;

    readPendingDownload().then(function (pending) {
      if (!pending || !(pending.blob instanceof Blob) || !pending.fileName) {
        showMissingPendingDownload("Return to the editor and create the file again on this device.");
        return;
      }

      if (!pending.createdAt || Date.now() - pending.createdAt > PENDING_DOWNLOAD_MAX_AGE) {
        clearPendingDownload().catch(function () {});
        showMissingPendingDownload("That temporary file expired. Return to the editor and create it again.");
        return;
      }

      el.downloadReady.disabled = false;
      el.downloadReady.textContent = "Download " + pending.fileName;
      el.downloadReadyStatus.textContent = "Ready on this device. The temporary copy is removed after downloading.";

      el.downloadReady.addEventListener("click", function () {
        el.downloadReady.disabled = true;
        el.downloadReady.textContent = "Starting download…";
        saveBlobToDevice(pending.blob, pending.fileName);
        incrementCounter(DOWNLOAD_COUNTER_PATH, el.downloadCount);
        clearPendingDownload().catch(function (error) {
          console.error("[skyblue] Could not remove the temporary download.", error);
        });
        pending = null;
        window.history.replaceState(null, "", window.location.pathname);
        el.downloadReady.textContent = "Downloaded";
        el.downloadReadyStatus.textContent = "Saved successfully. Import the new copy in Minecraft the way you normally import a world.";
      }, { once: true });
    }).catch(function (error) {
      console.error("[skyblue] Could not read the temporary download.", error);
      showMissingPendingDownload("Browser storage is unavailable. Return to the editor and create the file again.");
    });
  }

  var ERRORS = {
    "not-zip":    "That file is not a Minecraft world export. Look for a file ending in .mcworld.",
    "no-level":   "There is no level.dat inside this file, so there is nothing to change. It may be a resource pack or add-on.",
    "too-big":    "Something inside this file is unexpectedly large, so it was not opened.",
    "unreadable": "That world could not be read. It may be from a much newer or older version of the game."
  };

  function make(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue !== undefined) node.textContent = textValue;
    return node;
  }

  function say(message, isError) {
    el.note.hidden = !message;
    el.note.textContent = message || "";
    el.note.className = "sky-zone-note" + (isError ? " is-error" : "");
    el.status.textContent = message || "";
  }

  function findEntry(entries, fileName) {
    return entries.find(function (entry) {
      return entry.name.replace(/^.*\//, "") === fileName;
    }) || null;
  }

  function unpackEntry(entry) {
    if (!entry) return Promise.resolve(null);
    if (entry.usize > MAX_UNPACK) return Promise.reject(new Error("too-big"));
    return entry.method === 8
      ? inflateRaw(entry.data)
      : Promise.resolve(new Uint8Array(entry.data));
  }

  function readPackConfig(entries, fileName, label) {
    var entry = findEntry(entries, fileName);
    var base = {
      fileName: fileName,
      label: label,
      entry: entry,
      readable: true,
      originalItems: [],
      on: false,
      originalOn: false
    };
    if (!entry) return Promise.resolve(base);

    return unpackEntry(entry).then(function (raw) {
      var text = DEC.decode(raw).replace(/^\uFEFF/, "");
      var items = JSON.parse(text);
      if (!Array.isArray(items)) throw new Error("pack-list");
      base.originalItems = items;
      base.on = items.length > 0;
      base.originalOn = base.on;
      return base;
    }).catch(function () {
      base.readable = false;
      return base;
    });
  }

  function buildExperimentRows(experiments) {
    var storedTags = [];
    if (experiments) {
      experiments.forEach(function (_value, key) {
        if (META.indexOf(key) === -1) storedTags.push(key);
      });
    }

    var rows = storedTags.map(function (tag) {
      var current = experiments && experiments.get(tag);
      var on = !!(current && current.value === 1);
      var catalogEntry = AVAILABLE_EXPERIMENTS.find(function (entry) { return entry.tag === tag; });
      return {
        tag: tag,
        label: LABELS[tag] || (catalogEntry && catalogEntry.label) || prettify(tag),
        description: catalogEntry ? catalogEntry.description : "This tag was found in the world and will be preserved unless you change it.",
        stored: true,
        available: !!catalogEntry,
        on: on,
        original: on
      };
    });

    AVAILABLE_EXPERIMENTS.forEach(function (entry) {
      if (storedTags.indexOf(entry.tag) !== -1) return;
      rows.push({
        tag: entry.tag,
        label: entry.label,
        description: entry.description,
        stored: false,
        available: true,
        on: false,
        original: false
      });
    });
    return rows;
  }

  function load(file) {
    say("Reading " + file.name + "…", false);
    el.zoneTitle.textContent = "Reading…";
    el.zone.classList.remove("is-error", "is-drag");
    el.zone.classList.add("is-loading");

    file.arrayBuffer().then(function (buffer) {
      var entries = readZip(buffer);
      var levelEntry = findEntry(entries, "level.dat");
      if (!levelEntry) throw new Error("no-level");

      return unpackEntry(levelEntry).then(function (level) {
        var doc = parseLevelDat(level);
        var name = file.name.replace(/\.(mcworld|mctemplate|zip)$/i, "");
        var nameEntry = findEntry(entries, "levelname.txt");
        var namePromise = unpackEntry(nameEntry).then(function (raw) {
          if (!raw) return name;
          var text = DEC.decode(raw).trim();
          return text || name;
        });
        var packsPromise = Promise.all([
          readPackConfig(entries, "world_behavior_packs.json", "Behavior packs"),
          readPackConfig(entries, "world_resource_packs.json", "Resource packs")
        ]);

        return Promise.all([namePromise, packsPromise]).then(function (loaded) {
          state.zip = entries;
          state.levelEntry = levelEntry;
          state.level = level;
          state.worldName = loaded[0];
          state.experiments = buildExperimentRows(experimentsOf(doc.root));
          state.settings = readWorldSettings(doc.root);
          state.packs = loaded[1];
          state.activeSection = "world-setup";
          el.zone.classList.remove("is-loading");
          render();
        });
      });
    }).catch(function (error) {
      var code = ERRORS[error.message] ? error.message : "unreadable";
      say(ERRORS[code], true);
      el.zone.classList.remove("is-loading");
      el.zone.classList.add("is-error");
      el.zoneTitle.textContent = "Drop your .mcworld here";
      el.panelSec.hidden = true;
      console.error("[skyblue]", error);
    });
  }

  el.zone.addEventListener("click", function () { el.file.click(); });
  el.file.addEventListener("change", function (event) {
    if (event.target.files && event.target.files[0]) load(event.target.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (type) {
    el.zone.addEventListener(type, function (event) {
      event.preventDefault();
      el.zone.classList.add("is-drag");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    el.zone.addEventListener(type, function (event) {
      event.preventDefault();
      el.zone.classList.remove("is-drag");
    });
  });
  el.zone.addEventListener("drop", function (event) {
    if (event.dataTransfer.files && event.dataTransfer.files[0]) load(event.dataTransfer.files[0]);
  });

  function settingByKey(key) {
    return state.settings.find(function (setting) { return setting.key === key; });
  }

  function optionLabel(key) {
    var setting = settingByKey(key);
    if (!setting || !setting.options) return "";
    var option = setting.options.find(function (item) { return item.value === setting.value; });
    return option ? option.label : "Unknown";
  }

  function isHardcore() {
    var setting = settingByKey("hardcore");
    return !!(setting && setting.value);
  }

  function enforceHardcore() {
    var values = { GameType: 0, Difficulty: 3, commandsEnabled: false };
    Object.keys(values).forEach(function (key) {
      var setting = settingByKey(key);
      if (setting) setting.value = values[key];
    });
  }

  function settingIsLocked(setting) {
    return isHardcore() && ["GameType", "Difficulty", "commandsEnabled"].indexOf(setting.key) !== -1;
  }

  function packChanged(pack) {
    return pack.readable && pack.on !== pack.originalOn;
  }

  function changeCount() {
    var settings = state.settings.filter(settingChanged).length;
    var experiments = state.experiments.filter(function (row) { return row.on !== row.original; }).length;
    var packs = state.packs.filter(packChanged).length;
    return settings + experiments + packs;
  }

  function activePackCount() {
    return state.packs.reduce(function (total, pack) {
      return total + (pack.on ? pack.originalItems.length : 0);
    }, 0);
  }

  function storedExperimentCount() {
    return state.experiments.filter(function (row) { return row.stored; }).length;
  }

  function availableExperimentCount() {
    return state.experiments.filter(function (row) { return !row.stored && row.available; }).length;
  }

  function renderNavigation() {
    var sections = WORLD_SETTING_GROUPS.map(function (group) {
      return { id: group.id, label: group.title };
    });
    sections.push({ id: "experiments", label: "Experiments", count: storedExperimentCount() + availableExperimentCount() });
    sections.push({ id: "packs", label: "Packs" });

    el.settingsNav.textContent = "";
    sections.forEach(function (section, index) {
      var selected = section.id === state.activeSection;
      var button = make("button", "sky-settings-nav-link");
      button.type = "button";
      button.id = "settings-tab-" + section.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.setAttribute("aria-controls", "settings-panel-" + section.id);
      button.tabIndex = selected ? 0 : -1;
      button.appendChild(make("span", "", section.label));
      if (section.count !== undefined) {
        button.appendChild(make("span", "sky-tab-count", String(section.count)));
      }
      button.addEventListener("click", function () {
        state.activeSection = section.id;
        render();
      });
      button.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % sections.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + sections.length) % sections.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = sections.length - 1;
        if (next === null) return;
        event.preventDefault();
        state.activeSection = sections[next].id;
        render();
        var activeTab = $("settings-tab-" + state.activeSection);
        if (activeTab) activeTab.focus();
      });
      el.settingsNav.appendChild(button);
    });
  }

  function prepareTabPanel(section, id) {
    section.id = "settings-panel-" + id;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", "settings-tab-" + id);
    section.tabIndex = 0;
    return section;
  }

  function addChangedChip(info) {
    info.appendChild(make("span", "sky-chip", "Changed"));
  }

  function renderBooleanControl(setting, titleId, locked) {
    var label = make("label", "sky-switch");
    var input = make("input");
    input.type = "checkbox";
    input.checked = setting.value;
    input.disabled = locked;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-labelledby", titleId);
    if (locked) input.title = "Turn off Hardcore before changing this setting.";
    input.addEventListener("change", function () {
      setting.value = input.checked;
      if (setting.key === "hardcore" && setting.value) enforceHardcore();
      render();
    });
    label.appendChild(input);
    label.appendChild(make("span", "sky-track"));
    return label;
  }

  function renderSelectControl(setting, titleId, locked) {
    var select = make("select", "sky-field");
    select.setAttribute("aria-labelledby", titleId);
    select.disabled = locked;
    if (locked) select.title = "Turn off Hardcore before changing this setting.";

    var known = setting.options.some(function (option) { return option.value === setting.value; });
    if (!known) {
      var unknown = make("option", "", "Unknown (" + setting.value + ")");
      unknown.value = String(setting.value);
      select.appendChild(unknown);
    }
    setting.options.forEach(function (option) {
      var item = make("option", "", option.label);
      item.value = String(option.value);
      select.appendChild(item);
    });
    select.value = String(setting.value);
    select.addEventListener("change", function () {
      setting.value = Number(select.value);
      render();
    });
    return select;
  }

  function renderNumberControl(setting, titleId) {
    var wrap = make("div", "sky-number-wrap");
    var input = make("input", "sky-field");
    input.type = setting.kind === "long" ? "text" : "number";
    input.inputMode = "numeric";
    input.value = setting.value;
    input.setAttribute("aria-labelledby", titleId);
    input.setAttribute("data-setting-key", setting.key);
    input.autocomplete = "off";
    if (setting.kind === "long") {
      input.pattern = "-?[0-9]+";
      input.maxLength = 20;
    } else {
      input.min = setting.min;
      input.max = setting.max;
      input.step = "1";
    }
    input.addEventListener("input", function () {
      setting.value = input.value.trim();
      renderFooter();
    });
    input.addEventListener("change", function () {
      setting.value = input.value.trim();
      render();
    });
    wrap.appendChild(input);
    if (setting.suffix) wrap.appendChild(make("span", "sky-field-suffix", setting.suffix));
    return wrap;
  }

  function renderSettingRow(setting) {
    var changed = settingChanged(setting);
    var locked = settingIsLocked(setting);
    var row = make("div", "sky-setting-row" + (changed ? " is-changed" : "") + (locked ? " is-locked" : ""));
    var info = make("div", "sky-setting-info");
    var titleId = "setting-label-" + setting.key.toLowerCase();
    var title = make("h4", "sky-setting-label", setting.label);
    title.id = titleId;
    info.appendChild(title);
    info.appendChild(make("p", "sky-setting-description", setting.description));
    info.appendChild(make("code", "sky-setting-key", setting.key));
    if (locked) info.appendChild(make("span", "sky-lock-note", "Locked by Hardcore"));
    if (changed) addChangedChip(info);

    var control;
    var controlClass = "sky-setting-control";
    if (setting.kind === "boolean") {
      control = renderBooleanControl(setting, titleId, locked);
    } else if (setting.kind === "select") {
      controlClass += " is-field";
      control = renderSelectControl(setting, titleId, locked);
    } else {
      controlClass += " is-field";
      control = renderNumberControl(setting, titleId);
    }

    var controlWrap = make("div", controlClass);
    controlWrap.appendChild(control);
    row.appendChild(info);
    row.appendChild(controlWrap);
    return row;
  }

  function sectionHeader(title, description) {
    var header = make("div", "sky-settings-group-head");
    header.appendChild(make("h3", "sky-settings-group-title", title));
    header.appendChild(make("p", "sky-settings-group-description", description));
    return header;
  }

  function renderBulkControls(label, turnOn, turnOff, disabled) {
    var tools = make("div", "sky-section-tools");
    tools.setAttribute("aria-label", label + " bulk controls");
    var allOn = make("button", "sky-btn sky-btn-quiet", "Turn on all");
    var allOff = make("button", "sky-btn sky-btn-quiet", "Turn off all");
    allOn.type = allOff.type = "button";
    allOn.disabled = allOff.disabled = !!disabled;
    if (disabled) {
      allOn.title = allOff.title = "No switches in this tab can be changed right now.";
    }
    allOn.addEventListener("click", turnOn);
    allOff.addEventListener("click", turnOff);
    tools.appendChild(allOn);
    tools.appendChild(allOff);
    return tools;
  }

  function booleanSettingsInGroup(groupId) {
    return state.settings.filter(function (setting) {
      return setting.groupId === groupId && setting.kind === "boolean";
    });
  }

  function setGroupToggles(groupId, on) {
    booleanSettingsInGroup(groupId).forEach(function (setting) {
      if (!settingIsLocked(setting)) setting.value = on;
    });
    if (groupId === "world-setup" && on && isHardcore()) enforceHardcore();
    render();
  }

  function renderSettingGroup(group) {
    var section = prepareTabPanel(make("section", "sky-settings-group"), group.id);
    section.appendChild(sectionHeader(group.title, group.description));
    var editableToggles = booleanSettingsInGroup(group.id).filter(function (setting) {
      return !settingIsLocked(setting);
    });
    section.appendChild(renderBulkControls(
      group.title,
      function () { setGroupToggles(group.id, true); },
      function () { setGroupToggles(group.id, false); },
      editableToggles.length === 0
    ));
    var list = make("div", "sky-setting-list");
    state.settings.filter(function (setting) {
      return setting.groupId === group.id;
    }).forEach(function (setting) {
      list.appendChild(renderSettingRow(setting));
    });
    section.appendChild(list);
    return section;
  }

  function renderExperimentRow(experiment) {
    var changed = experiment.on !== experiment.original;
    var row = make("div", "sky-setting-row" + (changed ? " is-changed" : ""));
    var info = make("div", "sky-setting-info");
    var titleId = "experiment-label-" + experiment.tag.replace(/[^a-z0-9_-]/gi, "-");
    var title = make("h4", "sky-setting-label", experiment.label);
    title.id = titleId;
    info.appendChild(title);
    if (experiment.description) {
      info.appendChild(make("p", "sky-setting-description", experiment.description));
    }
    info.appendChild(make("code", "sky-setting-key", experiment.tag));
    if (changed) addChangedChip(info);

    var label = make("label", "sky-switch");
    var input = make("input");
    input.type = "checkbox";
    input.checked = experiment.on;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-labelledby", titleId);
    input.addEventListener("change", function () {
      experiment.on = input.checked;
      render();
    });
    label.appendChild(input);
    label.appendChild(make("span", "sky-track"));

    var control = make("div", "sky-setting-control");
    control.appendChild(label);
    row.appendChild(info);
    row.appendChild(control);
    return row;
  }

  function renderExperiments() {
    var section = prepareTabPanel(make("section", "sky-settings-group"), "experiments");
    var stored = storedExperimentCount();
    var available = availableExperimentCount();
    section.appendChild(sectionHeader(
      "Experiments",
      stored + " stored in this world · " + available + " available to add"
    ));
    section.appendChild(renderBulkControls(
      "Experiments",
      function () {
        state.experiments.forEach(function (row) { row.on = true; });
        render();
      },
      function () {
        state.experiments.forEach(function (row) { row.on = false; });
        render();
      },
      state.experiments.length === 0
    ));
    section.appendChild(make("p", "sky-section-note", "Experiment toggles vary by Minecraft version. Only enable features your version and add-ons require."));

    var inWorld = state.experiments.filter(function (row) { return row.stored; });
    var choices = state.experiments.filter(function (row) { return !row.stored && row.available; });

    var storedGroup = make("div", "sky-experiment-group");
    storedGroup.appendChild(make("h4", "sky-subsection-title", "In this world (" + inWorld.length + ")"));
    storedGroup.appendChild(make("p", "sky-subsection-description", "Only tags actually found in level.dat appear here."));
    if (!inWorld.length) {
      storedGroup.appendChild(make("p", "sky-inline-empty", "No experiment tags are stored in this world yet."));
    } else {
      var storedList = make("div", "sky-setting-list");
      inWorld.forEach(function (experiment) {
        storedList.appendChild(renderExperimentRow(experiment));
      });
      storedGroup.appendChild(storedList);
    }
    section.appendChild(storedGroup);

    var availableGroup = make("div", "sky-experiment-group");
    availableGroup.appendChild(make("h4", "sky-subsection-title", "Available to add (" + choices.length + ")"));
    availableGroup.appendChild(make("p", "sky-subsection-description", "Turning one on adds its tag to the saved copy; your original world stays untouched."));
    var availableList = make("div", "sky-setting-list");
    choices.forEach(function (experiment) {
      availableList.appendChild(renderExperimentRow(experiment));
    });
    availableGroup.appendChild(availableList);
    section.appendChild(availableGroup);
    return section;
  }

  function packSummary(pack) {
    if (!pack.readable) return "The pack list could not be read, so it will be preserved unchanged.";
    if (!pack.originalItems.length) return "No packs are configured in this world.";
    return pack.originalItems.length + " pack" + (pack.originalItems.length === 1 ? "" : "s") + " configured.";
  }

  function renderPackRow(pack, index) {
    var changed = packChanged(pack);
    var unavailable = !pack.readable || !pack.originalItems.length;
    var row = make("div", "sky-setting-row" + (changed ? " is-changed" : "") + (unavailable ? " is-locked" : ""));
    var info = make("div", "sky-setting-info");
    var titleId = "pack-label-" + index;
    var title = make("h4", "sky-setting-label", pack.label);
    title.id = titleId;
    info.appendChild(title);
    info.appendChild(make("p", "sky-setting-description", packSummary(pack)));
    info.appendChild(make("code", "sky-setting-key", pack.fileName));
    if (changed) addChangedChip(info);

    if (pack.originalItems.length) {
      var ids = make("ul", "sky-pack-list");
      pack.originalItems.forEach(function (item) {
        ids.appendChild(make("li", "", item.pack_id || "Unknown pack ID"));
      });
      info.appendChild(ids);
    }

    var label = make("label", "sky-switch");
    var input = make("input");
    input.type = "checkbox";
    input.checked = pack.on;
    input.disabled = unavailable;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-labelledby", titleId);
    input.addEventListener("change", function () {
      pack.on = input.checked;
      render();
    });
    label.appendChild(input);
    label.appendChild(make("span", "sky-track"));

    var control = make("div", "sky-setting-control");
    control.appendChild(label);
    row.appendChild(info);
    row.appendChild(control);
    return row;
  }

  function renderPacks() {
    var section = prepareTabPanel(make("section", "sky-settings-group"), "packs");
    section.appendChild(sectionHeader("Packs", "See which add-on packs are active, disable them, or require resource-pack downloads."));
    var editablePacks = state.packs.filter(function (pack) {
      return pack.readable && pack.originalItems.length;
    });
    var packSettings = booleanSettingsInGroup("packs");
    section.appendChild(renderBulkControls(
      "Packs",
      function () {
        editablePacks.forEach(function (pack) { pack.on = true; });
        packSettings.forEach(function (setting) { setting.value = true; });
        render();
      },
      function () {
        editablePacks.forEach(function (pack) { pack.on = false; });
        packSettings.forEach(function (setting) { setting.value = false; });
        render();
      },
      editablePacks.length === 0 && packSettings.length === 0
    ));
    section.appendChild(make("p", "sky-section-note", "A pack can only be enabled when its ID is already configured in the world."));

    var list = make("div", "sky-setting-list");
    state.packs.forEach(function (pack, index) {
      list.appendChild(renderPackRow(pack, index));
    });
    state.settings.filter(function (setting) {
      return setting.groupId === "packs";
    }).forEach(function (setting) {
      list.appendChild(renderSettingRow(setting));
    });
    section.appendChild(list);
    return section;
  }

  function renderFooter() {
    var changed = changeCount();
    el.count.textContent = changed
      ? changed + " change" + (changed === 1 ? "" : "s") + " pending"
      : "No changes yet";
    el.reset.disabled = changed === 0;
    el.download.textContent = "Save a new copy";
  }

  function renderActiveSection() {
    var content = null;
    var group = WORLD_SETTING_GROUPS.find(function (item) {
      return item.id === state.activeSection;
    });
    if (group) content = renderSettingGroup(group);
    else if (state.activeSection === "experiments") content = renderExperiments();
    else if (state.activeSection === "packs") content = renderPacks();
    else {
      state.activeSection = "world-setup";
      content = renderSettingGroup(WORLD_SETTING_GROUPS[0]);
    }
    el.settingsGroups.textContent = "";
    el.settingsGroups.appendChild(content);
  }

  function render() {
    el.zoneTitle.textContent = "Choose a different world";
    el.zoneSub.textContent = state.worldName;
    say("", false);
    el.panelSec.hidden = false;
    el.panelH.textContent = state.worldName;

    var summary = [];
    if (isHardcore()) summary.push("Hardcore");
    summary.push(optionLabel("GameType"));
    summary.push(optionLabel("Difficulty"));
    var experimentsOn = state.experiments.filter(function (row) { return row.on; }).length;
    var experimentsStored = storedExperimentCount();
    summary.push(experimentsStored + " experiment tag" + (experimentsStored === 1 ? "" : "s") + " stored, " + experimentsOn + " enabled");
    var packsOn = activePackCount();
    summary.push(packsOn + " active pack" + (packsOn === 1 ? "" : "s"));
    el.panelMeta.textContent = summary.join(" · ");

    renderNavigation();
    renderActiveSection();
    renderFooter();
  }

  el.reset.addEventListener("click", function () {
    state.settings.forEach(function (setting) { setting.value = setting.original; });
    state.experiments.forEach(function (row) { row.on = row.original; });
    state.packs.forEach(function (pack) { pack.on = pack.originalOn; });
    render();
  });

  function storedEntry(entry, bytes) {
    return {
      name: entry.name,
      method: 0,
      crc: crc32(bytes),
      csize: bytes.length,
      usize: bytes.length,
      data: bytes
    };
  }

  function entriesWithChanges(level) {
    var packBytes = new Map();
    state.packs.forEach(function (pack) {
      if (!packChanged(pack) || !pack.entry) return;
      var items = pack.on ? pack.originalItems : [];
      packBytes.set(pack.entry, ENC.encode(JSON.stringify(items, null, 2) + "\n"));
    });

    return state.zip.map(function (entry) {
      if (entry === state.levelEntry) return storedEntry(entry, level);
      if (packBytes.has(entry)) return storedEntry(entry, packBytes.get(entry));
      return entry;
    });
  }

  function verifyPackChanges(blob) {
    var changed = state.packs.filter(packChanged);
    if (!changed.length) return Promise.resolve(true);
    return blob.arrayBuffer().then(function (buffer) {
      var entries = readZip(buffer);
      return Promise.all(changed.map(function (pack) {
        var entry = entries.find(function (candidate) { return candidate.name === pack.entry.name; });
        if (!entry) return false;
        return unpackEntry(entry).then(function (raw) {
          var actual = JSON.parse(DEC.decode(raw).replace(/^\uFEFF/, ""));
          var expected = pack.on ? pack.originalItems : [];
          return JSON.stringify(actual) === JSON.stringify(expected);
        }).catch(function () { return false; });
      })).then(function (results) {
        return results.every(Boolean);
      });
    }).catch(function () { return false; });
  }

  function focusInvalidSetting(key) {
    var input = document.querySelector('[data-setting-key="' + key + '"]');
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  el.download.addEventListener("click", function () {
    var validation = validateWorldSettings(state.settings);
    if (!validation.valid) {
      say(validation.message, true);
      focusInvalidSetting(validation.key);
      return;
    }

    el.download.disabled = true;
    el.download.textContent = "Checking and saving…";
    try {
      var doc = parseLevelDat(state.level);
      applySelection(doc.root, state.experiments);
      applyWorldSettings(doc.root, state.settings);
      var level = buildLevelDat(doc);

      if (!verifyRoundTrip(level, state.experiments, state.settings)) {
        throw new Error("safety-check");
      }

      var blob = buildZip(entriesWithChanges(level));
      verifyPackChanges(blob).then(function (packsOkay) {
        if (!packsOkay) throw new Error("safety-check");

        var base = (state.worldName || "world").replace(/[^\w\- ]+/g, "").trim() || "world";
        var fileName = base + "-skyblue.mcworld";
        return storePendingDownload(blob, fileName).then(function () {
          say("Your modified world is ready. Opening the download page…", false);
          window.location.assign(LINKVERTISE_URL);
        }).catch(function (error) {
          console.error("[skyblue] Could not store the pending download.", error);
          saveBlobToDevice(blob, fileName);
          incrementCounter(DOWNLOAD_COUNTER_PATH, el.downloadCount);
          say("Saved " + fileName + ". The ad page was skipped because browser storage is unavailable.", false);
        });
      }).catch(function (error) {
        say("Safety check failed, so nothing was saved. Your original file is untouched.", true);
        console.error("[skyblue]", error);
      }).then(function () {
        el.download.disabled = false;
        el.download.textContent = "Save a new copy";
      });
    } catch (error) {
      el.download.disabled = false;
      el.download.textContent = "Save a new copy";
      say("Could not write the new world. Your original file is untouched.", true);
      console.error("[skyblue]", error);
    }
  });

  initializeDownloadReturn();
  initializeCounters();
})();
