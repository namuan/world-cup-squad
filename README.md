# World Cup Squad Map

Interactive React/Leaflet map showing 2026 World Cup squads and the overseas club connections for each country.

Hover a qualified country to see curved lines from the national team to the clubs where its players are based. Click a country to pin the selection; click the map to clear it.

## Tech stack

- React 19
- TypeScript
- Vite
- Leaflet / React Leaflet

## Getting started

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev        # start local dev server
npm run build      # type-check and build production assets
npm run preview    # preview the production build locally
npm run lint       # run ESLint
npm run typecheck  # run TypeScript checks
```

## Data

- `data/squads.json` contains squad/player data.
- `data/club_coords.json` contains club coordinates used for map connections.
- `data/countries.json` contains GeoJSON country shapes (Natural Earth 10m Admin 0).
- `raw_data/` contains source HTML snapshots used to assemble the dataset.

### Regenerating squad data

```bash
python3 scripts/update_squads_from_wikipedia.py
```

### Regenerating country boundaries

The UK is represented as four separate features (England, Scotland, Wales, Northern
Ireland) rather than a single "United Kingdom" polygon, so each nation has its own
clickable area and connection arc origin on the map.

To regenerate `data/countries.json` from scratch (e.g. after a Natural Earth update):

```bash
./scripts/update_countries_geojson.py                    # first run (downloads data)
./scripts/update_countries_geojson.py --skip-download     # subsequent runs
```

The script downloads the Natural Earth 10m Admin 1 (states/provinces) dataset,
extracts UK features dissolved by `geonunit`, and merges them into the Admin 0
boundaries in place of the single UK feature. It requires Node.js (for
[mapshaper](https://github.com/mbloch/mapshaper)) and Python 3.13+ (for `uv`).

## GitHub Pages deployment

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

To publish:

1. Push the repo to GitHub.
2. In GitHub, go to **Settings → Pages**.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Push to `main`.

The Vite `base` path is derived automatically from `GITHUB_REPOSITORY`, so project pages like `https://OWNER.github.io/world-cup-squad/` work without hard-coding the owner or repo name.
