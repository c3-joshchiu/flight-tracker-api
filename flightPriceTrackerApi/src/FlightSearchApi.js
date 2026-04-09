var VALID_STATUSES = { active: true, disabled: true };

/**
 * Route table: each entry is [httpMethod, pathPattern, handlerFn].
 *
 * Path patterns use ':name' for captured path parameters.
 * Handlers receive (req: HttpRequest, params: Object) where params holds captured values.
 * All responses use C3's responseFromValue for proper type serialization.
 */
var ROUTES = [
  ['GET',    'searches',                  listSearches],
  ['POST',   'searches',                  createSearch],
  ['GET',    'searches/:id',              getSearch],
  ['PATCH',  'searches/:id',              updateSearch],
  ['DELETE', 'searches/:id',              deleteSearch],
  ['GET',    'searches/:id/alert',        getAlert],
  ['GET',    'searches/:id/prices',       getPrices],
  ['GET',    'searches/:id/latest-price', getLatestPrice],
  ['POST',   'searches/:id/fetch',        triggerFetch],
  ['GET',    'export',                    exportData],
  ['GET',    'export/searches',           exportSearchesHandler],
  ['GET',    'export/snapshots',          exportSnapshotsHandler],
  ['PUT',    'import',                    importData],
];

/**
 * Entry point for all HTTP requests under the /flights/ endpoint.
 * The C3 Restful mixin passes the full path (including the 'flights/' prefix)
 * as httpPath, so we strip it before matching against route patterns.
 *
 * @param {string}      httpPath  Full path after app prefix, e.g. "flights/searches/abc123"
 * @param {HttpRequest} req       C3 HttpRequest with method, body, query params, headers
 * @returns {HttpResponse}        JSON response via responseFromValue, or error JSON via responseFromText
 */
function handle(httpPath, req) {
  try {
    var path = (httpPath || '').replace(/^\//, '');
    if (path.indexOf('flights/') === 0) {
      path = path.substring(8);
    }
    var method = req.method;

    for (var i = 0; i < ROUTES.length; i++) {
      var route = ROUTES[i];
      if (route[0] !== method) continue;
      var params = _matchPattern(route[1], path);
      if (params !== null) {
        return route[2](req, params);
      }
    }

    return _errorJson(req, 404, 'Not found: ' + method + ' /' + path);
  } catch (e) {
    return _errorJson(req, 500, e.message || 'Internal server error');
  }
}

/**
 * Match a route pattern against an actual URL path.
 *
 * @param {string} pattern  Route pattern, e.g. "searches/:id/alert"
 * @param {string} path     Actual path, e.g. "searches/abc123/alert"
 * @returns {Object|null}   Captured params (e.g. { id: "abc123" }) or null if no match
 */
function _matchPattern(pattern, path) {
  var patternParts = pattern.split('/');
  var pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  var params = {};
  for (var i = 0; i < patternParts.length; i++) {
    if (patternParts[i].charAt(0) === ':') {
      params[patternParts[i].substring(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}


// ────────────────────────────────────────────────────────────
// Route handlers
// ────────────────────────────────────────────────────────────

/**
 * GET /flights/searches
 *
 * @returns {FlightSearch[]}  All searches, ordered by most recently created
 */
function listSearches(req) {
  var results = FlightSearch.getAll();
  return _jsonResponse(req, results || []);
}

/**
 * POST /flights/searches
 *
 * @body {Object} JSON with required fields:
 *   - fromAirport    {string}  IATA code, e.g. "LAX" (required)
 *   - toAirport      {string}  IATA code, e.g. "NRT" (required)
 *   - outboundDate   {string}  ISO date, e.g. "2026-04-15" (required)
 *   - tripType       {string}  "one-way" | "round-trip" (default: "one-way")
 *   - returnDate     {string}  ISO date, only for round-trip (optional)
 *   - maxStops       {int}     Max stops allowed (optional)
 *   - passengersAdults {int}   Number of adults (default: 1)
 *   - currency       {string}  Currency code (default: "USD")
 * @returns {FlightSearch}  The newly created search with searchStatus "active"
 * @error 400  Missing required fields
 */
function createSearch(req) {
  var body = _parseBody(req);
  if (!body.fromAirport || !body.toAirport || !body.outboundDate) {
    return _errorJson(req, 400, 'fromAirport, toAirport, and outboundDate are required');
  }
  return _jsonResponse(req, FlightSearch.createSearch(body));
}

/**
 * GET /flights/searches/:id
 *
 * @param {string} params.id  FlightSearch entity ID
 * @returns {FlightSearch}    The search entity with all fields
 * @error 404  Search not found
 */
function getSearch(req, params) {
  var search = FlightSearch.getById(params.id);
  if (!search) return _errorJson(req, 404, 'Search not found');
  return _jsonResponse(req, search);
}

/**
 * PATCH /flights/searches/:id
 *
 * @param {string} params.id  FlightSearch entity ID
 * @body {Object} JSON with:
 *   - searchStatus {string}  "active" | "disabled" (required)
 * @returns {FlightSearch}    The updated search entity
 * @error 400  Invalid or missing searchStatus
 * @error 404  Search not found
 */
function updateSearch(req, params) {
  var body = _parseBody(req);
  if (!body.searchStatus || !VALID_STATUSES[body.searchStatus]) {
    return _errorJson(req, 400, 'searchStatus must be "active" or "disabled"');
  }
  var search = FlightSearch.getById(params.id);
  if (!search) return _errorJson(req, 404, 'Search not found');
  return _jsonResponse(req, FlightSearch.updateSearchStatus(params.id, body.searchStatus));
}

/**
 * DELETE /flights/searches/:id
 *
 * Deletes the search and all associated PriceSnapshot records.
 *
 * @param {string} params.id  FlightSearch entity ID
 * @returns {void}            Empty 200 response
 * @error 404  Search not found
 */
function deleteSearch(req, params) {
  var search = FlightSearch.getById(params.id);
  if (!search) return _errorJson(req, 404, 'Search not found');
  FlightSearch.deleteSearch(params.id);
  return req.emptyResponse();
}

/**
 * GET /flights/searches/:id/alert
 *
 * Computes a price trend alert from the last 14 days of economy snapshots.
 *
 * @param {string} params.id  FlightSearch entity ID
 * @returns {Object} Alert result:
 *   - searchId         {string}       The search ID
 *   - status           {string}       "red" | "green" | "grey"
 *   - message          {string}       Human-readable alert description
 *   - currentWeekAvg   {number|null}  Average daily min price this week (cents)
 *   - previousWeekAvg  {number|null}  Average daily min price last week (cents)
 *   - percentChange    {number|null}  Week-over-week percent change
 *   - daysRising       {number|null}  Days where current > previous week price
 *   - cheapestAirline  {string|null}  Name of cheapest airline from latest snapshot
 *   - googleFlightsUrl {string|null}  Protobuf-encoded Google Flights search URL
 */
function getAlert(req, params) {
  return _jsonResponse(req, FlightSearch.computeAlert(params.id));
}

/**
 * GET /flights/searches/:id/prices?seatClass=economy
 *
 * @param {string} params.id         FlightSearch entity ID
 * @query {string} seatClass         "economy" | "business" (optional, omit for all classes)
 * @returns {PriceSnapshot[]}        Price snapshots ordered by fetchedAt ascending
 */
function getPrices(req, params) {
  var seatClassValues = req.queryParam('seatClass');
  var seatClass = (seatClassValues && seatClassValues.length > 0) ? seatClassValues[0] : '';
  var results = PriceSnapshot.getHistory(params.id, seatClass);
  return _jsonResponse(req, results || []);
}

/**
 * GET /flights/searches/:id/latest-price
 *
 * @param {string} params.id     FlightSearch entity ID
 * @returns {PriceSnapshot|null} Most recent economy snapshot, or null if none exist
 */
function getLatestPrice(req, params) {
  var result = FlightSearch.getLatestPrice(params.id);
  return _jsonResponse(req, result);
}

/**
 * POST /flights/searches/:id/fetch
 *
 * Triggers a live scrape of Google Flights for both economy and business classes.
 * Silently skips seat classes where the live fetch fails (no mock data fallback).
 *
 * @param {string} params.id       FlightSearch entity ID
 * @returns {PriceSnapshot[]}      Newly created snapshots (0-2 items depending on scrape success)
 * @error 404  Search not found
 */
function triggerFetch(req, params) {
  var search = FlightSearch.getById(params.id);
  if (!search) return _errorJson(req, 404, 'Search not found');
  var results = PriceSnapshot.fetchNow(params.id);
  return _jsonResponse(req, results || []);
}


// ────────────────────────────────────────────────────────────
// Export / Import handlers
// ────────────────────────────────────────────────────────────

/**
 * GET /flights/export?format=csv|json
 *
 * Exports all non-seed searches and their snapshots.
 *
 * @query {string} format  "csv" | "json" (default: "json")
 * @returns {ExportData|string}  JSON envelope or CSV text depending on format
 */
function exportData(req) {
  var formatValues = req.queryParam('format');
  var format = (formatValues && formatValues.length > 0) ? formatValues[0] : 'json';
  var data = DataExport.exportAll();
  return _formatExportResponse(req, data, format, 'flight-tracker-export');
}

/**
 * GET /flights/export/searches?format=csv|json
 *
 * Exports non-seed searches only (no snapshots).
 *
 * @query {string} format  "csv" | "json" (default: "json")
 * @returns {ExportData|string}  JSON envelope or CSV text (snapshots array empty)
 */
function exportSearchesHandler(req) {
  var formatValues = req.queryParam('format');
  var format = (formatValues && formatValues.length > 0) ? formatValues[0] : 'json';
  var data = DataExport.exportSearches();
  return _formatExportResponse(req, data, format, 'flight-tracker-searches');
}

/**
 * GET /flights/export/snapshots?format=csv|json&searchId=X
 *
 * Exports snapshots, optionally filtered to a single search.
 *
 * @query {string} format    "csv" | "json" (default: "json")
 * @query {string} searchId  FlightSearch entity ID (optional; omit for all non-seed)
 * @returns {ExportData|string}  JSON envelope or CSV text (searches array empty)
 */
function exportSnapshotsHandler(req) {
  var formatValues = req.queryParam('format');
  var format = (formatValues && formatValues.length > 0) ? formatValues[0] : 'json';
  var searchIdValues = req.queryParam('searchId');
  var searchId = (searchIdValues && searchIdValues.length > 0) ? searchIdValues[0] : '';
  var data = DataExport.exportSnapshots(searchId);
  return _formatExportResponse(req, data, format, 'flight-tracker-snapshots');
}

/**
 * PUT /flights/import
 *
 * Idempotent bulk import of searches and/or snapshots. Uses natural keys
 * (not C3 entity IDs) for deduplication, making cross-environment imports safe.
 *
 * @body {Object} JSON with:
 *   - searches          {ExportedSearch[]}  Searches to import (optional)
 *   - snapshots         {ExportedSnapshot[]} Snapshots to import (optional)
 *   - conflictStrategy  {string}  "skip" (default) | "overwrite" | "error"
 * @returns {ImportReport}  Counts of created/skipped/overwritten/errored records
 * @error 400  Neither searches nor snapshots provided
 */
function importData(req) {
  var body = _parseBody(req);
  if (!body.searches && !body.snapshots) {
    return _errorJson(req, 400, 'Request must include searches and/or snapshots');
  }
  var result = DataExport.importAll(body);
  return _jsonResponse(req, result);
}

/**
 * Serialize export data in the requested format and set appropriate headers.
 * CSV responses include Content-Disposition for browser file download.
 */
function _formatExportResponse(req, data, format, filenameBase) {
  var timestamp = new Date().toISOString().substring(0, 10);
  var filename = filenameBase + '-' + timestamp;

  switch (format) {
    case 'csv': {
      var csvString = DataExport.toCsv(data);
      var csvContent = ContentValue.fromString(csvString, ContentType.csv());
      var csvResp = req.responseFromContent(csvContent);
      return csvResp.withHeader('Content-Disposition',
        'attachment; filename="' + filename + '.csv"');
    }
    case 'json':
    default:
      return req.responseFromJson(data);
  }
}


// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Serialize a C3 typed value into an HTTP JSON response.
 * Uses responseFromValue (C3's native HTTP serialization) to properly handle
 * C3 collections as JSON arrays and DateTime fields as ISO strings.
 */
function _jsonResponse(req, value) {
  return req.responseFromValue(value);
}

/**
 * Parse the JSON request body, returning an empty object if body is absent.
 */
function _parseBody(req) {
  var raw = req.readBodyString();
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * Return a JSON error response with { error, status } body and a real HTTP status code.
 * Uses HttpResponse.make() so the HTTP status matches the body — responseFromText always returns 200.
 */
function _errorJson(req, status, message) {
  return HttpResponse.make({
    statusCode: status,
    reasonPhrase: message
  }).withBody(JSON.stringify({ error: message, status: status }));
}
