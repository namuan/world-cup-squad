#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = [
#   "requests",
#   "persistent-cache@git+https://github.com/namuan/persistent-cache"
# ]
# ///
"""
Update countries.json to split the United Kingdom into its constituent
countries (England, Scotland, Wales, Northern Ireland).

The base data/countries.json is Natural Earth 10m Admin 0 countries (country
level boundaries). This script replaces the single "United Kingdom" feature
with four separate features dissolved from the 10m Admin 1 (states/provinces)
dataset by the geonunit field — giving each nation its own boundary, center,
and clickable area on the World Cup squad map.

Usage:
  ./scripts/update_countries_geojson.py                          # use defaults
  ./scripts/update_countries_geojson.py --countries FILE         # custom input
  ./scripts/update_countries_geojson.py --output FILE            # custom output
  ./scripts/update_countries_geojson.py -v                       # INFO logging
  ./scripts/update_countries_geojson.py -vv                      # DEBUG logging
  ./scripts/update_countries_geojson.py --skip-download          # reuse cached data
"""

import json
import logging
import subprocess
import sys
import zipfile
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from pathlib import Path

import requests
from persistent_cache import PersistentCache

# ── URLs ──────────────────────────────────────────────────────────────────────
ADMIN1_URL = (
    "https://naciscdn.org/naturalearth/10m/cultural/"
    "ne_10m_admin_1_states_provinces.zip"
)

# ── Cache decorator ───────────────────────────────────────────────────────────
cache = PersistentCache(cache_dir=".cache/update_countries", expiry_seconds=None)


def setup_logging(verbosity: int) -> None:
    logging_level = logging.WARNING
    if verbosity == 1:
        logging_level = logging.INFO
    elif verbosity >= 2:
        logging_level = logging.DEBUG

    logging.basicConfig(
        handlers=[logging.StreamHandler()],
        format="%(asctime)s - %(filename)s:%(lineno)d - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        level=logging_level,
    )
    logging.captureWarnings(capture=True)


def parse_args():
    parser = ArgumentParser(
        description=__doc__, formatter_class=RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--countries",
        default="data/countries.json",
        help="Path to the Natural Earth Admin 0 GeoJSON (default: data/countries.json)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path (default: same as --countries, i.e. in-place)",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip downloading — use previously cached Admin 1 data",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        dest="verbose",
        help="Increase verbosity of logging output",
    )
    return parser.parse_args()


# ── Download helpers ──────────────────────────────────────────────────────────

@cache
def _cached_download(url: str) -> bytes:
    """Download a URL and cache the result on disk."""
    logging.info("Downloading %s …", url)
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    logging.info("Downloaded %d bytes", len(resp.content))
    return resp.content


def download_admin1_zip(target_dir: Path, skip: bool = False) -> Path:
    """Download and extract the Admin 1 shapefile, returning path to .shp."""
    zip_path = target_dir / "ne_10m_admin_1.zip"
    shp_dir = target_dir / "ne_10m_admin_1"

    if not skip:
        logging.info("Downloading Admin 1 data from Natural Earth …")
        data = _cached_download(ADMIN1_URL)
        zip_path.write_bytes(data)
    else:
        if not zip_path.exists():
            logging.error(
                "--skip-download but no cached zip at %s", zip_path
            )
            sys.exit(1)

    if not shp_dir.exists():
        logging.info("Extracting %s …", zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(shp_dir)

    shp_files = list(shp_dir.glob("*.shp"))
    if not shp_files:
        logging.error("No .shp file found in extracted Admin 1 data")
        sys.exit(1)
    return shp_files[0]


# ── Mapshaper processing ─────────────────────────────────────────────────────

def check_mapshaper() -> None:
    """Ensure npx + mapshaper are available."""
    try:
        subprocess.run(
            ["npx", "-y", "mapshaper", "--version"],
            capture_output=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        logging.error(
            "mapshaper is required. Install Node.js then run: npm install -g mapshaper"
        )
        sys.exit(1)


def dissolve_uk_regions(shp_path: Path, out_geojson: Path) -> None:
    """Filter Admin 1 to UK features and dissolve by geonunit.

    Produces a GeoJSON with up to 4 features: England, Scotland, Wales,
    Northern Ireland (plus any minor territories present in the dataset).
    """
    logging.info("Filtering UK features from Admin 1 and dissolving by geonunit …")
    # Work in the same directory as the source .shp to keep sidecar files happy
    work_dir = shp_path.parent

    # Use absolute paths so mapshaper works regardless of cwd
    shp_abs = shp_path.resolve()
    out_abs = out_geojson.resolve()
    cmd = [
        "npx", "-y",
        "mapshaper",
        str(shp_abs),
        "-filter", 'admin == "United Kingdom"',
        "-dissolve", "geonunit", "copy-fields=geonunit",
        "-each", "this.properties = { name: geonunit }",
        "-simplify", "dp", "20%",          # match Admin 0 resolution
        "-o", "format=geojson",
        str(out_abs),
    ]
    logging.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logging.error("mapshaper failed:\n%s", result.stderr)
        sys.exit(1)
    if result.stdout:
        logging.debug("mapshaper output: %s", result.stdout.strip())

    # Validate output
    if not out_geojson.exists():
        logging.error("mapshaper did not produce output at %s", out_geojson)
        sys.exit(1)

    with open(out_geojson) as f:
        data = json.load(f)
    names = [f["properties"]["name"] for f in data["features"]]
    logging.info("Dissolved into %d features: %s", len(data["features"]), names)


# ── GeoJSON merging ──────────────────────────────────────────────────────────

def merge_uk_countries(
    countries_path: Path,
    uk_geojson_path: Path,
    output_path: Path,
) -> None:
    """Replace the single 'United Kingdom' feature with the dissolved ones.

    Idempotent: if the constituent countries already exist (and no old
    'United Kingdom' feature is present), this is a no-op.
    """
    logging.info("Reading %s …", countries_path)
    with open(countries_path) as f:
        countries = json.load(f)

    logging.info("Reading UK constituent GeoJSON …")
    with open(uk_geojson_path) as f:
        uk_data = json.load(f)

    uk_names = {f["properties"]["name"] for f in uk_data["features"]}

    # Check if already applied (all UK constituent names present, no old UK)
    existing_names = {f["properties"].get("name") for f in countries["features"]}
    already_done = uk_names.issubset(existing_names) and "United Kingdom" not in existing_names
    if already_done:
        logging.info(
            "UK constituent countries already present in %s — nothing to do",
            countries_path,
        )
        return

    old_count = len(countries["features"])
    new_features = [
        f
        for f in countries["features"]
        if f["properties"].get("name") != "United Kingdom"
        and f["properties"].get("name") not in uk_names
    ]
    removed = old_count - len(new_features)
    if removed:
        logging.info("Removed %d old feature(s)", removed)

    for feat in uk_data["features"]:
        name = feat["properties"]["name"]
        # Keep only the name property for consistency with Admin 0 style
        feat["properties"] = {"name": name}
        new_features.append(feat)
        logging.info("  Added: %s", name)

    countries["features"] = new_features
    logging.info(
        "Total features: %d → %d", old_count, len(new_features)
    )

    with open(output_path, "w") as f:
        json.dump(countries, f)
    logging.info("Wrote %s", output_path)


# ── Main ─────────────────────────────────────────────────────────────────────

def main(args):
    logging.debug("Arguments: %s", args)

    if args.output is None:
        args.output = args.countries

    countries_path = Path(args.countries)
    output_path = Path(args.output)

    if not countries_path.exists():
        logging.error("Countries file not found: %s", countries_path)
        sys.exit(1)

    # Ensure mapshaper is available
    check_mapshaper()

    # Download / extract Admin 1
    work_dir = Path(".cache/update_countries")
    work_dir.mkdir(parents=True, exist_ok=True)

    shp_path = download_admin1_zip(work_dir, skip=args.skip_download)

    # Dissolve UK regions
    uk_geojson_path = work_dir / "uk_countries.geojson"
    dissolve_uk_regions(shp_path, uk_geojson_path)

    # Merge into countries.json
    merge_uk_countries(countries_path, uk_geojson_path, output_path)

    logging.info("Done — %s now has England, Scotland, Wales, NI as separate features", output_path)


if __name__ == "__main__":
    args = parse_args()
    setup_logging(args.verbose)
    main(args)
