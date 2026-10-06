# River Guide reference/mock backend

A minimal local-dev backend for River Guide. It has **zero npm dependencies**
(Node core `http`/`https`/`fs` only), so there is no `npm install` step —
just run it.

```sh
node server.js
# or
npm start
```

Serves the repo's static frontend files and implements `POST /api/mcp/chat`
per the contract documented in the top-level `README.md`.

## Modes

- **Mock mode (default)** — no credentials required. Returns a canned
  `{ content: [ { type: "text", text: ... } ] }` response so the UI can be
  exercised offline. This is the minimum bar for local dev: clone, run,
  chat, see a reply.
- **Live mode (optional)** — set `ANTHROPIC_API_KEY` in your environment
  (there is no default or fallback key anywhere in this repo) to proxy chat
  requests to the real Claude Messages API instead, using the system prompt
  loaded server-side from `prompt.txt`. This talks to the plain Messages
  API only — it does **not** implement the `search_rivers`,
  `get_river_stations`, `get_station_levels`, `get_weather_forecast`, or
  `get_river_guide` MCP tools described in `prompt.txt`. Wiring those tools
  up (SEPA, Open-Meteo, the river guide dataset) is out of scope for this
  reference backend; see issue #5 for the umbrella tracking that work.

## Environment variables

| Variable            | Required | Default                          | Purpose                                   |
| -------------------- | -------- | --------------------------------- | ------------------------------------------ |
| `PORT`               | no       | `3000`                            | Port to listen on                          |
| `ANTHROPIC_API_KEY`  | no       | *(unset — stays in mock mode)*    | Enables live mode when set                 |
| `ANTHROPIC_MODEL`    | no       | `claude-sonnet-4-5-20250929`      | Model used in live mode                    |

No secret is committed anywhere in this repo; `ANTHROPIC_API_KEY` is read
from the environment only.

## Testing the error path

Mock mode returns `400 { "error": ... }` for a missing/empty `messages`
array or invalid JSON, and `500 { "error": ... }` for a message whose text
contains `__force_error__` (handy for exercising the client's error
handling without needing a live backend failure).
