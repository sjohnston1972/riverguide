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

See `server/README.md` for backend implementation notes.
