# World settings counters

Cloudflare Worker + D1 backend for the public view and download totals on the
world settings editor. The initial migration preserves the previous totals:
567 views and 438 downloads.

Live API: `https://skyblue-world-settings-counters.world-settings-counters.workers.dev`

## Deploy

From this directory:

```powershell
npx wrangler@latest login
npx wrangler@latest d1 create skyblue-counters --binding DB --update-config
npx wrangler@latest d1 migrations apply skyblue-counters --remote
npx wrangler@latest deploy
```

After deploying, put the resulting `workers.dev` URL in `COUNTER_API` inside
`tools/world-settings/app.js`.
