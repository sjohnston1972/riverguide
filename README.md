# River Guide

Which Scottish whitewater rivers are likely to be running, from live SEPA gauges, levels set by paddlers, reports from people who have just paddled, scheduled dam releases and the weather forecast. Runs entirely on Cloudflare (a Worker, D1 and static assets).

**Live:** https://riverguide.clydeford.net (also https://riverguide.stevie-johnston.workers.dev)

## What it does

- **Rivers list and map** (`/`, `/map`). 269 sections (232 from the guidebook dataset, 37 more from Where's the Water), each with its headline gauge, current level, trend, a two-day sparkline running on into tomorrow's outlook, and a status: *runnable*, *low*, *high* or *unknown*. Filters (search, region, grade, status, rising, favourites) are kept in the URL and shared by the list and the map.
- **River pages** (`/river/:slug`). A gauge board showing the level against the paddling band and the paddler steps, a level graph (1 day to 30 days) with rain bars, the forecast rain and the level outlook, a 48-hour rain chart, the weather, how often the current level is reached, every linked gauge, and community reports.
- **Level outlook.** Where each gauge's daily peak is likely to be tomorrow and the day after, with a likely range, for gauges whose model passed testing. Other gauges show a direction only. A daily job checks the outlooks against what the rivers did and corrects each gauge over time (below).
- **Dam releases** (`/releases`). Every release in SSE's freshet schedule, which SEPA publishes each year, refreshed daily.
- **Falls of Lora** (`/falls-of-lora`). Ebb windows predicted from a harmonic tide model fitted to SEPA's Oban tide gauge.
- **Community reports.** "Paddled it?" on each river page: how it was, at what time, with votes and flags. Enough reports set a community band.
- **Favourites**, light and dark themes, and an installable app that still opens offline with the last levels seen (`public/sw.js`, `public/manifest.webmanifest`).
- **Feedback and bugs form** on the About page, raised as issues in a private GitHub repo.
- **Chat assistant** (Claude Haiku 4.5, streaming with tool use over the same data as the pages). **Switched off** on the live site (`CHAT_ENABLED="false"`); the code and its guardrails are kept.

It is honest about uncertainty: every band says where it came from (set manually, community, paddler levels or an estimate), and the site works fully without the assistant.

## Architecture

```
Browser (Vite, vanilla TS, Leaflet, uPlot; service worker for offline)
   │  /api/*                           static assets (SPA)
   ▼
Cloudflare Worker (Hono) ── D1 "riverguide"
   │   ├─ Cron */15        one bulk SEPA KiWIS pass: levels, SEPA trends, hourly rain → outlooks; purges the list cache
   │   ├─ Cron 03:00       gauge metadata and typical ranges, dam release schedule, prune chat usage
   │   ├─ Cron 07:15 UK    outlook learning: snapshot, check against SEPA daily peaks, re-learn corrections
   │   ├─ SEPA level history (edge-cached), Open-Meteo weather and rain (edge-cached)
   │   ├─ /api/feedback ── GitHub Issues API (private repo)
   │   └─ /api/chat ── Anthropic Messages API → SSE (off)
   └─ Section list and pages served from the edge cache, purged when levels, reports or releases change
```

The 07:15 job is scheduled at both 06:15 and 07:15 UTC (`15 6,7 * * *`) and only the run that is 07:15 in the UK does the work, so it follows BST and GMT.

| Path | What |
|---|---|
| `src/worker/` | Worker: routes and crons (`index.ts`), D1 to API objects (`data.ts`), SEPA polling (`poll.ts`), outlooks (`outlook.ts`), outlook learning (`learning.ts`), community reports (`community.ts`), dam releases (`freshets.ts`, `schedules.ts`), weather and rain (`weather.ts`), edge cache (`edgecache.ts`), feedback (`feedback.ts`), chat guardrails (`guard.ts`) and chat (`chat/`) |
| `src/shared/` | Code shared by the Worker, browser and scripts: API types, SEPA client, status rules, level-duration curves, outlook models and learning, community bands, tides, freshet spreadsheet reader, OS grid → WGS84 |
| `src/client/`, `index.html` | Browser app: pages (`pages/`), gauge board, graph, sparkline, rain chart, map, filters |
| `public/` | Icons, fonts, web manifest, service worker |
| `scripts/` | Offline data pipeline and reports (below) |
| `migrations/` | D1 schema (0001–0013) |
| `test/` | Vitest unit and Worker tests |
| `data/gauges.json` | SEPA gauge snapshot (OGL) |
| `data/gauge-durations.json` | Level-duration curves from three years of SEPA daily maxima |
| `data/gauge-forecast.json` | Outlook models per gauge, with their validation |
| `data/oban-tide.json` | Harmonic tide constants for Oban |
| `data/enrichment.json` | Per-section facts and gauge links/thresholds (reviewable) |
| `data/wtw-import.json`, `data/wtw/` | Where's the Water import (CC BY-SA 4.0) |
| `data/overrides.json` | **Manual corrections; always win** |
| `data/private/` | Guidebook source text, enrichment cache, seed SQL (**gitignored**) |
| `legacy/` | Earlier versions kept for reference: `v1-static` (static frontend and Express backend) and `docker-mcp` (the Docker-hosted server) |

### D1 tables

`gauges` (metadata, latest reading, trend, last 48 hours, rain, outlook model, outlook, learned corrections) · `sections` · `section_gauges` (links and bands) · `reports`, `report_votes`, `report_flags`, `community_bands` · `releases` (Where's the Water release dates) · `freshets` (SEPA's dam release schedule) · `outlook_snapshots` · `chat_usage`, `spend`.

### API

| Route | What |
|---|---|
| `GET /api/health` | 503 when the 15-minute poll has stopped bringing in readings (for an uptime monitor) |
| `GET /api/config` | Public switches: chat, community, feedback, Turnstile site key |
| `GET /api/sections`, `GET /api/sections/:slug` | List and one section (edge-cached) |
| `GET /api/gauges/:no/history?period=P1D\|P2D\|P7D\|P30D` | Level history from SEPA |
| `GET /api/gauges/:no/rain?period=…` | Hourly rain at the gauge, past and forecast |
| `GET /api/weather?lat&lon` | Forecast (Scotland only) |
| `GET /api/releases`, `GET /api/tides/lora` | Dam releases; Falls of Lora ebbs |
| `GET/POST /api/sections/:slug/reports`, `POST /api/community/verify`, `POST /api/reports/:id/vote`, `POST /api/reports/:id/flag`, `DELETE /api/reports/:id` | Community reports |
| `POST /api/feedback` | Feedback form |
| `POST /api/chat/session`, `POST /api/chat` (SSE) | Chat (503 while switched off) |

Types are in `src/shared/types.ts`.

## How a status is decided

Each section links to as many as 3 gauges. A link has a relation (on-section / upstream / downstream / proxy), optional thresholds (`min_level` = lowest runnable, `max_level` = too high), a basis and a confidence. The headline link is chosen by basis first (manual, community, paddler, estimate), then confidence, then how close the gauge is. Readings older than 3 hours count as *unknown*. Logic: `src/shared/status.ts`.

Where a gauge has paddler steps (scrape, low, medium, high, very high, huge), **very high and huge always count as too high**, whatever the band's basis, so every high river looks the same on the list and map. Where's the Water itself only calls huge too high.

Basis, in order of precedence (**manual > community > paddler > estimate**):

- `manual`: set by a person in `data/overrides.json`.
- `community`: set from community level reports (below).
- `paddler`: levels set by paddlers on [Where's the Water](https://www.andyjacksonfund.org.uk/wheres-the-water/) (about 110 sections). Runnable is scrape to high, and the current step is shown in the list and on the page.
- Estimates:
  - `guide`: the guidebook gives metres for that gauge.
  - `duration`: the most common estimate. The guidebook describes levels only in words ("needs a spate"), so that wording is matched to the gauge's **level-duration curve**: how often its daily maximum reaches each level over three years of SEPA data. "Needs a spate" might become "reached on about 10% of days", which is then converted to metres along that gauge's own curve.
  - `typical-relative`: the fallback for the few gauges without enough history. The threshold is placed within SEPA's median annual min–max range.

Every gauge also reports `days_reached_pct`, the share of days on which its current level is reached, shown as "How often" on the river page.

Trend (rising, falling, steady) is SEPA's own indicator for the gauge when it is current, otherwise the change over the last hour.

## Level outlook

`scripts/fit-forecast.ts` builds an analogue model per gauge: for a grid of situations (today's peak, rain today, rain tomorrow and, for most gauges, the change since yesterday) it stores how much the daily peak changed on the most similar past days (median, and 10th/90th percentiles for the likely range). Each gauge is tested season by season on days the model hasn't seen, and only gauges that clearly beat "tomorrow will be the same as today", and do no worse on wet days, get numbers. The rest show a direction from the trend and the rain due. Every 15-minute poll interpolates the grid with Open-Meteo's rain for the gauge and stores the result on the gauge row (`src/worker/outlook.ts`).

### Outlook learning

Each morning at 07:15 UK time (`src/worker/learning.ts`, method in `src/shared/learning.ts`):

1. **Snapshot** every gauge's outlook (the raw model prediction, its inputs and what the site showed) into `outlook_snapshots`.
2. **Check** earlier snapshots against the daily peaks SEPA has since published (a day's peak appears 1–2 days later).
3. **Re-learn**, per gauge and separately for tomorrow and the day after, over the last 90 checked days: a bias correction (a shrunk median of the errors, tested prequentially) and a scale for the likely range (by interval score, aiming for about 80% of peaks inside it). Corrections switch on only after 20 checked days to train on and 10 more to test, and only when they beat the uncorrected model by a margin. A gauge whose outlook does worse than "the peak stays where it is" is demoted to a direction only, and is promoted again once it recovers.

Corrections are stored in `gauges.learned` and applied on the next poll. With daily snapshots, the first corrections can appear about five weeks after a gauge starts being checked.

```sh
npm run data:learning     # per gauge: checked days, live skill, range coverage, and what has been switched on
```

## Community level reports

On each river page, under "Paddled it?", anyone can say how a section was: **too low · scrapy · good · pushy · too high**, plus a day, a time of day and an optional note. The Worker records the headline gauge's level at that time from SEPA history. Other people can respond "Same for me" (adds weight) or "Not for me".

- **Community band.** Once a section has at least 5 reports from 3 people (distinct hashed IPs) on 2 different days, `src/shared/community.ts` sets the lower threshold where reports change from too low to runnable, and the upper threshold where they change from runnable to too high. A side with no evidence keeps the estimate. One-sided evidence can only move a threshold in the direction it supports, and only as far as at least two people agree. The band is stored in `community_bands` and overrides paddler levels and estimates, but never manual bands.
- **Disputed reports** stop counting when 3 or more people disagree and disagreements outnumber agreements. "Same for me" adds weight per person, at most +3, and never from the author's own connection.
- **Abuse controls.**
  - One Turnstile check per device, which issues a signed 1-year `rg_dev` cookie.
  - 10 writes per minute per IP.
  - 10 reports per IP per day.
  - One report per device per section per day.
  - Reports up to 7 days old only.
  - Votes are one per person, and you can't vote on your own report.
- **Reporting content.** A "Report note" link sits on each note. A note flagged by 3 people is hidden. People can delete their own reports.
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

## Feedback form

The About page's "Feedback and bugs" form (`/about#feedback`) raises an issue in the private repo set by `FEEDBACK_REPO` (`sjohnston1972/riverguide-feedback`), labelled bug, idea or feedback, plus `from-site`. Each message passes a Turnstile check and the community rate limit. The issue includes the page the person came from, their browser and screen size, a hashed IP and their email if they gave one; `@` mentions are neutralised. The Worker needs the `GITHUB_FEEDBACK_TOKEN` secret: a fine-grained token with Issues read/write on that repo only. Without it the form is hidden.

## Privacy

There is no tracking or analytics, so there is no cookie banner. The About page's "Privacy and cookies" section (`/about#privacy`, linked from the footer and the terms) says what is stored and for how long. Requests go to privacy@clydeford.net, forwarded by Cloudflare Email Routing. The promises it makes that need upkeep:

- Feedback issues are deleted within 12 months of being dealt with (by hand: the Worker's token can't delete issues).
- Chat usage rows are deleted after two days (the 03:00 cron).

## Chat guardrails

The chat is off on the live site. When `CHAT_ENABLED` is `"true"`:

1. Cloudflare Turnstile once, which issues a 2-hour signed session cookie.
2. A per-IP burst limit (6 per minute, Workers Rate Limiting).
3. A per-IP daily quota (`DAILY_MESSAGES_PER_IP`, default 40).
4. A site-wide daily spend cap (`DAILY_SPEND_CAP_USD`, default $3), metered from real token usage. When the cap is reached, chat pauses until midnight UTC and the river pages keep working.

A typical question costs about 1¢. Set `AI_GATEWAY_URL` (for example `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`) to route Claude calls through Cloudflare AI Gateway.

## Data and licensing

- **SEPA** level data, freshet schedule and tide gauge: Open Government Licence v3.0.
- **Open-Meteo**: CC BY 4.0, free for non-commercial use (commercial use needs their paid plan).
- **OpenStreetMap** tiles and Nominatim geocoding: © OpenStreetMap contributors, ODbL.
- **Where's the Water** (Scottish Canoe Association; data maintained by Jonathan Riddell and contributors): its paddler level bands, 37 extra sections and scheduled release dates are used under **CC BY-SA 4.0** with attribution on the site. Our adaptation (`data/wtw-import.json`) is shared under the same licence; see `data/wtw/README.md`.
- **Meteocons** weather icons by Bas Milius: MIT.
- **River section information** is derived from the [UK Rivers Guidebook](https://www.ukriversguidebook.co.uk). The full write-ups are community content, so the public site shows only short facts (grade, length, location, gauge) and links each section to its UKRGB page for hazards, access and route detail. The full text is used only server-side to ground the assistant, which is told to summarise, never to quote. If UKRGB agree to wider use, set `SHOW_FULL_GUIDE_TEXT=true` and river pages will show it. The guidebook text is **not** in this repository (it lives in `data/private/`, which is gitignored).

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

Without `TURNSTILE_SECRET`, Turnstile checks are skipped, which is meant only for local dev. CI (`.github/workflows/ci.yml`) runs typecheck, tests and a build on every push to main and on pull requests.

## Data pipeline

The source is the UKRGB Scotland dataset, depersonalised by the previous version: `data/private/scotland_rivers_clean.json`.

In dependency order (`npm run data:all` runs them all; with the enrichment cache in place `data:enrich` costs nothing):

```sh
npm run data:gauges      # SEPA → data/gauges.json
npm run data:durations   # SEPA daily maxima, 3 years → data/gauge-durations.json (re-run yearly)
npm run data:sections    # source → data/private/sections.raw.json (slugs, grid refs → lat/lon)
npm run data:enrich      # Claude Sonnet 5.5 + Nominatim → data/enrichment.json  (~$3.50 for all 232; cached per section, resumable)
                         #   --relink redoes only the gauge links and thresholds (~$2.50)
npm run data:wtw         # Where's the Water (CC BY-SA 4.0) → data/wtw/, data/wtw-import.json (paddler levels, 37 extra sections, release dates); reads enrichment.json
npm run data:forecast    # level-outlook models → data/gauge-forecast.json; reads enrichment.json and wtw-import.json
npm run data:seed        # → data/private/seed.sql; stops on a missing input, an invalid overrides.json or an inverted band
npx wrangler d1 execute riverguide --remote --file data/private/seed.sql
```

Separately:

```sh
npm run data:tides       # Oban tide gauge → data/oban-tide.json (Falls of Lora); compiled into the Worker, so redeploy after
npm run icons            # media/riverguide_logo.png → public/icons (light and dark variants)
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

Manual links replace that section's estimated links and are shown as "set manually". A manual link on a gauge that Where's the Water has calibrated keeps its paddler step ladder (and very high still counts as too high); add `"levels": { "scrape", "low", "medium", "high", "very_high", "huge" }` (where each step starts, ascending) to set your own ladder instead.

To apply one section's correction without a full reseed, take its `section_gauges` lines from the seed:

```sh
S=river-leny-a84-layby-to-lade-inn
{ echo "DELETE FROM section_gauges WHERE slug = '$S';"; grep "INTO section_gauges" data/private/seed.sql | grep "('$S'"; } > data/private/one-section.sql
npx wrangler d1 execute riverguide --remote --file data/private/one-section.sql
```

## Deploy

```sh
npx wrangler d1 migrations apply riverguide --remote   # before deploying code that needs a new migration
npm run deploy                                          # vite build && wrangler deploy
```

Secrets (`npx wrangler secret put <name>`):

| Secret | What |
|---|---|
| `SESSION_SECRET` | Any long random string: signs cookies and hashes IPs |
| `TURNSTILE_SECRET` | From the Turnstile widget (reports, votes, feedback, chat) |
| `GITHUB_FEEDBACK_TOKEN` | Fine-grained token, Issues read/write on the feedback repo only |
| `ANTHROPIC_API_KEY` | Only needed with chat switched on |
| `SEPA_API_KEY` | Optional SEPA API key (base64 credentials); without it, keyless access is used |

Switches and settings are `vars` in `wrangler.jsonc`: `CHAT_ENABLED`, `COMMUNITY_ENABLED`, `FEEDBACK_REPO`, `SHOW_FULL_GUIDE_TEXT`, `TURNSTILE_SITE_KEY`, `DAILY_SPEND_CAP_USD`, `DAILY_MESSAGES_PER_IP`, `AI_GATEWAY_URL`.
