# River Guide - Scottish Rivers AI Assistant

A web-based AI chat assistant for Scottish whitewater paddlers. Ask about any Scottish river and get live conditions, grades, hazards, and access information — all in one place.

## Features

- **Live River Levels** — Real-time SEPA gauge readings and 24-hour trends
- **Weather Forecasts** — Current conditions, rainfall, and wind via Open-Meteo
- **River Grades & Hazards** — Whitewater grades, rapids, portages, and safety info
- **Access Points** — Put-in/take-out locations and logistics
- **Dark/Light Theme** — Toggle between themes
- **Conversational AI** — Multi-turn chat powered by Claude AI with tool use (MCP)

## How It Works

The frontend sends messages to a backend API (`/api/mcp/chat`) which orchestrates Claude AI with MCP tools to:

1. Look up detailed river guide data (grades, hazards, descriptions) from the UK Rivers Guidebook dataset
2. Query SEPA for real-time water levels and station data
3. Fetch weather forecasts for the river area
4. Combine everything into an informed, factual response

The frontend sends only the conversation (`{ "messages": [...] }`) — it does
not fetch or send a system prompt. See "API Contract" below for the full
request/response shape and the server-owned system prompt.

## Data

- **`scotland_rivers_detail.json`** — Comprehensive paddling guide data for Scottish rivers sourced from the UK Rivers Guidebook, including grades, hazards, access points, and descriptions
- **SEPA API** — Live river level and flow data (queried at runtime)
- **Open-Meteo** — Weather forecasts (queried at runtime)

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks)
- **AI:** Claude API with MCP tool use
- **Data Sources:** SEPA, Open-Meteo, UK Rivers Guidebook

## Running

A minimal reference/mock backend lives in `server/` and is enough to run the whole app locally, with no production credentials required.

```sh
cd server
node server.js       # or: npm start
```

Then open **http://localhost:3000** — the server serves the static frontend *and* implements `POST /api/mcp/chat`.

- **Mock mode (default):** if `ANTHROPIC_API_KEY` is not set, every chat request gets a canned response in the correct shape, so the UI can be exercised end to end offline. No SEPA/Open-Meteo/Claude credentials needed.
- **Live mode (optional):** set `ANTHROPIC_API_KEY` in your environment (never commit it) to proxy chat requests to the real Claude Messages API instead, using the system prompt from `prompt.txt`, which the server owns and loads at startup. Note: live mode calls the plain Messages API — it does not implement the `search_rivers` / `get_river_stations` / `get_station_levels` / `get_weather_forecast` / `get_river_guide` MCP tools described in `prompt.txt`; that integration is out of scope for this reference backend (see `server/README.md`).
- Optional: `PORT` (default `3000`) and `ANTHROPIC_MODEL` (default `claude-sonnet-4-5-20250929`) environment variables.

`server/` has zero npm dependencies (Node's built-in `http`/`https`/`fs` only), so no `npm install` step is required.

See `server/README.md` for backend implementation notes, and the API contract below for the exact request/response shapes.

## API Contract: `POST /api/mcp/chat`

This is the contract the frontend (`script.js`) speaks. The system prompt is **server-owned** — the client does not send one; the backend applies it (e.g. loaded server-side from `prompt.txt`).

### Request

```
POST /api/mcp/chat
Content-Type: application/json
```

Body:

```json
{
  "messages": [
    { "role": "user", "content": "What are the current levels on the River Etive?" }
  ]
}
```

- `messages` (required, array) — the running conversation, oldest first.
  - `role`: `"user"` or `"assistant"`.
  - `content` for a `"user"` message is a plain **string**.
  - `content` for an `"assistant"` message is the **raw `content` array** from a previous response (see below) — the client echoes it back verbatim as conversation history, it does not flatten it to a string.

### Success response

`200 OK`:

```json
{
  "content": [
    { "type": "text", "text": "Assistant reply text, in markdown-lite." }
  ]
}
```

- `content` is an array of typed blocks, mirroring the shape of the Claude Messages API response. The client only reads blocks where `type === "text"`, and joins their `text` fields with a blank line to build the rendered reply. Any other block types are present in the array but ignored by the client today.

### Error response

Any non-2xx status, with:

```json
{ "error": "Human-readable error message" }
```

The client reads `error` and shows it (or a generic status-based fallback) to the user as the assistant's message.

### Notes

- The five MCP tools referenced in `prompt.txt` (`search_rivers`, `get_river_stations`, `get_station_levels`, `get_weather_forecast`, `get_river_guide`) are the tools a full implementation of this endpoint is expected to call server-side before replying; they are not part of the HTTP contract itself and are invisible to the client.
- The reference backend in `server/` implements this contract in **mock mode** by default (canned `text` response, no tools called) and can optionally proxy to the real Claude Messages API — see "Running" above.
- `prompt.txt` must **not** be served as a public static asset. It ships in this repo for reference/version-control purposes; whoever deploys the frontend must keep it out of any publicly reachable static path (don't copy it into the directory a static file server exposes, or add a host-level deny rule for it), so the guardrail text isn't downloadable by visitors at a URL like `/prompt.txt`.

## Data Pipeline: Reword Script

`reword_rivers2.pl` reads `scotland_rivers_detail.json` and rewrites the guide prose fields (`where_is_it`, `water_level`, `general_description`, `other_notes`, `major_hazards`, `access_hassles`) to strip out first-person voice ("we paddled", "I think") and personal contributor names, producing a neutral, factual `scotland_rivers_detail_reworded.json`.

**Prerequisites:** Perl 5 with the core `JSON::PP` module (ships with modern Perl - no CPAN install needed).

**Run it:**

```sh
# Defaults: reads/writes the JSON files committed in the repo root
perl reword_rivers2.pl

# Or pass explicit paths
perl reword_rivers2.pl <input.json> <output.json>
```

**Verify the output before trusting it:** the rewrite is a long chain of regex substitutions over safety-relevant data (grades, hazards, access notes), so a change to the rules can silently delete more than intended. `verify_reword.pl` compares the rewritten output against the source field-by-field and flags any field that lost a suspicious amount of content:

```sh
perl verify_reword.pl                      # compares the repo's own before/after JSON
perl verify_reword.pl <original.json> <reworded.json>
perl verify_reword.pl --strict             # exit non-zero if anything is flagged (CI use)
```

It prints a warning per flagged field (river, field, characters lost) and a summary line. It doesn't fail the run by default - the rewrite legitimately removes some text - it's meant for a human to eyeball the flagged list after any change to the rewrite rules.
