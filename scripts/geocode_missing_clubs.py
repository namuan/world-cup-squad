#!/usr/bin/env python3
"""Geocode clubs missing from club_coords.json using OSM Nominatim."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COORDS_PATH = ROOT / "data" / "club_coords.json"
SQUADS_PATH = ROOT / "data" / "squads.json"
UA = "world-cup-squad-geocoder/1.0 (github.com)"


def geocode_club(name: str, country: str | None = None, *, _retry: bool = True) -> tuple[float, float] | None:
    """Try to geocode a club name, optionally scoped to country."""
    query = f"{name} football stadium"
    params = {"q": query, "format": "json", "limit": "1"}
    if country:
        params["country"] = country

    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            results = json.loads(resp.read().decode())
    except Exception as e:
        print(f"HTTP err", end=" ")
        if _retry and country:
            return geocode_club(name, _retry=False)
        return None

    if not results:
        # Retry with just the club name (no "football stadium")
        params["q"] = name
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                results = json.loads(resp.read().decode())
        except Exception:
            if _retry and country:
                return geocode_club(name, _retry=False)
            return None

    if results:
        return float(results[0]["lat"]), float(results[0]["lon"])
    return None


def main() -> int:
    coords = json.loads(COORDS_PATH.read_text(encoding="utf-8"))
    squads = json.loads(SQUADS_PATH.read_text(encoding="utf-8"))["world_cup_2026_squads"]

    # Build country lookup for each club
    club_country: dict[str, str] = {}
    for squad in squads:
        for p in squad["players"]:
            if p["club"] not in club_country:
                club_country[p["club"]] = p.get("club_country", "")

    all_clubs = sorted(club_country.keys())
    missing = [c for c in all_clubs if c not in coords]

    if not missing:
        print("No missing clubs!")
        return 0

    print(f"Geocoding {len(missing)} clubs...")
    success = 0
    fail = 0

    for i, club in enumerate(missing):
        country = club_country.get(club, "")
        print(f"  [{i+1}/{len(missing)}] '{club}' ({country}) ...", end=" ", flush=True)

        result = geocode_club(club, country if country else None)
        if result:
            lat, lng = result
            coords[club] = {"lat": round(lat, 7), "lng": round(lng, 7)}
            print(f"OK → {lat:.4f}, {lng:.4f}")
            success += 1
        else:
            print("FAILED")
            fail += 1

        # Rate limit: 1 req/sec
        if i < len(missing) - 1:
            time.sleep(1.05)

        # Save progress every 20 clubs
        if (i + 1) % 20 == 0:
            COORDS_PATH.write_text(json.dumps(coords, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  [saved checkpoint at {i+1}]")

    # Final save
    COORDS_PATH.write_text(json.dumps(coords, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nDone! Success: {success}, Failed: {fail}")
    print(f"Total clubs with coords: {len(coords)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
