def computeAlert(cls, searchId):
    import json as json_lib

    search = c3.FlightSearch.forId(searchId).get("this")
    if not search:
        return {"status": "grey", "message": "Search not found"}

    now = c3.DateTime.now()
    two_weeks_ago = now.plusDays(-14)

    snapshots = c3.PriceSnapshot.fetch({
        "filter": c3.Filter.eq("flightSearch", searchId)
                    .and_(c3.Filter.eq("seatClass", "economy"))
                    .and_(c3.Filter.ge("fetchedAt", two_weeks_ago.toString())),
        "include": "this",
        "order": "ascending(fetchedAt)",
        "limit": -1
    }).objs

    by_date = {}
    for snap in snapshots:
        day_key = str(snap.fetchedAt)[:10]
        if day_key not in by_date:
            by_date[day_key] = []
        by_date[day_key].append(snap.price)

    daily_min = {d: min(prices) for d, prices in by_date.items()}
    sorted_days = sorted(daily_min.keys())

    google_url = _build_google_url(search)
    cheapest_airline = _latest_cheapest_airline(snapshots)

    if len(sorted_days) < 7:
        return {
            "searchId": searchId,
            "status": "grey",
            "message": "Monitoring... collecting data",
            "currentWeekAvg": None,
            "previousWeekAvg": None,
            "percentChange": None,
            "daysRising": None,
            "cheapestAirline": cheapest_airline,
            "googleFlightsUrl": google_url
        }

    current_week_days = sorted_days[-7:]
    current_week_prices = [daily_min[d] for d in current_week_days]
    current_avg = sum(current_week_prices) / len(current_week_prices)

    if len(sorted_days) >= 14:
        previous_week_days = sorted_days[-14:-7]
    else:
        previous_week_days = sorted_days[:len(sorted_days) - 7]

    if not previous_week_days:
        return {
            "searchId": searchId,
            "status": "grey",
            "message": "Monitoring... need more history",
            "currentWeekAvg": None,
            "previousWeekAvg": None,
            "percentChange": None,
            "daysRising": None,
            "cheapestAirline": cheapest_airline,
            "googleFlightsUrl": google_url
        }

    previous_week_prices = [daily_min[d] for d in previous_week_days]
    previous_avg = sum(previous_week_prices) / len(previous_week_prices)

    comparison_len = min(len(current_week_prices), len(previous_week_prices))
    days_rising = sum(
        1 for i in range(comparison_len)
        if current_week_prices[-(comparison_len - i)] > previous_week_prices[-(comparison_len - i)]
    )

    pct_change = ((current_avg - previous_avg) / previous_avg) * 100 if previous_avg > 0 else 0

    if days_rising >= 5:
        status = "red"
        message = "Price Rising - prices have increased on most days this week"
    elif pct_change <= -20:
        status = "green"
        message = "Price Drop! {}% lower than last week".format(abs(round(pct_change)))
    else:
        status = "grey"
        message = "Prices are stable - no significant change"

    return {
        "searchId": searchId,
        "status": status,
        "message": message,
        "currentWeekAvg": round(current_avg, 2),
        "previousWeekAvg": round(previous_avg, 2),
        "percentChange": round(pct_change, 2),
        "daysRising": days_rising,
        "cheapestAirline": cheapest_airline,
        "googleFlightsUrl": google_url
    }


def _build_google_url(search):
    """Build a Google Flights search URL using protobuf encoding."""
    from base64 import b64encode

    seat_map = {"economy": 1, "premium-economy": 2, "business": 3, "first": 4}
    trip_map = {"round-trip": 1, "one-way": 2}

    date_str = str(search.outboundDate)[:10]
    from_code = search.fromAirport
    to_code = search.toAirport

    flight_data = _encode_flight_data(date_str, from_code, to_code, None)

    if search.tripType == "round-trip" and search.returnDate:
        return_date = str(search.returnDate)[:10]
        flight_data2 = _encode_flight_data(return_date, to_code, from_code, None)
        flight_data = flight_data + flight_data2

    info = b""
    info += flight_data
    adults = search.passengersAdults or 1
    for _ in range(adults):
        info += _encode_varint_field(8, 1)
    info += _encode_varint_field(9, seat_map.get("economy", 1))
    info += _encode_varint_field(19, trip_map.get(search.tripType, 2))

    tfs = b64encode(info).decode("utf-8")

    url = "https://www.google.com/travel/flights/search?tfs=" + tfs
    if search.language:
        url += "&hl=" + search.language
    if search.currency:
        url += "&curr=" + search.currency
    return url


def _encode_varint(value):
    result = b""
    while value > 0x7F:
        result += bytes([(value & 0x7F) | 0x80])
        value >>= 7
    result += bytes([value & 0x7F])
    return result


def _encode_varint_field(field_number, value):
    tag = (field_number << 3) | 0
    return _encode_varint(tag) + _encode_varint(value)


def _encode_len_field(field_number, data):
    tag = (field_number << 3) | 2
    return _encode_varint(tag) + _encode_varint(len(data)) + data


def _encode_string_field(field_number, value):
    return _encode_len_field(field_number, value.encode("utf-8"))


def _encode_flight_data(date_str, from_code, to_code, max_stops):
    inner = b""
    inner += _encode_string_field(2, date_str)
    if max_stops is not None:
        inner += _encode_varint_field(5, max_stops)
    airport_from = _encode_string_field(2, from_code)
    inner += _encode_len_field(13, airport_from)
    airport_to = _encode_string_field(2, to_code)
    inner += _encode_len_field(14, airport_to)
    return _encode_len_field(3, inner)


def _latest_cheapest_airline(snapshots):
    if not snapshots:
        return None
    latest = snapshots[-1] if snapshots else None
    if latest and latest.airlineNames:
        names = latest.airlineNames
        return names[0] if names else None
    return None
