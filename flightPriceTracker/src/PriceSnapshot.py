def fetchNow(cls, searchId):
    """
    Fetch live prices from Google Flights using a reimplemented
    protobuf query builder and HTML parser.
    Silently skips seat classes where the live fetch fails,
    matching the original FastAPI backend behaviour.
    """
    import json as json_lib

    search = c3.FlightSearch.forId(searchId).get("this")
    if not search:
        return []

    snapshots = []
    now = c3.DateTime.now()

    for seat in ["economy", "business"]:
        result = _fetch_cheapest(search, seat)
        if result:
            snap = c3.PriceSnapshot.make({
                "flightSearch": c3.FlightSearch.forId(searchId),
                "seatClass": seat,
                "price": result["price"],
                "airlineCodes": result["airlines"],
                "airlineNames": result["airlines"],
                "flightType": result["flight_type"],
                "durationMinutes": result.get("duration"),
                "fetchedAt": now.toString()
            }).create()
            snapshots.append(snap)
        # If live fetch fails, skip this seat class (no mock fallback)

    return snapshots


def _fetch_cheapest(search, seat):
    """
    Fetch HTML from Google Flights and parse the cheapest flight.
    Uses a reimplemented protobuf query builder and HTML parser.
    """
    import json as json_lib
    import re

    try:
        html = _fetch_flights_html(search, seat)
        if not html:
            return None

        results = _parse_flights_html(html)
        if not results:
            return None

        cheapest = min(results, key=lambda f: f["price"])
        num_legs = cheapest.get("num_legs", 1)
        flight_type = "direct" if num_legs == 1 else "{} stop".format(num_legs - 1)

        return {
            "price": cheapest["price"] * 100,  # Convert dollars to cents
            "airlines": cheapest.get("airlines", []),
            "flight_type": flight_type,
            "duration": cheapest.get("total_duration")
        }
    except Exception:
        return None


def _fetch_flights_html(search, seat):
    """
    Build a Google Flights URL using protobuf encoding and fetch the HTML.
    Reimplements fast_flights.fetch_flights_html without external dependencies.
    """
    from base64 import b64encode

    seat_map = {"economy": 1, "premium-economy": 2, "business": 3, "first": 4}
    trip_map = {"round-trip": 1, "one-way": 2}

    date_str = str(search.outboundDate)[:10]
    from_code = search.fromAirport
    to_code = search.toAirport

    # Build protobuf Info message
    flight_data = _encode_flight_data(date_str, from_code, to_code, search.maxStops)

    if search.tripType == "round-trip" and search.returnDate:
        return_date = str(search.returnDate)[:10]
        flight_data += _encode_flight_data(return_date, to_code, from_code, search.maxStops)

    info = b""
    info += flight_data
    adults = search.passengersAdults or 1
    for _ in range(adults):
        info += _encode_varint_field(8, 1)  # ADULT passenger
    info += _encode_varint_field(9, seat_map.get(seat, 1))
    info += _encode_varint_field(19, trip_map.get(search.tripType, 2))

    tfs = b64encode(info).decode("utf-8")

    params = {
        "tfs": tfs,
        "hl": search.language or "en-US",
        "curr": search.currency or "USD",
    }

    try:
        import urllib.request
        import urllib.parse

        url = "https://www.google.com/travel/flights/search?" + urllib.parse.urlencode(params)

        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": search.language or "en-US",
        })

        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def _parse_flights_html(html):
    """
    Parse Google Flights HTML and return flights from all sections.
    Reimplements the custom parser without selectolax dependency.
    """
    import json as json_lib
    import re

    # Find the script.ds:1 tag content
    pattern = r'<script[^>]*class="ds:1"[^>]*>(.*?)</script>'
    match = re.search(pattern, html, re.DOTALL)
    if not match:
        return []

    js = match.group(1)

    try:
        data_str = js.split("data:", 1)[1].rsplit(",", 1)[0]
        payload = json_lib.loads(data_str)
    except (IndexError, json_lib.JSONDecodeError):
        return []

    flights = []

    # payload[2][0] = "Top/Best flights", payload[3][0] = "Other flights"
    sources = []
    try:
        if payload[2] and payload[2][0] is not None:
            sources.append(payload[2][0])
    except (IndexError, TypeError):
        pass

    try:
        if payload[3] and payload[3][0] is not None:
            sources.append(payload[3][0])
    except (IndexError, TypeError):
        pass

    for section in sources:
        for k in section:
            try:
                flight_data = k[0]
                price = k[1][0][1]
                if not isinstance(price, (int, float)):
                    continue

                airlines = flight_data[1] if flight_data[1] else []
                legs = flight_data[2] if flight_data[2] else []
                num_legs = len(legs)

                total_duration = None
                try:
                    total_duration = sum(leg[11] for leg in legs if leg[11])
                except (IndexError, TypeError):
                    pass

                flights.append({
                    "price": int(price),
                    "airlines": airlines,
                    "num_legs": num_legs,
                    "total_duration": total_duration,
                })
            except (IndexError, TypeError, KeyError):
                continue

    # Deduplicate by (price, airlines)
    seen = set()
    deduped = []
    for f in flights:
        key = (f["price"], ",".join(f["airlines"]) if f["airlines"] else "")
        if key not in seen:
            seen.add(key)
            deduped.append(f)

    return deduped


# --- Protobuf encoding helpers ---

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
