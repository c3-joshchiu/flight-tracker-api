function runScheduledSnapshots() {
  var activeSearches = FlightSearch.fetch({
    filter: Filter.eq('searchStatus', 'active'),
    include: 'id',
    limit: -1
  }).objs;

  if (!activeSearches || activeSearches.length === 0) {
    return;
  }

  for (var i = 0; i < activeSearches.length; i++) {
    try {
      PriceSnapshot.fetchNow(activeSearches[i].id);
    } catch (e) {
      // Log and continue so one failing search doesn't block the rest
    }
  }
}
