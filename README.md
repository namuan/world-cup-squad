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
- `data/countries.json` contains GeoJSON country shapes.
- `raw_data/` contains source HTML snapshots used to assemble the dataset.

## GitHub Pages deployment

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

To publish:

1. Push the repo to GitHub.
2. In GitHub, go to **Settings → Pages**.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Push to `main`.

The Vite `base` path is derived automatically from `GITHUB_REPOSITORY`, so project pages like `https://OWNER.github.io/world-cup-squad/` work without hard-coding the owner or repo name.
