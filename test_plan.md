# TDD Coverage Plan for flightTrackerApi

---

## Test Type Legend
- **U** = Unit test (Jasmine js-rhino)
- **E** = Endpoint test (Jasmine - HTTP routing)
- **P** = Python pytest

---

## Phase 1: Pure Functions & Utilities (No DB Dependencies)

| Priority | File | Function | Type | Test Cases |
|----------|------|-----------|------|------------|
| 1 | `DataExport.js` | `toCsv(data)` | U | Empty arrays, CSV escaping (comma/quote/newline), Array fields, Header rows |
| 2 | `FlightSearchApi.js` | `_matchPattern(pattern, path)` | U | Match with params, No match (length mismatch), Static segments |

---

## Phase 2: Entity Methods (JS) - Single Entity Operations

| Priority | File | Function | Type | Test Cases |
|----------|------|-----------|------|------------|
| 3 | `FlightSearch.js` | `createSearch(data)` | U | Valid creation, Missing required fields (fromAirport/toAirport/outboundDate), Defaults applied (tripType, passengersAdults, currency, searchStatus), Uppercase normalization |
| 4 | `FlightSearch.js` | `getById(searchId)` | U | Found (returns entity), Not found (returns null) |
| 5 | `FlightSearch.js` | `getAll()` | U | Empty database, Multiple searches, Order by created desc |
| 6 | `FlightSearch.js` | `updateSearchStatus(searchId, newStatus)` | U | Valid status (active→disabled), Invalid status value |
| 7 | `FlightSearch.js` | `deleteSearch(searchId)` | U | Deletes search + cascade snapshots, Search not found |
| 8 | `FlightSearch.js` | `getLatestPrice(searchId)` | U | Has economy snapshot, No snapshots, Non-existent search |
| 9 | `PriceSnapshot.js` | `getHistory(searchId, seatClass)` | U | All seat classes, Filtered by seatClass, Empty result |

---

## Phase 3: Python Methods

| Priority | File | Function | Type | Test Cases |
|----------|------|-----------|------|------------|
| 10 | `FlightSearch.py` | `computeAlert(searchId)` | P | Grey (<7 days data), Grey (no previous week), Red (5+ days rising), Green (≥20% drop), Stable (grey), Price rising edge (4 days), Exact 20% boundary |
| 11 | `PriceSnapshot.py` | `fetchNow(searchId)` | P | Skip (external HTTP - mock or skip in tests) |

---

## Phase 4: REST API Endpoints

| Priority | File | Route | Type | Test Cases |
|----------|------|-------|------|------------|
| 12 | `FlightSearchApi.js` | `GET /flights/searches` | E | Empty list, Multiple searches returned |
| 13 | `FlightSearchApi.js` | `POST /flights/searches` | E | Valid create (201), Missing required (400), Invalid body (400) |
| 14 | `FlightSearchApi.js` | `GET /flights/searches/:id` | E | Found (200), Not found (404) |
| 15 | `FlightSearchApi.js` | `PATCH /flights/searches/:id` | E | Valid update (200), Invalid status (400), Not found (404) |
| 16 | `FlightSearchApi.js` | `DELETE /flights/searches/:id` | E | Delete success (200), Not found (404) |
| 17 | `FlightSearchApi.js` | `GET /flights/searches/:id/alert` | E | With data, Insufficient data (grey), Not found (404) |
| 18 | `FlightSearchApi.js` | `GET /flights/searches/:id/prices` | E | All classes, Filtered (seatClass param), Empty |
| 19 | `FlightSearchApi.js` | `GET /flights/searches/:id/latest-price` | E | Has price (200), No price (200 null), Not found (404) |
| 20 | `FlightSearchApi.js` | `POST /flights/searches/:id/fetch` | E | Success (200), Not found (404) |
| 21 | `FlightSearchApi.js` | `GET /flights/export` | E | JSON default, CSV format, Contains version/exportedAt |
| 22 | `FlightSearchApi.js` | `GET /flights/export/searches` | E | Returns searches only, Empty searches |
| 23 | `FlightSearchApi.js` | `GET /flights/export/snapshots` | E | All snapshots, Filtered by searchId, Empty |
| 24 | `FlightSearchApi.js` | `PUT /flights/import` | E | Valid import, Empty body (400), Skip strategy, Overwrite strategy, Error on conflict |

---

## Phase 5: Complex Integration Tests

| Priority | File | Scenario | Type | Test Cases |
|----------|------|----------|------|------------|
| 25 | `DataExport.js` | `exportAll()` | U | Non-seed only, Snapshot counts correct, Excludes isTestData |
| 26 | `DataExport.js` | `exportSearches()` | U | Non-seed only, Snapshot count = 0 |
| 27 | `DataExport.js` | `exportSnapshots(searchId)` | U | All snapshots, Filtered by search, Excludes seed |
| 28 | `DataExport.js` | `importAll(data)` | U | Skip (existing skipped), Overwrite (existing updated), Error (conflict), Creates new |

---

## Test File Structure

```
flightPriceTrackerApi/test/
├── js-rhino/
│   ├── unit/
│   │   ├── test_DataExport_toCsv.js           # Priority 1
│   │   ├── test_FlightSearchApi_matchPattern.js  # Priority 2
│   │   ├── test_FlightSearch_createSearch.js    # Priority 3
│   │   ├── test_FlightSearch_getById.js        # Priority 4
│   │   ├── test_FlightSearch_getAll.js          # Priority 5
│   │   ├── test_FlightSearch_updateSearchStatus.js  # Priority 6
│   │   ├── test_FlightSearch_deleteSearch.js    # Priority 7
│   │   ├── test_FlightSearch_getLatestPrice.js  # Priority 8
│   │   ├── test_PriceSnapshot_getHistory.js     # Priority 9
│   │   ├── test_DataExport_exportAll.js         # Priority 25
│   │   ├── test_DataExport_exportSearches.js    # Priority 26
│   │   ├── test_DataExport_exportSnapshots.js   # Priority 27
│   │   └── test_DataExport_importAll.js         # Priority 28
│   ├── endpoint/
│   │   ├── test_FlightSearchApi_searches.js     # Priorities 12-16
│   │   ├── test_FlightSearchApi_alert.js        # Priority 17
│   │   ├── test_FlightSearchApi_prices.js       # Priority 18
│   │   ├── test_FlightSearchApi_latestPrice.js  # Priority 19
│   │   ├── test_FlightSearchApi_fetch.js        # Priority 20
│   │   ├── test_FlightSearchApi_export.js       # Priorities 21-23
│   │   └── test_FlightSearchApi_import.js       # Priority 24
│   └── helpers/
│       └── requestHelpers.js
└── py-flighttracker/
    ├── test_computeAlert.py                    # Priority 10
    └── test_fetchNow.py                        # Priority 11 (skip)
```

---

## Execution Order Recommendation

1. **Start with Phase 1** - Pure functions build familiarity with test patterns
2. **Phase 2** - Entity methods establish baseline coverage
3. **Phase 3** - Python logic (most complex business logic)
4. **Phase 4** - Endpoints (high value, covers HTTP contract)
5. **Phase 5** - Integration (depends on earlier phases passing)