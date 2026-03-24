var log = Logger.for('DataExport');

// ── Export ──────────────────────────────────────────────────

function exportAll() {
  var searches = _fetchNonSeedSearches();
  var snapshots = _fetchSnapshotsForSearches(searches);
  var serializedSnaps = _serializeSnapshots(snapshots);

  return _exportEnvelope(
    _serializeSearches(searches, serializedSnaps),
    serializedSnaps
  );
}

function exportSearches() {
  var searches = _fetchNonSeedSearches();

  return _exportEnvelope(_serializeSearches(searches, []), []);
}

function exportSnapshots(searchId) {
  if (searchId && searchId.trim()) {
    var search = FlightSearch.forId(searchId).get('this');
    if (!search || search.isTestData === true) {
      return _exportEnvelope([], []);
    }
    var snapshots = PriceSnapshot.fetch({
      filter: Filter.eq('flightSearch', searchId),
      include: 'this',
      order: 'ascending(fetchedAt)',
      limit: 50000
    }).objs || [];

    return _exportEnvelope([], _serializeSnapshots(snapshots));
  }

  var searches = _fetchNonSeedSearches();
  var allSnapshots = _fetchSnapshotsForSearches(searches);

  return _exportEnvelope([], _serializeSnapshots(allSnapshots));
}

// ── CSV Serialization ──────────────────────────────────────

function toCsv(data) {
  var lines = [];

  // Searches section
  lines.push('# SEARCHES');
  lines.push('id,fromAirport,toAirport,tripType,outboundDate,returnDate,maxStops,passengersAdults,currency,searchStatus');
  var searches = data.searches || [];
  for (var i = 0; i < searches.length; i++) {
    var s = searches[i];
    lines.push(
      _csvField(s.id) + ',' +
      _csvField(s.fromAirport) + ',' +
      _csvField(s.toAirport) + ',' +
      _csvField(s.tripType) + ',' +
      _csvField(s.outboundDate) + ',' +
      _csvField(s.returnDate) + ',' +
      _csvField(s.maxStops) + ',' +
      _csvField(s.passengersAdults) + ',' +
      _csvField(s.currency) + ',' +
      _csvField(s.searchStatus)
    );
  }

  lines.push('');

  // Snapshots section
  lines.push('# SNAPSHOTS');
  lines.push('id,flightSearchId,seatClass,price,airlineCodes,airlineNames,flightType,durationMinutes,fetchedAt');
  var snapshots = data.snapshots || [];
  for (var j = 0; j < snapshots.length; j++) {
    var snap = snapshots[j];
    lines.push(
      _csvField(snap.id) + ',' +
      _csvField(snap.flightSearchId) + ',' +
      _csvField(snap.seatClass) + ',' +
      _csvField(snap.price) + ',' +
      _csvArrayField(snap.airlineCodes) + ',' +
      _csvArrayField(snap.airlineNames) + ',' +
      _csvField(snap.flightType) + ',' +
      _csvField(snap.durationMinutes) + ',' +
      _csvField(snap.fetchedAt)
    );
  }

  return lines.join('\n');
}

// ── Import ─────────────────────────────────────────────────

function importAll(data) {
  var strategy = data.conflictStrategy || 'skip';
  var report = {
    status: 'pending',
    searches: { created: 0, skipped: 0, overwritten: 0, errors: [] },
    snapshots: { created: 0, skipped: 0, overwritten: 0, errors: [] }
  };

  // Phase 1: Import searches, build ID mapping (import ID → C3 ID)
  var idMap = {};
  var searches = data.searches || [];
  for (var i = 0; i < searches.length; i++) {
    var s = searches[i];
    try {
      var existing = _findSearchByNaturalKey(s);
      if (existing) {
        if (strategy === 'skip') {
          report.searches.skipped++;
          idMap[s.id] = existing.id;
          continue;
        } else if (strategy === 'overwrite') {
          _updateSearch(existing.id, s);
          report.searches.overwritten++;
          idMap[s.id] = existing.id;
          continue;
        } else {
          report.searches.errors.push({ id: s.id, error: 'Conflict: search already exists' });
          idMap[s.id] = existing.id;
          continue;
        }
      }
      var created = FlightSearch.createSearch(s);
      idMap[s.id] = created.id;
      report.searches.created++;
    } catch (e) {
      log.error("Import search failed for id={}: {}", s.id, e.message || String(e));
      report.searches.errors.push({ id: s.id, error: e.message || String(e) });
    }
  }

  // Phase 2: Import snapshots, resolving search IDs via idMap
  var snapshots = data.snapshots || [];
  for (var j = 0; j < snapshots.length; j++) {
    var snap = snapshots[j];
    try {
      var resolvedSearchId = idMap[snap.flightSearchId] || snap.flightSearchId;
      if (!resolvedSearchId) {
        report.snapshots.errors.push({ id: snap.id, error: 'No matching search found' });
        continue;
      }

      var existingSnap = _findSnapshotByNaturalKey(resolvedSearchId, snap.seatClass, snap.fetchedAt);
      if (existingSnap) {
        if (strategy === 'skip') {
          report.snapshots.skipped++;
          continue;
        } else if (strategy === 'overwrite') {
          _updateSnapshot(existingSnap.id, snap, resolvedSearchId);
          report.snapshots.overwritten++;
          continue;
        } else {
          report.snapshots.errors.push({ id: snap.id, error: 'Conflict: snapshot already exists' });
          continue;
        }
      }

      PriceSnapshot.make({
        flightSearch: resolvedSearchId,
        seatClass: snap.seatClass,
        price: snap.price,
        airlineCodes: snap.airlineCodes || [],
        airlineNames: snap.airlineNames || [],
        flightType: snap.flightType || null,
        durationMinutes: snap.durationMinutes || null,
        fetchedAt: snap.fetchedAt
      }).create();
      report.snapshots.created++;
    } catch (e) {
      log.error("Import snapshot failed for id={}: {}", snap.id || ('index_' + j), e.message || String(e));
      report.snapshots.errors.push({ id: snap.id || ('index_' + j), error: e.message || String(e) });
    }
  }

  report.status = (report.searches.errors.length > 0 || report.snapshots.errors.length > 0)
    ? 'completed_with_errors'
    : 'completed';

  return report;
}

// ── Shared Fetch Helpers ───────────────────────────────────

function _fetchNonSeedSearches() {
  return FlightSearch.fetch({
    filter: Filter.ne('isTestData', true),
    include: 'this',
    order: 'descending(meta.created)',
    limit: 50000
  }).objs || [];
}

function _fetchSnapshotsForSearches(searches) {
  if (!searches || searches.length === 0) return [];
  var ids = [];
  for (var i = 0; i < searches.length; i++) {
    ids.push(searches[i].id);
  }
  return PriceSnapshot.fetch({
    filter: Filter.intersects('flightSearch', ids),
    include: 'this',
    order: 'ascending(fetchedAt)',
    limit: 50000
  }).objs || [];
}

function _exportEnvelope(searches, snapshots) {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    searches: searches,
    snapshots: snapshots
  };
}

// ── Serialization Helpers ──────────────────────────────────

/**
 * Compute snapshot counts in-memory from the already-fetched serialized
 * snapshots array rather than issuing a DB query per search (N+1).
 */
function _serializeSearches(searches, serializedSnapshots) {
  var countBySearchId = {};
  for (var s = 0; s < serializedSnapshots.length; s++) {
    var sid = serializedSnapshots[s].flightSearchId || '';
    countBySearchId[sid] = (countBySearchId[sid] || 0) + 1;
  }

  var result = [];
  for (var i = 0; i < searches.length; i++) {
    var search = searches[i];
    result.push({
      id: search.id,
      fromAirport: search.fromAirport || '',
      toAirport: search.toAirport || '',
      tripType: search.tripType || '',
      outboundDate: search.outboundDate ? String(search.outboundDate) : null,
      returnDate: search.returnDate ? String(search.returnDate) : null,
      maxStops: search.maxStops !== undefined && search.maxStops !== null ? search.maxStops : null,
      passengersAdults: search.passengersAdults !== undefined && search.passengersAdults !== null ? search.passengersAdults : 1,
      currency: search.currency || 'USD',
      searchStatus: search.searchStatus || 'active',
      snapshotCount: countBySearchId[search.id] || 0
    });
  }
  return result;
}

function _serializeSnapshots(snapshots) {
  var result = [];
  for (var i = 0; i < snapshots.length; i++) {
    var snap = snapshots[i];
    var searchId = '';
    if (snap.flightSearch) {
      searchId = (typeof snap.flightSearch === 'string') ? snap.flightSearch :
                 (snap.flightSearch.id || '');
    }
    result.push({
      id: snap.id,
      flightSearchId: searchId,
      seatClass: snap.seatClass || '',
      price: snap.price || 0,
      airlineCodes: _toPlainArray(snap.airlineCodes),
      airlineNames: _toPlainArray(snap.airlineNames),
      flightType: snap.flightType || null,
      durationMinutes: snap.durationMinutes || null,
      fetchedAt: snap.fetchedAt ? String(snap.fetchedAt) : null
    });
  }
  return result;
}

// ── CSV Helpers ────────────────────────────────────────────

function _toPlainArray(c3arr) {
  if (!c3arr) return [];
  var result = [];
  for (var i = 0; i < c3arr.length; i++) {
    result.push(c3arr[i]);
  }
  return result;
}

function _csvField(val) {
  if (val === null || val === undefined) return '';
  var str = String(val);
  if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function _csvArrayField(arr) {
  if (!arr || arr.length === 0) return '';
  var escaped = [];
  for (var k = 0; k < arr.length; k++) {
    escaped.push(String(arr[k]).replace(/"/g, '""'));
  }
  return '"' + escaped.join(',') + '"';
}

// ── Import Helpers ─────────────────────────────────────────

function _findSearchByNaturalKey(s) {
  var filter = Filter.eq('fromAirport', s.fromAirport)
    .and(Filter.eq('toAirport', s.toAirport))
    .and(Filter.eq('tripType', s.tripType))
    .and(Filter.eq('outboundDate', s.outboundDate));
  if (s.returnDate) {
    filter = filter.and(Filter.eq('returnDate', s.returnDate));
  }
  var results = FlightSearch.fetch({ filter: filter, include: 'this', limit: 1 }).objs;
  return (results && results.length > 0) ? results[0] : null;
}

function _findSnapshotByNaturalKey(searchId, seatClass, fetchedAt) {
  var filter = Filter.eq('flightSearch', searchId)
    .and(Filter.eq('seatClass', seatClass))
    .and(Filter.eq('fetchedAt', fetchedAt));
  var results = PriceSnapshot.fetch({ filter: filter, include: 'this', limit: 1 }).objs;
  return (results && results.length > 0) ? results[0] : null;
}

function _updateSearch(existingId, importData) {
  var search = FlightSearch.forId(existingId).get('this');
  if (importData.searchStatus) {
    search = search.withField('searchStatus', importData.searchStatus);
  }
  if (importData.maxStops !== undefined && importData.maxStops !== null) {
    search = search.withField('maxStops', importData.maxStops);
  }
  if (importData.passengersAdults !== undefined && importData.passengersAdults !== null) {
    search = search.withField('passengersAdults', importData.passengersAdults);
  }
  if (importData.currency) {
    search = search.withField('currency', importData.currency);
  }
  search.merge();
}

function _updateSnapshot(existingId, importData, resolvedSearchId) {
  var snap = PriceSnapshot.forId(existingId).get('this');
  snap = snap.withField('price', importData.price);
  if (importData.airlineCodes) snap = snap.withField('airlineCodes', importData.airlineCodes);
  if (importData.airlineNames) snap = snap.withField('airlineNames', importData.airlineNames);
  if (importData.flightType !== undefined && importData.flightType !== null) {
    snap = snap.withField('flightType', importData.flightType);
  }
  if (importData.durationMinutes !== undefined && importData.durationMinutes !== null) {
    snap = snap.withField('durationMinutes', importData.durationMinutes);
  }
  snap.merge();
}
