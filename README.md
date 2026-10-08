# River Guide

Live river levels and an AI assistant for whitewater paddlers in Scotland, running entirely on Cloudflare.

**Live:** https://riverguide.clydeford.net (also https://riverguide.stevie-johnston.workers.dev)

- **Rivers first.** Every guidebook section (232) is listed and mapped with its linked SEPA gauge, current level, trend and an estimated status: *runnable*, *low*, *high* or *unknown*. The site works fully without the AI.
- **Assistant on top.** A chat (Claude Haiku 4.5) answers questions such as "what's running in the West Highlands?". It uses the same data as the pages, so the two never disagree.
- **Honest about uncertainty.** Paddling thresholds are mostly estimates derived from guidebook prose, and every status says whether it is an estimate, set manually, or only SEPA's typical range.

## Architecture

```
Browser (Vite, vanilla TS, Leaflet, uPlot)
   │  /api/*                           static assets (SPA)
   ▼
Cloudflare Worker (Hono) ── D1: gauges, sections, section_gauges, chat_usage, spend
   │        │                     ▲
   │        │                     └─ Cron */15: one bulk SEPA KiWIS call refreshes all ~400 gauges
   │        │                        Cron 03:00: gauge metadata + typical ranges
   │        ├─ Open-Meteo (edge-cached 30 min)
   │        └─ SEPA level history (edge-cached 15 min)
   └─ /api/chat ── Anthropic Messages API (streaming, tool use) → SSE to the browser
```

| Path | What |
|---|---|
| `src/worker/` | Worker: routes (`index.ts`), D1 access (`data.ts`), SEPA polling (`poll.ts`), weather, chat guardrails (`guard.ts`), chat loop/tools/prompt (`chat/`) |
| `src/shared/` | Code shared by the Worker, browser and scripts: API types, SEPA client, status rules, OS grid → WGS84 |
| `src/client/`, `index.html` | Browser app |
| `scripts/` | One-off data pipeline (below) |
| `migrations/` | D1 schema |
| `data/gauges.json` | SEPA gauge snapshot (OGL; committed) |
| `data/enrichment.json` | Per-section facts and gauge links/thresholds (committed, reviewable) |
| `data/overrides.json` | **Manual corrections; always win** |
| `data/private/` | Guidebook source text, enrichment cache, seed SQL (**gitignored**) |
| `legacy/` | The previous Docker-hosted version (Express backend + static frontend), kept for reference |

### API

`GET /api/config` · `GET /api/sections` · `GET /api/sections/:slug` · `GET /api/gauges/:no/history?period=P1D|P2D|P7D|P30D` · `GET /api/weather?lat&lon` · `POST /api/chat/session` · `POST /api/chat` (SSE). Types are in `src/shared/types.ts`.

### How a status is decided

Each section links to as many as 3 gauges. A link has a relation (on-section / upstream / downstream / proxy), optional thresholds (`min_level` = lowest runnable, `max_level` = too high), a basis and a confidence. The headline link is the first manual link; failing that, the most confident and closest link that has thresholds. Readings older than 3 hours count as *unknown*. Logic: `src/shared/status.ts`.

Basis:
- `guide`: the guidebook gives metres for that gauge.
- `duration`: the most common basis. The guidebook describes levels only in words ("needs a spate"), so that wording is matched to the gauge's **level-duration curve**: how often its daily maximum reaches each level over three years of SEPA data. "Needs a spate" might become "reached on about 10% of days", which is then converted to metres along that gauge's own curve. Still an estimate, but it is calibrated to how each river actually behaves.
- `typical-relative`: the fallback for the few gauges without enough history. The threshold is placed within SEPA's median annual min–max range.

Every gauge also reports `days_reached_pct`, the share of days on which its current level is reached. The river page shows this as "How often".
- `paddler`: levels set by paddlers on [Where's the Water](https://www.andyjacksonfund.org.uk/wheres-the-water/) (about 110 sections). Each gauge has six steps: scrapeable, low, medium, high, very high, huge. Runnable starts at scrapeable and too high starts at huge, and the current step is shown in the list and on the page.
- `community`: set from community level reports (below).
- `manual`: set by a person in `data/overrides.json`.

Precedence: **manual > community > paddler (Where's the Water) > estimate**.

## Community level reports

On each river page, under "Paddled it?", anyone can say how a section was: **too low · scrapy · good · pushy · too high**, plus a day, a time of day and an optional note. The Worker records the headline gauge's level at that time from SEPA history. Other people can respond with 👍 "Same for me" (adds weight) or 👎 "Not for me".

- **Community band.** Once a section has at least 5 reports from 3 people (distinct hashed IPs) on 2 different days, `src/shared/community.ts` sets the lower threshold where reports change from too low to runnable, and the upper threshold where they change from runnable to too high. A side with no evidence keeps the estimate. One-sided evidence can only move a threshold in the direction it supports. The band is stored in `community_bands` and overrides paddler levels and estimates, but never manual bands (see the precedence above). It shows as "community" in the list.
- **Disputed reports** stop counting when 3 or more people disagree and disagreements outnumber agreements.
- **Abuse controls.**
  - One Turnstile check per device, which issues a signed 1-year `rg_dev` cookie.
  - 10 writes per minute per IP.
  - 10 reports per IP per day.
  - One report per device per section per day.
  - Reports up to 7 days old only.
  - Votes are one per device, and you can't vote on your own report.
- **Reporting content.** A "Report note" link sits on each note. A note flagged 3 times is hidden. People can delete their own reports.
- **Kill switch.** Set `COMMUNITY_ENABLED` to `"false"` and redeploy.

Moderation (D1):

```sh
# recent reports
npx wrangler d1 execute riverguide --remote --command "SELECT id, slug, verdict, level, paddled_at, note, hidden FROM reports ORDER BY created_at DESC LIMIT 20"
# hide a report (then visit the section once, or vote, to recompute its band, or clear its band row)
npx wrangler d1 execute riverguide --remote --command "UPDATE reports SET hidden = 1 WHERE id = '<id>'; DELETE FROM community_bands WHERE slug = '<slug>'"
# hide every report from one device
npx wrangler d1 execute riverguide --remote --command "UPDATE reports SET hidden = 1 WHERE device = (SELECT device FROM reports WHERE id = '<id>')"
```

## Chat guardrails (public site)

1. Cloudflare Turnstile once, which issues a 2-hour signed session cookie.
2. A per-IP burst limit (6 per minute, Workers Rate Limiting).
3. A per-IP daily quota (`DAILY_MESSAGES_PER_IP`, default 40).
4. A site-wide daily spend cap (`DAILY_SPEND_CAP_USD`, default $3), metered from real token usage. When the cap is reached, chat pauses until midnight UTC and the river pages keep working.

A typical question costs about 1¢.

## Data and licensing

- **SEPA** level data: Open Government Licence v3.0.
- **Open-Meteo**: CC BY 4.0, free for non-commercial use (commercial use needs their paid plan).
- **OpenStreetMap** tiles and Nominatim geocoding: © OpenStreetMap contributors, ODbL.
- **Where's the Water** (Scottish Canoe Association; data maintained by Jonathan Riddell and contributors): its paddler level bands, 37 extra sections and scheduled release dates are used under **CC BY-SA 4.0** with attribution on the site. Our adaptation (`data/wtw-import.json`) is shared under the same licence; see `data/wtw/README.md`.
- **River section information** is derived from the [UK Rivers Guidebook](https://www.ukriversguidebook.co.uk). The full write-ups are community content, so the public site shows only short facts (grade, length, location, gauge) and links each section to its UKRGB page for hazards, access and route detail. The full text is used only server-side to ground the assistant. The assistant is told to summarise, never to quote. If UKRGB agree to wider use, set `SHOW_FULL_GUIDE_TEXT=true` and river pages will show it.
- The guidebook text is **not** in this repository (it lives in `data/private/`, which is gitignored). Earlier commits did include it.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars        # ANTHROPIC_API_KEY, SESSION_SECRET
npx wrangler d1 migrations apply riverguide --local
npx wrangler d1 execute riverguide --local --file data/private/seed.sql
npm run dev                            # http://localhost:5173
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"   # pull current levels
npm test && npm run typecheck
```

Without `TURNSTILE_SECRET` the chat session step skips verification, which is meant only for local dev.

## Data pipeline

The source is the scraped UKRGB Scotland dataset, which the previous version had already depersonalised: `data/private/scotland_rivers_clean.json`.

```sh
npm run data:gauges      # SEPA → data/gauges.json
npm run data:durations   # SEPA daily maxima, 3 years → data/gauge-durations.json (re-run yearly)
npm run data:sections    # source → data/private/sections.raw.json (slugs, grid refs → lat/lon)
npm run data:wtw         # Where's the Water (CC BY-SA 4.0) → data/wtw/, data/wtw-import.json (paddler levels, 37 extra sections, release dates)
npm run data:enrich      # Claude Sonnet 5.5 + Nominatim → data/enrichment.json  (~$3.50 for all 232; cached per section, resumable)
                         #   --relink redoes only the gauge links and thresholds (~$2.50)
npm run data:seed        # → data/private/seed.sql
npx wrangler d1 execute riverguide --remote --file data/private/seed.sql
```

The enrichment runs two passes per section:
1. Extract facts and put-in/take-out locations. A grid reference is used only if it literally appears in the text. Otherwise place names are geocoded and the result is marked approximate.
2. Choose gauges from a shortlist of nearby candidates and propose thresholds, each with a confidence and a one-line reason.

To redo one section, delete its cache file in `data/private/enrich-cache/`.

### Correcting a section (the most valuable maintenance)

Add to `data/overrides.json`, rebuild the seed, and apply it (numbers below are illustrative):

```json
{
  "sections": { "river-leny-a84-layby-to-lade-inn": { "grade_text": "3 (4)" } },
  "links": {
    "river-leny-a84-layby-to-lade-inn": [
      { "station_no": "14888", "relation": "on-section", "min_level": 0.95, "max_level": 1.8, "reason": "Local knowledge: scrapey below 0.95 m on Anie." }
    ]
  }
}
```

Manual links replace that section's estimated links and are shown as "set manually".

## Deploy

```sh
npm run deploy
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET      # any long random string
npx wrangler secret put TURNSTILE_SECRET    # from the Turnstile widget
npx wrangler secret put SEPA_API_KEY        # optional: SEPA API key (base64 credentials); without it, keyless access is used
```

Optional: set `AI_GATEWAY_URL` (for example `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`) to route Claude calls through Cloudflare AI Gateway for logs and analytics.
