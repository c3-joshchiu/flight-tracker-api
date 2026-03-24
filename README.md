# flight-tracker-api

C3 AI backend for the Flight Price Tracker. Monitors airline prices, detects
week-over-week trends, and exposes a RESTful API consumed by the
[flight-tracker-ui](../flightTrackerUi) frontend and any other HTTP client.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Consumers (UI, CLI, MCP, curl)                  │
│  ─── HTTP + JSON only ───                        │
├──────────────────────────────────────────────────┤
│  FlightSearchApi  (@restful BFF)                 │
│  Route table → thin handlers → entity methods    │
├──────────────────────────────────────────────────┤
│  FlightSearch / PriceSnapshot  (entity layer)    │
│  CRUD (js-server) · alerts (py) · scraping (py)  │
├──────────────────────────────────────────────────┤
│  CronJobs (C3 scheduler)                         │
│  scheduledPriceFetch (3×/day)                     │
└──────────────────────────────────────────────────┘
```

The API layer is a thin routing facade. All domain logic lives in the entity
types. See the [OpenAPI spec](openapi/flights-api.yaml) for the full contract.

## Endpoints

All paths are relative to `/<env>/<app>/flights`.

| Method | Path | Operation | Description |
|--------|------|-----------|-------------|
| GET | `/searches` | `listSearches` | List all flight searches |
| POST | `/searches` | `createSearch` | Create a new search |
| GET | `/searches/{id}` | `getSearch` | Get a search by ID |
| PATCH | `/searches/{id}` | `updateSearch` | Toggle search status (active/disabled) |
| DELETE | `/searches/{id}` | `deleteSearch` | Delete search and all its snapshots |
| GET | `/searches/{id}/alert` | `getAlert` | Price trend alert (red/green/grey) |
| GET | `/searches/{id}/prices` | `getPrices` | Price history (optional `?seatClass=economy\|business`) |
| GET | `/searches/{id}/latest-price` | `getLatestPrice` | Most recent economy snapshot |
| POST | `/searches/{id}/fetch` | `triggerFetch` | Scrape Google Flights for live prices |
| GET | `/export` | `exportData` | Export all non-seed data (`?format=csv\|json`) |
| GET | `/export/searches` | `exportSearches` | Export searches only |
| GET | `/export/snapshots` | `exportSnapshots` | Export snapshots (`?searchId=X`) |
| PUT | `/import` | `importData` | Idempotent bulk import with natural key dedup |

## Entity Types

### FlightSearch

Stores flight search criteria and status.

| Field | Type | Notes |
|-------|------|-------|
| `fromAirport` | `!string` | IATA code (e.g. LAX) |
| `toAirport` | `!string` | IATA code (e.g. NRT) |
| `tripType` | `!string` | `one-way` or `round-trip` |
| `outboundDate` | `!datetime` | Departure date |
| `returnDate` | `datetime` | Return date (round-trip only) |
| `maxStops` | `int` | Max stops filter |
| `passengersAdults` | `int` | Default 1 |
| `currency` | `string` | Default USD |
| `searchStatus` | `string` | `active` or `disabled` |

**Methods:** `getAll`, `getById`, `createSearch`, `updateSearchStatus`,
`deleteSearch` (js-server); `computeAlert` (py); `getLatestPrice` (js-server)

### PriceSnapshot

A single price data point for a search, captured at a point in time.

| Field | Type | Notes |
|-------|------|-------|
| `flightSearch` | `!FlightSearch` | Parent search |
| `seatClass` | `!string` | `economy` or `business` |
| `price` | `!int` | Price in cents (85000 = $850) |
| `airlineCodes` | `[string]` | IATA airline codes |
| `airlineNames` | `[string]` | Full airline names |
| `flightType` | `string` | "direct", "1 stop", etc. |
| `durationMinutes` | `int` | Flight duration |
| `fetchedAt` | `!datetime` | When price was scraped |

**Methods:** `getHistory` (js-server); `fetchNow` (py — scrapes Google Flights)

### FlightSearchScheduler

Invoked by the `scheduledPriceFetch` CronJob. Iterates all active searches and
calls `PriceSnapshot.fetchNow` for each, catching per-search errors so one
failure doesn't block the rest.

**Methods:** `runScheduledSnapshots` (js-server)

### DataExport

Static utility type for exporting and importing flight tracker data.
Handles serialization to CSV/JSON and idempotent import with
natural key deduplication.

**Methods:** `exportAll`, `exportSearches`, `exportSnapshots`, `toCsv`,
`importAll` (all js-server)

**Export formats:**

| Format | Content-Type | Generated where |
|--------|-------------|-----------------|
| JSON | `application/json` | Backend |
| CSV | `text/csv` | Backend (two-section with `# SEARCHES` / `# SNAPSHOTS`) |
| XLSX | N/A | Frontend (SheetJS from JSON data) |

**Import:** Uses natural keys (not entity IDs) for deduplication.
Conflict strategies: `skip` (default), `overwrite`, `error`.

## Cron Jobs

Seeded via `seed/CronJob/`. Active on first provision.

| Job | Schedule (UTC) | Action | Purpose |
|-----|---------------|--------|---------|
| `scheduledPriceFetch` | 00:00, 08:00, 16:00 | `FlightSearchScheduler.runScheduledSnapshots` | Automated price scraping for all active searches |

## Project Structure

```
flightPriceTrackerApi/
├── flightPriceTrackerApi.c3pkg.json
├── src/
│   ├── FlightSearch.c3typ
│   ├── FlightSearch.js           # getAll, getById, createSearch, updateSearchStatus, deleteSearch, getLatestPrice
│   ├── FlightSearch.py           # computeAlert (14-day trend analysis, Google Flights URL builder)
│   ├── PriceSnapshot.c3typ
│   ├── PriceSnapshot.js          # getHistory
│   ├── PriceSnapshot.py          # fetchNow (Google Flights scraper)
│   ├── FlightSearchScheduler.c3typ
│   ├── FlightSearchScheduler.js  # runScheduledSnapshots (cron-driven price fetch)
│   ├── FlightSearchApi.c3typ     # @restful(endpoint='flights')
│   └── FlightSearchApi.js        # Route table, handlers, response helpers
├── seed/
│   ├── CronJob/
│   │   └── scheduledPriceFetch.json
│   ├── FlightSearch/FlightSearch.json
│   └── PriceSnapshot/PriceSnapshot.json

openapi/
└── flights-api.yaml              # OpenAPI 3.1 — source of truth for the REST surface

scripts/
└── validate-openapi.sh           # Spectral lint + oasdiff breaking change check

refresh_seed.py                   # Roll PriceSnapshot seed dates forward (run before re-provision)
```

## Development

### Prerequisites

- Access to a C3 AI environment
- C3 CLI or VS Code extension for provisioning

### Provision and verify

1. **(Optional)** Refresh seed snapshot dates so alerts compute correctly:

```bash
python refresh_seed.py
```

2. Provision the `flightPriceTrackerApi` package to your C3 environment.
   `App#afterStart` automatically runs `UserGroup.upsertSeededGroups()` to
   seed the `FlightApi.Client` role. The `scheduledPriceFetch` `CronJob`
   is provisioned from seed data automatically.

3. Verify seed data in the C3 console:

```javascript
FlightSearch.getAll()   // should return 3 seeded searches
```

4. Verify the cron job is active:

```javascript
CronJob.get('scheduledPriceFetch')   // 3x daily price fetch
```

5. **(One-time)** Register an OAuth client for API consumers — see
   [`../secret-config.md`](../secret-config.md) for the full steps.

6. Verify REST endpoints via curl:

```bash
CLIENT_ID="<your_client_id>"
CLIENT_SECRET="<your_client_secret>"
BASE="https://<cluster>/<env>/flightpricetrackerapi"

TOKEN=$(curl -sf -X POST "${BASE}/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" "${BASE}/flights/searches" | python3 -m json.tool
```

See [`integration-guide.md`](integration-guide.md) for the full auth
handshake and C3-specific quirks.

### Validate the OpenAPI spec

```bash
./scripts/validate-openapi.sh
```

Requires [Spectral](https://github.com/stoplightio/spectral) (`npm i -g @stoplight/spectral-cli`)
and [oasdiff](https://github.com/Tufin/oasdiff) (`brew install oasdiff`).

## API Contract Workflow

This repo **owns** the OpenAPI spec. Any endpoint change starts with a spec change.

```
openapi/flights-api.yaml   (this repo — source of truth)
       │
       ├──→  flightTrackerUi      pulls spec, runs openapi-typescript, generates typed client
       ├──→  agent / MCP server   pulls spec, generates Python/JS client
       └──→  CI                   validates implementation matches spec
```

Consumer repos pull the spec and generate typed clients. Breaking changes are
detected by `oasdiff` in CI before they reach consumers.

**After changing the spec**, sync the UI repo:

```bash
cd ../flightTrackerUi
bash flightPriceTrackerUi/react/scripts/generate-client.sh
```

The script mirrors the spec, regenerates TypeScript types, and runs `tsc` to
surface any breaking changes. See the
[UI README](../flightTrackerUi/README.md#updating-api-types) for details.

## Related

- [flight-tracker-ui](../flightTrackerUi) — React frontend (BFF proxy)
- [OpenAPI spec](openapi/flights-api.yaml) — full API contract
- [Integration guide](integration-guide.md) — auth flow, C3 quirks, error recovery
- [OAuth setup](../secret-config.md) — one-time credential provisioning
