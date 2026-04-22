## C3 Console — RPC examples

These commands run in the C3 AI Studio JavaScript console on the `flightpricetrackerapi` app. The console uses the browser's `c3auth` session — no OAuth token needed.

### Inspect current user and permissions

```javascript
// Who am I?
var me = User.myUser();
console.log("User ID:", me.id);
console.log("Groups:", me.c3Groups);

// Check a specific user's groups
var svcUser = User.forId("sstJZ5eETn_MvV12vuwjtQ").get();
console.log("Service account groups:", svcUser.c3Groups);

// List all users with their groups
c3Grid(User.fetch({ include: "id, c3Groups.id" }).objs);
```

### List searches

```javascript
var searches = FlightSearch.getAll();
c3Grid(searches);

// As JSON
console.log(JSON.stringify(searches, null, 2));
```

### Get single search

```javascript
var s = FlightSearch.getById("seed_search_lax_nrt");
c3Tree(s);

// Access fields
console.log(s.fromAirport, "→", s.toAirport, s.tripType);
```

### Create search

```javascript
var result = FlightSearch.createSearch({
  fromAirport: "LAX",
  toAirport: "NRT",
  outboundDate: "2026-05-15",
  tripType: "one-way",
});
console.log("Created:", result.id);
```

### Update search status

```javascript
var updated = FlightSearch.updateSearchStatus(
  "seed_search_lax_nrt",
  "disabled",
);
c3Tree(updated);
```

### Delete search

```javascript
FlightSearch.deleteSearch("some-id-to-delete");
```

### Price alert

```javascript
var alert = FlightSearch.computeAlert("seed_search_lax_nrt");
c3Tree(alert);
// alert.status → "red" | "green" | "grey"
// alert.message → "Prices dropped 22% vs. last week"
```

### Price history

```javascript
var prices = PriceSnapshot.getHistory("seed_search_lax_nrt", "economy");
c3Grid(prices);

// Latest price
var latest = FlightSearch.getLatestPrice("seed_search_lax_nrt");
console.log(
  "Latest economy price:",
  latest ? (latest.price / 100).toFixed(2) : "none",
);
```

### Trigger live scrape

```javascript
var snapshots = PriceSnapshot.fetchNow("seed_search_lax_nrt");
c3Grid(snapshots);
```

### Run all examples (copy-paste block)

Returns a single result object — the C3 console displays it like a Jupyter cell.

```javascript
var out = {};

var all = FlightSearch.getAll();
out.searches = all.map(function (s) {
  return {
    id: s.id,
    route: s.fromAirport + "→" + s.toAirport,
    trip: s.tripType,
    date: "" + s.outboundDate,
    seed: !!s.isTestData,
  };
});

out.getById = (function () {
  var s = FlightSearch.getById("seed_search_lax_nrt");
  return {
    id: s.id,
    from: s.fromAirport,
    to: s.toAirport,
    trip: s.tripType,
    date: "" + s.outboundDate,
    status: s.searchStatus,
  };
})();

var created = FlightSearch.createSearch({
  fromAirport: "SFO",
  toAirport: "LHR",
  outboundDate: "2026-06-01",
  tripType: "round-trip",
  returnDate: "2026-06-10",
  passengersAdults: 2,
});
out.created = { id: created.id, version: created.version };

out.alert = (function () {
  var a = FlightSearch.computeAlert("seed_search_lax_nrt");
  return {
    status: a.status,
    message: a.message,
    currentWeekAvg: a.currentWeekAvg,
    percentChange: a.percentChange,
    cheapestAirline: a.cheapestAirline,
  };
})();

out.prices = (function () {
  var prices = PriceSnapshot.getHistory("seed_search_lax_nrt", "economy");
  return (prices || []).map(function (p) {
    return {
      price: "$" + (p.price / 100).toFixed(2),
      date: "" + p.fetchedAt,
      airlines: ("" + (p.airlineNames || "")).replace(/^\[|]$/g, ""),
    };
  });
})();

out.latestPrice = (function () {
  var l = FlightSearch.getLatestPrice("seed_search_lax_nrt");
  return l
    ? {
        price: "$" + (l.price / 100).toFixed(2),
        seatClass: l.seatClass,
        date: "" + l.fetchedAt,
      }
    : null;
})();

FlightSearch.deleteSearch(created.id);
out.cleanup = { deleted: created.id };

out;
```
