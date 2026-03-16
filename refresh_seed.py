#!/usr/bin/env python3
"""
Refresh PriceSnapshot seed data so it stays current for the alert algorithm.

Idempotent: only appends new snapshots when today's date has moved past
the last fetchedAt date in the seed file.  New entries copy values from
exactly 7 days prior, preserving the original week-over-week variation.

Usage:
    python refresh_seed.py
"""

import json
import os
from datetime import date, datetime, timedelta

SEED_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "flightPriceTrackerApi",
    "seed",
    "PriceSnapshot",
    "PriceSnapshot.json",
)


def _date_of(fetched_at: str) -> date:
    return datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).date()


def _shift_date(fetched_at: str, source_date: date, target_date: date) -> str:
    dt = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    shifted = dt + (target_date - source_date)
    return shifted.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _max_id_number(snapshots: list[dict]) -> int:
    max_num = 0
    for s in snapshots:
        parts = s["id"].rsplit("_", 1)
        if len(parts) == 2 and parts[1].isdigit():
            max_num = max(max_num, int(parts[1]))
    return max_num


def _id_prefix(snap_id: str) -> str:
    """seed_snap_lax_nrt_economy_1 -> seed_snap_lax_nrt_economy"""
    return snap_id.rsplit("_", 1)[0]


def main():
    with open(SEED_PATH, "r") as f:
        snapshots = json.load(f)

    all_dates = {_date_of(s["fetchedAt"]) for s in snapshots}
    max_date = max(all_dates)
    yesterday = date.today() - timedelta(days=1)

    if max_date >= yesterday:
        print(
            f"Seed data already covers up to {max_date} "
            f"(yesterday={yesterday}). Nothing to do."
        )
        return

    by_date: dict[date, list[dict]] = {}
    for s in snapshots:
        d = _date_of(s["fetchedAt"])
        by_date.setdefault(d, []).append(s)

    next_id = _max_id_number(snapshots) + 1
    new_snapshots: list[dict] = []
    current = max_date + timedelta(days=1)

    while current <= yesterday:
        source = current - timedelta(days=7)
        source_entries = by_date.get(source)
        if not source_entries:
            print(
                f"Warning: no source data for {source} "
                f"(needed by {current}), skipping."
            )
            current += timedelta(days=1)
            continue

        day_entries = []
        for entry in source_entries:
            new_entry = dict(entry)
            new_entry["fetchedAt"] = _shift_date(
                entry["fetchedAt"], source, current
            )
            new_entry["id"] = f"{_id_prefix(entry['id'])}_{next_id}"
            next_id += 1
            day_entries.append(new_entry)

        by_date[current] = day_entries
        new_snapshots.extend(day_entries)
        current += timedelta(days=1)

    if not new_snapshots:
        print("No new data to add.")
        return

    snapshots.extend(new_snapshots)

    with open(SEED_PATH, "w") as f:
        json.dump(snapshots, f, indent=2)
        f.write("\n")

    dates_added = sorted({_date_of(s["fetchedAt"]) for s in new_snapshots})
    print(
        f"Added {len(new_snapshots)} snapshots for "
        f"{len(dates_added)} day(s): {dates_added[0]} -> {dates_added[-1]}"
    )


if __name__ == "__main__":
    main()
