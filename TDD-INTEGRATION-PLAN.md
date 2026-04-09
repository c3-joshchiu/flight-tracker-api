# TDD Integration Plan for flightTrackerApi

## Overview

This document outlines how to integrate Test-Driven Development (TDD) practices into the `flightTrackerApi` C3 AI backend, based on the patterns from `~/.cursor/skills/c3-backend-tests`.

---

## 1. Test Directory Structure

Create the following test directory layout under `flightPriceTrackerApi/`:

```
flightPriceTrackerApi/
  test/
    js-rhino/
      unit/
        test_FlightSearch_getAll.js
        test_FlightSearch_getById.js
        test_FlightSearch_createSearch.js
        test_FlightSearch_updateSearchStatus.js
        test_FlightSearch_deleteSearch.js
        test_FlightSearch_getLatestPrice.js
        test_PriceSnapshot_getHistory.js
        test_DataExport_exportAll.js
        test_DataExport_exportSearches.js
        test_DataExport_exportSnapshots.js
        test_DataExport_toCsv.js
        test_DataExport_importAll.js
      endpoint/
        test_FlightSearchApi_searches_crud.js
        test_FlightSearchApi_searches_errors.js
        test_FlightSearchApi_prices_query.js
        test_FlightSearchApi_export.js
        test_FlightSearchApi_import.js
        test_FlightSearchApi_routing.js
        helpers/
          requestHelpers.js
    py-flighttracker/
      test_computeAlert.py
      test_fetchNow.py
```

---

## 2. Test Type Decision Matrix

| Code Under Test | Test Type | Example |
|-----------------|-----------|---------|
| JavaScript entity methods (`FlightSearch.js`) | Unit (Jasmine) | `test_FlightSearch_createSearch.js` |
| Python methods (`FlightSearch.py`, `PriceSnapshot.py`) | pytest | `test_computeAlert.py` |
| REST API routes (`FlightSearchApi.js`) | Endpoint (Jasmine) | `test_FlightSearchApi_searches_crud.js` |

---

## 3. TDD Workflow for New Features

### Phase 1: Write Failing Tests First

```javascript
// Step 1: Write the test BEFORE implementation
// test_FlightSearchApi_export.js
const filename = 'test_FlightSearchApi_export';

describe(filename, function () {
  beforeAll(function () {
    this.ctx = TestApi.createContext(filename);
    // Seed test data
  });

  it('returns JSON by default with version and timestamp', function () {
    var req = mockGet('flights/export');
    var resp = FlightSearchApi.handle('flights/export', req);
    var body = parseResponseBody(resp);
    expect(body.version).toEqual('1.0');
    expect(body.exportedAt).toBeTruthy();
  });

  // ... more tests

  afterAll(function () {
    TestApi.teardown(this.ctx);
  });
});
```

### Phase 2: Run Tests (should fail)

```javascript
// In C3 Console
TestRunner.make().runTests("test_FlightSearchApi_export")
```

### Phase 3: Implement to Make Tests Pass

Implement the feature in the source files until all tests pass.

### Phase 4: Refactor with Confidence

Tests serve as a safety net during refactoring.

---

## 4. Test Naming Conventions

| Pattern | Example |
|---------|---------|
| Unit test file | `test_{TypeName}_{methodName}.js` |
| Endpoint test file | `test_{ApiTypeName}_{routeGroup}.js` |
| Python test file | `test_{function_name}.py` |
| Test entity IDs | `test_{feature}_{entity}_{number}` |

---

## 5. Required TestApi Patterns

### Unit Test Skeleton

```javascript
const filename = 'test_FlightSearch_createSearch';

describe(filename, function () {
  beforeAll(function () {
    this.ctx = TestApi.createContext(filename);
  });

  it('describes one behavior', function () {
    // Test implementation
  });

  afterAll(function () {
    TestApi.teardown(this.ctx);
  });
});
```

### Factory Helper Pattern

```javascript
function makeSearch(overrides) {
  return Object.assign({
    fromAirport: 'LAX',
    toAirport: 'NRT',
    tripType: 'one-way',
    outboundDate: '2026-06-01',
    passengersAdults: 1,
    currency: 'USD',
    searchStatus: 'active',
  }, overrides || {});
}
```

---

## 6. Priority Test Coverage

### High Priority (Existing Features)

| Feature | Test Files | Test Cases |
|---------|-----------|------------|
| `FlightSearch.getAll()` | `test_FlightSearch_getAll.js` | Returns empty array, Returns all searches, Order by created desc |
| `FlightSearch.createSearch()` | `test_FlightSearch_createSearch.js` | Valid creation, Missing required fields, Default values |
| `FlightSearch.getById()` | `test_FlightSearch_getById.js` | Found, Not found |
| `FlightSearch.updateSearchStatus()` | `test_FlightSearch_updateSearchStatus.js` | Valid status change, Invalid status |
| `FlightSearch.deleteSearch()` | `test_FlightSearch_deleteSearch.js` | Deletes search and snapshots, Search not found |
| `PriceSnapshot.getHistory()` | `test_PriceSnapshot_getHistory.js` | All classes, Filtered by seatClass, Empty result |
| `DataExport.exportAll()` | `test_DataExport_exportAll.js` | Exports non-seed, Excludes seed data, Snapshot counts |
| `DataExport.toCsv()` | `test_DataExport_toCsv.js` | Proper CSV format, Array fields escaped |
| `DataExport.importAll()` | `test_DataExport_importAll.js` | Skip strategy, Overwrite strategy, Error strategy |

### High Priority (Endpoint Tests)

| Endpoint | Test File | Test Cases |
|----------|----------|------------|
| `GET /flights/searches` | `test_FlightSearchApi_searches_crud.js` | List searches, Empty list |
| `POST /flights/searches` | `test_FlightSearchApi_searches_crud.js` | Create valid, Missing fields (400) |
| `GET /flights/searches/:id` | `test_FlightSearchApi_searches_crud.js` | Found (200), Not found (404) |
| `PATCH /flights/searches/:id` | `test_FlightSearchApi_searches_errors.js` | Valid update, Invalid status (400), Not found (404) |
| `DELETE /flights/searches/:id` | `test_FlightSearchApi_searches_crud.js` | Delete success, Not found (404) |
| `GET /flights/export` | `test_FlightSearchApi_export.js` | JSON format, CSV format, Includes searches/snapshots |
| `PUT /flights/import` | `test_FlightSearchApi_import.js` | Valid import, Empty body (400), Conflict strategies |

### Medium Priority (Python Methods)

| Method | Test File | Test Cases |
|--------|----------|------------|
| `FlightSearch.computeAlert()` | `test_computeAlert.py` | Price rising, Price falling, Grey (no data), Edge dates |
| `PriceSnapshot.fetchNow()` | `test_fetchNow.py` | Mock HTTP response, Network error handling |

---

## 7. Running Tests

### From C3 Console

```javascript
// Single test file
TestRunner.make().runTests("test_DataExport_exportAll")

// All tests for a type
TestRunner.make().runTests("test_FlightSearch_*")

// All endpoint tests
TestRunner.make().runTests("test_FlightSearchApi_*")
```

### Formatted Output Helper

```javascript
function runTest(testPath) {
  var results = TestRunner.make().runTests(testPath);
  var numPassed = 0, numFailed = 0, numSkipped = 0, time = 0;
  results.forEach(function (result) {
    result.testsuite.forEach(function (testsuite) {
      testsuite.testcase.forEach(function (testcase) {
        if (testcase.skipped) {
          numSkipped++;
          console.log('%c SKIPPED: ' + testcase.name, 'color: #FFBF00');
        } else if (testcase.failure) {
          numFailed++;
          console.log('%c FAILED: ' + testcase.failure.message, 'color: #ed5d53');
        } else {
          numPassed++;
          console.log('%c PASSED: ' + testcase.name, 'color: green');
        }
      });
      time += testsuite.time;
    });
  });
  console.log('%c PASSED: ' + numPassed, 'color: green');
  console.log('%c FAILED: ' + numFailed, 'color: #ed5d53');
  console.log('%c SKIPPED: ' + numSkipped, 'color: #FFBF00');
  console.log('%c TIME: ' + time + 's', 'color: #00FFFF');
}

runTest("test_DataExport_exportAll");
```

---

## 8. Integration with CI/CD

Add test execution to the deployment pipeline:

```yaml
# .github/workflows/test.yml (example)
- name: Run C3 Backend Tests
  run: |
    # Run via C3 CLI or MCP
    c3 test run --pattern "test_FlightSearchApi_*"
    c3 test run --pattern "test_DataExport_*"
```

---

## 9. Test Data Isolation Rules

1. **Unique IDs**: All test entity IDs must be prefixed with `test_` or feature name
2. **Context-bound**: Use `TestApi.createContext()` and `TestApi.teardown()`
3. **No cross-dependencies**: Tests must not depend on data created by other tests
4. **Seeded cleanup**: Use `TestApi.upsertBatchEntity()` for proper teardown

---

## 10. Anti-Patterns to Avoid

| Anti-Pattern | Correct Approach |
|--------------|-----------------|
| Testing implementation details | Test observable behavior |
| Giant `it` blocks with many assertions | One assertion group per `it` block |
| Shared mutable state | Use factory functions, not shared variables |
| Guessing C3 API syntax | Verify with C3 MCP before writing tests |
| Testing external services | Mock or skip external calls |

---

## 11. Next Steps

1. **Create test directory structure** in `flightPriceTrackerApi/test/`
2. **Create `requestHelpers.js`** for endpoint tests
3. **Write tests for `DataExport`** (highest value, already complete in examples)
4. **Write endpoint tests for `FlightSearchApi`** routes
5. **Write unit tests for entity methods** in `FlightSearch.js` and `PriceSnapshot.js`
6. **Add pytest tests for Python methods** (`computeAlert`, `fetchNow`)
7. **Set up CI integration** for automated test execution

---

## Appendix: Reference Documentation

- C3 Backend Tests Skill: `~/.cursor/skills/c3-backend-tests/SKILL.md`
- Unit Test Examples: `~/.cursor/skills/c3-backend-tests/examples-unit-tests.md`
- Endpoint Test Examples: `~/.cursor/skills/c3-backend-tests/examples-endpoint-tests.md`
- pytest Examples: `~/.cursor/skills/c3-backend-tests/examples-pytest.md`
