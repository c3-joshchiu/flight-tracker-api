# Flight Price Tracker API — Technical Documentation

## Overview

Backend service that tracks airline flight prices over time using Google Flights
data, detects week-over-week price trends, and exposes a RESTful API for any
HTTP consumer. Built as a C3 AI Platform package (`flightPriceTrackerApi`).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Consumers (React UI, CLI, MCP, curl)                    │
│  ─── HTTP + JSON only ───                                │
├──────────────────────────────────────────────────────────┤
│  FlightSearchApi  (@restful endpoint, js-server)          │
│  Route table → thin handlers → entity methods            │
│  ─── translates HTTP verbs to entity method calls ───    │
├──────────────────────────────────────────────────────────┤
│  Entity Layer                                            │
│  FlightSearch (js-server CRUD, py alerts)                │
│  PriceSnapshot (js-server queries, py scraping)          │
│  ─── C3 managed persistence, auth, caching ───           │
├──────────────────────────────────────────────────────────┤
│  External Integration                                    │
│  Google Flights (protobuf URL encoding, HTML scraping)   │
└──────────────────────────────────────────────────────────┘
```

The API layer is a thin routing facade — all domain logic lives in the entity
types. The [OpenAPI spec](openapi/flights-api.yaml) is the single source of
truth for the REST surface.

## Entity Types

### FlightSearch

Tracks a flight route being monitored.

| C3 Field | Type | Notes |
|----------|------|-------|
| `id` | `string` (auto) | C3 auto-generates |
| `fromAirport` | `!string` | IATA code (e.g., "LAX") |
| `toAirport` | `!string` | IATA code (e.g., "NRT") |
| `tripType` | `!string enum("one-way","round-trip")` | |
| `outboundDate` | `!datetime` | |
| `returnDate` | `datetime` | Nullable, only for round-trip |
| `maxStops` | `int` | |
| `passengersAdults` | `int` | Default 1 |
| `language` | `string` | Default "en-US" |
| `currency` | `string` | Default "USD" |
| `searchStatus` | `string enum("active","disabled")` | Named to avoid reserved word `status` |
| `isTestData` | `boolean` | True for seeded data |
| `snapshots` | `[PriceSnapshot](flightSearch)` | Inverse relationship |
| `meta.created` | `datetime` | C3 auto-managed |
| `meta.updated` | `datetime` | C3 auto-managed |

### PriceSnapshot

Records a price observation for a given FlightSearch at a point in time.

| C3 Field | Type | Notes |
|----------|------|-------|
| `id` | `string` (auto) | |
| `flightSearch` | `!FlightSearch` | C3 entity reference |
| `seatClass` | `!string enum("economy","business")` | |
| `price` | `!int` | In cents (85000 = $850) |
| `airlineCodes` | `[string]` | Native array of IATA codes (e.g., `["CI","AA"]`) |
| `airlineNames` | `[string]` | Native array of airline names |
| `flightType` | `string` | "direct", "1 stop", etc. |
| `durationMinutes` | `int` | |
| `fetchedAt` | `!datetime` | When the price was scraped |

### FlightSearchScheduler

Scheduler that triggers periodic price fetches for all active flight searches.

| C3 Field | Type | Notes |
|----------|------|-------|
| `runScheduledSnapshots` | `function` | js-server, called by `scheduledPriceFetch` CronJob |

## Entity Methods

| Type | Method | Runtime | Purpose |
|------|--------|---------|---------|
| `FlightSearch` | `getAll()` | js-server | List all searches ordered by `meta.created` descending |
| `FlightSearch` | `getById(searchId)` | js-server | Single search by ID |
| `FlightSearch` | `createSearch(data)` | js-server | Create new search from JSON |
| `FlightSearch` | `updateSearchStatus(id, status)` | js-server | Toggle active/disabled |
| `FlightSearch` | `deleteSearch(searchId)` | js-server | Delete search + all snapshots |
| `FlightSearch` | `getLatestPrice(searchId)` | js-server | Most recent economy snapshot |
| `FlightSearch` | `computeAlert(searchId)` | py | 14-day trend analysis |
| `PriceSnapshot` | `getHistory(searchId, seatClass)` | js-server | Price history, optionally filtered |
| `PriceSnapshot` | `fetchNow(searchId)` | py | Scrape Google Flights live |
| `FlightSearchScheduler` | `runScheduledSnapshots()` | js-server | Fetch prices for all active searches |

## REST API → Entity Method Mapping

`FlightSearchApi` uses `@restful(endpoint='flights')` with the `Restful` mixin.
The `handle` method routes by HTTP verb and path pattern:

| HTTP | Endpoint | Entity Method | Notes |
|------|----------|---------------|-------|
| `GET` | `/flights/searches` | `FlightSearch.getAll()` | |
| `POST` | `/flights/searches` | `FlightSearch.createSearch(body)` | JSON body |
| `GET` | `/flights/searches/:id` | `FlightSearch.getById(id)` | |
| `PATCH` | `/flights/searches/:id` | `FlightSearch.updateSearchStatus(id, body.searchStatus)` | JSON body |
| `DELETE` | `/flights/searches/:id` | `FlightSearch.deleteSearch(id)` | Empty response |
| `GET` | `/flights/searches/:id/alert` | `FlightSearch.computeAlert(id)` | |
| `GET` | `/flights/searches/:id/prices` | `PriceSnapshot.getHistory(id, seatClass)` | Optional `?seatClass=` query param |
| `GET` | `/flights/searches/:id/latest-price` | `FlightSearch.getLatestPrice(id)` | |
| `POST` | `/flights/searches/:id/fetch` | `PriceSnapshot.fetchNow(id)` | |

The `@restful` annotation only supports GET and POST natively. PATCH and DELETE
are supported via the `Restful` mixin's `handle` method, which inspects
`req.method` and routes manually through a route table.

### Response Helpers

| Helper | When to use |
|--------|-------------|
| `req.responseFromValue(v)` | Returning C3 typed values (entities, collections) — serializes DateTime, collections correctly |
| `req.responseFromText(s)` | Returning plain JSON (error objects, ad-hoc maps) |
| `req.emptyResponse()` | DELETE or void operations — returns HTTP 200 with empty body |

### Error Responses

All errors return a consistent shape:

```json
{ "error": "Human-readable message", "status": 400 }
```

| Status | When |
|--------|------|
| 200 | Success (including empty body for DELETE) |
| 400 | Missing required fields, invalid enum values |
| 404 | Entity not found by ID |
| 500 | Unhandled exception (caught by top-level try/catch) |

## Alert Algorithm

Alerts are computed on-demand by `FlightSearch.computeAlert()` (Python) from
economy PriceSnapshot records over the last 14 days.

| Alert | Condition | Response |
|-------|-----------|----------|
| **Grey** | Fewer than 7 days of data, or no significant change | `status: "grey"`, "Monitoring..." |
| **Red** | 5+ of 7 current-week daily prices exceed the previous week | `status: "red"`, "Price Rising" |
| **Green** | Current week average is 20%+ lower than previous week | `status: "green"`, "Price Drop! N% lower" |

### Algorithm Steps

1. Fetch economy snapshots from the last 14 days
2. Group by date, compute daily minimum price
3. Sort days chronologically
4. If fewer than 7 days → **grey** ("collecting data")
5. Split into current week (last 7 days) and previous week
6. If no previous week data → **grey** ("need more history")
7. Compute averages for both weeks
8. Count `daysRising`: days where current week daily min > previous week daily min (aligned from end)
9. Compute `pctChange = ((currentAvg - previousAvg) / previousAvg) * 100`
10. If `daysRising >= 5` → **red**
11. If `pctChange <= -20` → **green**
12. Otherwise → **grey** ("stable")

Each alert also returns: `currentWeekAvg`, `previousWeekAvg`, `percentChange`,
`daysRising`, `cheapestAirline`, and `googleFlightsUrl`.

## Google Flights Integration

### URL Generation (`_build_google_url`)

Produces protobuf-encoded Google Flights URLs following the `flights.proto` schema:

- Field 3: `FlightData` (date, airports, optional max_stops)
- Field 8: Passenger type (repeated, one per adult)
- Field 9: Seat class enum
- Field 19: Trip type enum
- Base64-encoded into `tfs` URL parameter

### Price Scraping (`_fetch_cheapest`, `_fetch_flights_html`, `_parse_flights_html`)

Parses Google Flights HTML response:

1. Find `<script class="ds:1">` tag
2. Extract JSON from `data:` prefix
3. Parse `payload[2][0]` (Top/Best flights) and `payload[3][0]` (Other flights)
4. For each entry: extract price, airlines, legs
5. Deduplicate by `(price, airline_string)`
6. Return cheapest result, converting dollars → cents (× 100)

Uses `urllib.request` with a static User-Agent. The scraper fetches both economy
and business class on each `fetchNow` call, silently skipping seat classes where
the scrape fails.

## Seed Data

3 searches × 14 days × 3 fetches/day × 2 seat classes = **252 baseline snapshots**
(more after running `refresh_seed.py` — see below).

| Route | Price Pattern | Expected Alert |
|-------|--------------|----------------|
| LAX → NRT | Week 2 prices ~8% above week 1 | Red |
| SFO → LHR | Week 2 prices ~25% below week 1 | Green |
| JFK → CDG | Flat with minor noise | Grey |

Files:
- `seed/FlightSearch/FlightSearch.json` — 3 search records
- `seed/PriceSnapshot/PriceSnapshot.json` — price snapshot records
- `seed/CronJob/scheduledPriceFetch.json` — scheduled price fetch cron job

### Refreshing Seed Data (`refresh_seed.py`)

The alert algorithm needs snapshots within the last 14 days. Because seed data
is static, the dates become stale over time. The `refresh_seed.py` script
(located at the repo root) rolls the seed forward:

```bash
python refresh_seed.py
```

**How it works:** for each missing day between the latest `fetchedAt` in the
seed file and yesterday, the script copies all snapshots from exactly 7 days
prior, shifting their dates forward. This preserves the original week-over-week
price patterns that produce the expected red/green/grey alerts.

The script is idempotent — if the data already covers yesterday it prints a
message and exits. Run it before any re-provision where alert correctness
matters.

## Startup Hook

`src/App.js` implements `afterStart()`, which the C3 platform calls after
every app start (provision, upgrade, wake from hibernation):

```javascript
function afterStart() {
  UserGroup.upsertSeededGroups();
}
```

This seeds the `FlightApi.Client` UserGroup/Role from
`metadata/Role/FlightApi.Client.json`. The call is idempotent (upsert
semantics). No manual console command required after initial provision.

## Cron Jobs

A seeded `CronJob` record automates price fetching. It is provisioned via
seed data (`seed/CronJob/`) and becomes active on the first provision.

| CronJob ID | Schedule | Type.Method | Purpose |
|------------|----------|-------------|---------|
| `scheduledPriceFetch` | `0 0 0,8,16 * * ?` (3× daily: 00:00, 08:00, 16:00 UTC) | `FlightSearchScheduler.runScheduledSnapshots` | Iterates all active `FlightSearch` records and calls `PriceSnapshot.fetchNow` for each. Errors on individual searches are caught so one failure doesn't block the rest. |

## Authentication & OAuth

The API accepts both `c3auth` cookies (browser sessions) and OAuth Bearer
tokens (machine clients). OAuth clients are registered via the C3 console
as a one-time ops step — see `../secret-config.md`.

The `FlightApi.Client` role grants least-privilege access to the REST
surface only. See `metadata/Role/FlightApi.Client.json` for the full
permission list.

For the auth handshake details and C3 platform quirks, see
`integration-guide.md`.

## API Contract

The OpenAPI spec at `openapi/flights-api.yaml` is the source of truth.

```
openapi/flights-api.yaml   (this repo owns it)
       │
       ├──→  flightTrackerUi      pulls spec → openapi-typescript → typed client
       ├──→  agent / MCP server   pulls spec → generates Python/JS client
       └──→  CI                   validates responses match spec
```

Any endpoint change starts with a spec change. Consumer repos pull the spec and
generate typed clients. Breaking changes are caught by `oasdiff` before merge.

## Known Limitations

- **HTTP client**: Uses `urllib.request` with static User-Agent (lower robustness than Chrome impersonation libraries)
- **HTML parser**: Uses `re.search` regex (less robust than C-based parsers like selectolax)
- **No logging**: Per C3 guidelines (no `console.log` / `print`)
- **Protobuf helpers duplicated**: Same encoding functions exist in both `FlightSearch.py` and `PriceSnapshot.py` (C3 Python implementations are scoped 1:1 to their type)
- **Price unit**: Scraper returns whole dollars, stored as cents (× 100)
- **Seed data staleness**: Snapshot dates drift behind the current date; run `refresh_seed.py` before re-provisioning to keep alert demos accurate
