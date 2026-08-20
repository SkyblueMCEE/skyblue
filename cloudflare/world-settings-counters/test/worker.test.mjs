import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

function testEnvironment() {
  const row = { views: 567, downloads: 438 };
  return {
    ALLOWED_ORIGINS: "https://skybluemcee.github.io",
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() { return { ...row }; },
          async run() {
            if (sql.includes("views = views + 1")) row.views += 1;
            if (sql.includes("downloads = downloads + 1")) row.downloads += 1;
            return { success: true };
          }
        };
      }
    }
  };
}

function request(path, method = "GET", origin = "https://skybluemcee.github.io") {
  return new Request("https://counter.example" + path, {
    method,
    headers: { Origin: origin }
  });
}

test("returns seeded totals and increments each counter independently", async () => {
  const env = testEnvironment();

  let response = await worker.fetch(request("/api/counts"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { views: 567, downloads: 438 });

  response = await worker.fetch(request("/api/view", "POST"), env);
  assert.deepEqual(await response.json(), { views: 568, downloads: 438 });

  response = await worker.fetch(request("/api/download", "POST"), env);
  assert.deepEqual(await response.json(), { views: 568, downloads: 439 });
});

test("rejects requests from unapproved origins", async () => {
  const response = await worker.fetch(
    request("/api/counts", "GET", "https://example.com"),
    testEnvironment()
  );
  assert.equal(response.status, 403);
});

test("answers CORS preflight requests", async () => {
  const response = await worker.fetch(request("/api/counts", "OPTIONS"), testEnvironment());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://skybluemcee.github.io");
});
