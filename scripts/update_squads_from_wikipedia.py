#!/usr/bin/env python3
"""Refresh 2026 World Cup squad data from Wikipedia.

The Wikipedia article stores each player in MediaWiki template metadata
(`data-mw`) even when the rendered HTML is difficult to scrape. This script
extracts those templates and writes the subset of fields used by the app.
"""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads"
ROOT = Path(__file__).resolve().parents[1]
SQUADS_PATH = ROOT / "data" / "squads.json"

POSITION_MAP = {
    "GK": "Goalkeeper",
    "DF": "Defender",
    "MF": "Midfielder",
    "FW": "Forward",
}

# FIFA / football association codes used by the squad article. Values are the
# country/association labels used elsewhere in the app.
CLUB_NATION_MAP = {
    "ARG": "Argentina",
    "ARM": "Armenia",
    "AUS": "Australia",
    "AUT": "Austria",
    "AZE": "Azerbaijan",
    "ALG": "Algeria",
    "BEL": "Belgium",
    "BIH": "Bosnia and Herzegovina",
    "BRA": "Brazil",
    "BUL": "Bulgaria",
    "CAN": "Canada",
    "CHI": "Chile",
    "CHN": "China",
    "COL": "Colombia",
    "CRC": "Costa Rica",
    "CRO": "Croatia",
    "CYP": "Cyprus",
    "CZE": "Czech Republic",
    "DEN": "Denmark",
    "ECU": "Ecuador",
    "EGY": "Egypt",
    "ENG": "England",
    "ESP": "Spain",
    "FRA": "France",
    "FIN": "Finland",
    "GER": "Germany",
    "GHA": "Ghana",
    "GRE": "Greece",
    "HAI": "Haiti",
    "HON": "Honduras",
    "HUN": "Hungary",
    "IDN": "Indonesia",
    "IRL": "Republic of Ireland",
    "IRN": "Iran",
    "IRQ": "Iraq",
    "ISR": "Israel",
    "ITA": "Italy",
    "JPN": "Japan",
    "JOR": "Jordan",
    "KAZ": "Kazakhstan",
    "KOR": "South Korea",
    "KSA": "Saudi Arabia",
    "KUW": "Kuwait",
    "LUX": "Luxembourg",
    "MAS": "Malaysia",
    "MAR": "Morocco",
    "MEX": "Mexico",
    "NED": "Netherlands",
    "NOR": "Norway",
    "NZL": "New Zealand",
    "PAN": "Panama",
    "PAR": "Paraguay",
    "POL": "Poland",
    "POR": "Portugal",
    "QAT": "Qatar",
    "ROU": "Romania",
    "RUS": "Russia",
    "RSA": "South Africa",
    "SCO": "Scotland",
    "SRB": "Serbia",
    "SUI": "Switzerland",
    "SVK": "Slovakia",
    "SVN": "Slovenia",
    "SWE": "Sweden",
    "THA": "Thailand",
    "TUN": "Tunisia",
    "TUR": "Turkey",
    "UAE": "UAE",
    "UKR": "Ukraine",
    "URU": "Uruguay",
    "USA": "USA",
    "UZB": "Uzbekistan",
    "VEN": "Venezuela",
    "WAL": "Wales",
    "ZAF": "South Africa",
}


def strip_wikilink(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<!--.*?-->", "", value, flags=re.DOTALL)
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)

    def replace_link(match: re.Match[str]) -> str:
        inner = match.group(1)
        if "|" in inner:
            return inner.split("|")[-1]
        return inner

    value = re.sub(r"\[\[([^\]]+)\]\]", replace_link, value)
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("'''", "").replace("''", "")
    return " ".join(value.split()).strip()


class SquadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_h3 = False
        self.h3_parts: list[str] = []
        self.current_team: str | None = None
        self.squads: dict[str, list[dict[str, str]]] = {}
        self.unknown_codes: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "h3":
            self.in_h3 = True
            self.h3_parts = []

        data_mw = attr.get("data-mw")
        if data_mw and self.current_team:
            self._parse_data_mw(data_mw)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h3" and self.in_h3:
            text = " ".join("".join(self.h3_parts).split())
            text = re.sub(r"\[edit\]$", "", text).strip()
            if text and text != "Statistics":
                self.current_team = text
                self.squads.setdefault(text, [])
            self.in_h3 = False

    def handle_data(self, data: str) -> None:
        if self.in_h3:
            self.h3_parts.append(data)

    def _parse_data_mw(self, data_mw: str) -> None:
        try:
            data = json.loads(data_mw)
        except json.JSONDecodeError:
            return

        for part in data.get("parts", []):
            template = part.get("template") if isinstance(part, dict) else None
            if not template:
                continue
            target = template.get("target", {}).get("wt", "")
            if target != "nat fs g player":
                continue

            params = template.get("params", {})
            get = lambda key: params.get(key, {}).get("wt", "")
            code = get("clubnat").strip()
            club_country = CLUB_NATION_MAP.get(code, code)
            if code and code not in CLUB_NATION_MAP:
                self.unknown_codes.add(code)

            player = {
                "name": strip_wikilink(get("name")),
                "club": strip_wikilink(get("club")),
                "position": POSITION_MAP.get(get("pos").strip(), get("pos").strip()),
                "club_country": club_country,
            }
            if player["name"] and player["club"]:
                self.squads.setdefault(self.current_team or "", []).append(player)


def fetch() -> str:
    request = urllib.request.Request(URL, headers={"User-Agent": "world-cup-squad-data-updater/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def main() -> int:
    parser = SquadParser()
    parser.feed(fetch())

    squads = [
        {"team": team, "players": players}
        for team, players in parser.squads.items()
        if players
    ]

    if len(squads) != 48:
        print(f"Expected 48 squads, extracted {len(squads)}", file=sys.stderr)
        print([s["team"] for s in squads], file=sys.stderr)
        return 1

    counts = {s["team"]: len(s["players"]) for s in squads}
    bad_counts = {team: count for team, count in counts.items() if count < 23 or count > 26}
    if bad_counts:
        print(f"Unexpected squad sizes: {bad_counts}", file=sys.stderr)
        return 1

    if parser.unknown_codes:
        print(f"Unknown club nation codes: {sorted(parser.unknown_codes)}", file=sys.stderr)
        return 1

    payload = {"world_cup_2026_squads": squads}
    SQUADS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(squads)} squads / {sum(counts.values())} players to {SQUADS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
