# Flight Price Tracker — API

C3 AI backend package for the Flight Price Tracker. Monitors airline prices,
detects trends, and alerts users via a RESTful API.

## Package Structure

```
flightPriceTracker/
├── flightPriceTracker.c3pkg.json    # C3 package manifest
├── src/
│   ├── FlightSearch.c3typ           # Entity: flight search configuration
│   ├── FlightSearch.js              # JS CRUD (js-server)
│   ├── FlightSearch.py              # Python: alert algorithm, URL builder
│   ├── PriceSnapshot.c3typ          # Entity: price data point
│   ├── PriceSnapshot.js             # JS CRUD (js-server)
│   ├── PriceSnapshot.py             # Python: Google Flights scraper
│   ├── FlightSearchApi.c3typ        # @restful BFF for web UI
│   └── FlightSearchApi.js           # Route table + handlers
└── seed/
    ├── FlightSearch/FlightSearch.json
    └── PriceSnapshot/PriceSnapshot.json

openapi/
└── flights-api.yaml                 # OpenAPI 3.1 spec (source of truth)

scripts/
└── validate-openapi.sh              # Lint + breaking change detection
```

## API Contract

The OpenAPI spec at `openapi/flights-api.yaml` is the single source of truth
for the REST surface. Consumer repos (UI, agents, CLI) generate typed clients
from this spec.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/flights/searches` | List all flight searches |
| POST | `/flights/searches` | Create a new search |
| GET | `/flights/searches/{id}` | Get a search by ID |
| PATCH | `/flights/searches/{id}` | Update search status |
| DELETE | `/flights/searches/{id}` | Delete search + snapshots |
| GET | `/flights/searches/{id}/alert` | Compute price trend alert |
| GET | `/flights/searches/{id}/prices` | Price history (optionally filtered by seat class) |
| GET | `/flights/searches/{id}/latest-price` | Most recent economy snapshot |
| POST | `/flights/searches/{id}/fetch` | Trigger live price scrape |

## Development

Provision the package to a C3 environment. Verify entity methods work via the
C3 console:

```javascript
FlightSearch.getAll()
FlightSearch.createSearch({ fromAirport: "LAX", toAirport: "NRT", outboundDate: "2026-06-01" })
```

Verify REST endpoints via curl:

```bash
BASE="https://<cluster>/<env>/flightpricetracker/flights"
curl -b "c3auth=$TOKEN" "$BASE/searches" | jq '.[0].id'
```

## Validate the OpenAPI Spec

```bash
./scripts/validate-openapi.sh
```

Requires [Spectral](https://github.com/stoplightio/spectral) for linting and
[oasdiff](https://github.com/Tufin/oasdiff) for breaking change detection.

## Related Repos

- **[flightTrackerUi](../flightTrackerUi)** — React frontend (separate package)
