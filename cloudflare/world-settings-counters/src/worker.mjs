const COUNTER_ID = "world-settings";

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function allowedHttpsHostSuffixes(env) {
  return String(env.ALLOWED_HTTPS_HOST_SUFFIXES || "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function isAllowedOrigin(env, origin) {
  if (allowedOrigins(env).has(origin)) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return allowedHttpsHostSuffixes(env).some((suffix) =>
    hostname === suffix || hostname.endsWith("." + suffix)
  );
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
}

async function readCounts(env) {
  const row = await env.DB.prepare(
    "SELECT views, downloads FROM counters WHERE id = ?"
  ).bind(COUNTER_ID).first();

  if (!row) throw new Error("counter-not-seeded");
  return {
    views: Number(row.views),
    downloads: Number(row.downloads)
  };
}

async function increment(env, column) {
  const sql = column === "views"
    ? "UPDATE counters SET views = views + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    : "UPDATE counters SET downloads = downloads + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
  await env.DB.prepare(sql).bind(COUNTER_ID).run();
  return readCounts(env);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!isAllowedOrigin(env, origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/counts") {
        return json(await readCounts(env), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/view") {
        return json(await increment(env, "views"), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/download") {
        return json(await increment(env, "downloads"), 200, origin);
      }
      return json({ error: "not-found" }, 404, origin);
    } catch (error) {
      console.error("counter-request-failed", error);
      return json({ error: "counter-unavailable" }, 500, origin);
    }
  }
};
