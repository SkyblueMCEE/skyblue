/* SKYBLUE — same-origin download response.
   Converts the browser-only world stored in IndexedDB into a normal HTTP-style
   attachment so Firefox/Zen never has to navigate to a temporary blob: URL. */
"use strict";

var DB_NAME = "skyblue-world-settings";
var DB_STORE = "pending-downloads";
var DB_KEY = "latest";
var MAX_AGE = 2 * 60 * 60 * 1000;
var DOWNLOAD_PATH = "/download-file.mcworld";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

function openDatabase() {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error("indexeddb-open")); };
  });
}

function readPendingDownload() {
  return openDatabase().then(function (database) {
    return new Promise(function (resolve, reject) {
      var transaction = database.transaction(DB_STORE, "readonly");
      var request = transaction.objectStore(DB_STORE).get(DB_KEY);
      var pending = null;

      request.onsuccess = function () { pending = request.result || null; };
      request.onerror = function () { reject(request.error || new Error("indexeddb-read")); };
      transaction.oncomplete = function () {
        database.close();
        resolve(pending);
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

function textResponse(message, status) {
  return new Response(message, {
    status: status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function encodedFileName(fileName) {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, function (character) {
    return "%" + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

function attachmentResponse(pending) {
  if (!pending || !(pending.blob instanceof Blob) || !pending.fileName) {
    return textResponse("This temporary download is no longer available.", 410);
  }
  if (!pending.createdAt || Date.now() - pending.createdAt > MAX_AGE) {
    return textResponse("This temporary download expired.", 410);
  }

  var fileName = String(pending.fileName).replace(/[\r\n]/g, "_");
  var fallbackName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return new Response(pending.blob, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(pending.blob.size),
      "Content-Disposition": "attachment; filename=\"" + fallbackName + "\"; filename*=UTF-8''" + encodedFileName(fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.pathname.endsWith(DOWNLOAD_PATH)) return;

  event.respondWith(
    readPendingDownload().then(attachmentResponse).catch(function () {
      return textResponse("The temporary download could not be opened.", 500);
    })
  );
});
