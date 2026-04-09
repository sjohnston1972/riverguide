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

Serve the frontend with any static file server. The backend API endpoint (`/api/mcp/chat`) must be configured separately to handle Claude AI requests with MCP tools for SEPA, weather, and river guide lookups.
