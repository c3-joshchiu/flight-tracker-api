function getHistory(searchId, seatClass) {
  var filterObj = Filter.eq('flightSearch', searchId);
  if (seatClass && seatClass.trim()) {
    filterObj = filterObj.and(Filter.eq('seatClass', seatClass));
  }

  return PriceSnapshot.fetch({
    filter: filterObj,
    include: 'this',
    order: 'ascending(fetchedAt)',
    limit: -1
  }).objs;
}
