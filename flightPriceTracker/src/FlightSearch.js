function getAll() {
  return FlightSearch.fetch({
    include: 'this',
    order: 'descending(meta.created)',
    limit: -1
  }).objs;
}

function getById(searchId) {
  return FlightSearch.forId(searchId).get('this');
}

function createSearch(data) {
  return FlightSearch.make({
    fromAirport: (data.fromAirport || '').toUpperCase(),
    toAirport: (data.toAirport || '').toUpperCase(),
    tripType: data.tripType || 'one-way',
    outboundDate: data.outboundDate,
    returnDate: data.returnDate || null,
    maxStops: data.maxStops || null,
    passengersAdults: data.passengersAdults || 1,
    language: data.language || 'en-US',
    currency: data.currency || 'USD',
    searchStatus: 'active',
    isTestData: false
  }).create();
}

function updateSearchStatus(searchId, newStatus) {
  var search = FlightSearch.forId(searchId).get('this');
  return search.withField('searchStatus', newStatus).merge();
}

function deleteSearch(searchId) {
  var snapshots = PriceSnapshot.fetch({
    filter: Filter.eq('flightSearch', searchId),
    limit: -1
  }).objs;
  if (snapshots && snapshots.length > 0) {
    PriceSnapshot.removeBatch(snapshots);
  }
  FlightSearch.forId(searchId).get().remove();
  return true;
}

function getLatestPrice(searchId) {
  var result = PriceSnapshot.fetch({
    filter: Filter.eq('flightSearch', searchId).and(Filter.eq('seatClass', 'economy')),
    include: 'this',
    order: 'descending(fetchedAt)',
    limit: 1
  });
  return (result.objs && result.objs.length > 0) ? result.objs[0] : null;
}
