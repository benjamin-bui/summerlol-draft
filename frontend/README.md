# summerlol-draft frontend

React (Vite) port of the old vanilla-JS `public/` front-end. The Express +
SQLite backend (`../summerlol-draft/server.js`) is untouched -- this only
replaces how the pages are built and rendered.

## Develop

```
npm install
npm run dev          # http://localhost:5173, proxies /api and /icons to :3000
```

Run the backend separately on port 3000 (`cd ../summerlol-draft && npm start`)
while developing.

## Build for production

```
npm run build
```

Builds straight into `../summerlol-draft/public/`, overwriting the old
`index.html`/`app.js`/`js/*.js` (icons and any other static assets in
`public/` are left alone). Deploying is then just `npm start` in the backend
-- no separate static host needed.

## Test

```
npm run lint   # eslint, including react-hooks rules
npm test       # vitest + @testing-library/react, jsdom
```

The test suite in `src/__tests__/` mounts the real app against snapshots of
actual production API responses (`test-fixtures/`, mocked via `global.fetch`
in `src/__tests__/setup.js`) and clicks through every tab, so it exercises
real data-fetch effects and re-renders, not just static markup. If the
backend's data shapes change, re-fetch the fixtures:

```
cd ../summerlol-draft && npm start &
curl -s http://localhost:3000/api/trueskill > ../frontend/test-fixtures/trueskill.json
curl -s http://localhost:3000/api/draft-analysis > ../frontend/test-fixtures/draftanalysis.json
curl -s http://localhost:3000/api/tournaments > ../frontend/test-fixtures/tournaments.json
curl -s http://localhost:3000/api/raw > ../frontend/test-fixtures/raw.json
curl -s http://localhost:3000/api/raw-matches > ../frontend/test-fixtures/rawmatches.json
curl -s http://localhost:3000/api/meta > ../frontend/test-fixtures/meta.json
curl -s http://localhost:3000/api/presets > ../frontend/test-fixtures/presets.json
curl -s "http://localhost:3000/api/player/<some-slug>" > ../frontend/test-fixtures/player.json
```

## Structure

- `src/components/table/DataTable.jsx` -- the reusable table (sorting,
  per-column filters, show/hide columns, pagination, sticky columns,
  expandable rows) used by every tab that shows tabular data. This replaces
  the old `public/js/table-utils.js`, which each tab used to wire up by hand.
- `src/components/shared/` -- small presentational pieces reused across tabs
  and the player profile page (`PlayerLink`, `ChampionIcon`, `RankBadge`,
  `TrueSkillValue`, `NameFilterBox`, `PlayerSearchBox`, ...).
- `src/pages/` -- one file per tab, plus the player profile pages.
- `src/charts/DraftScatterChart.jsx` -- the Draft IQ vs. win-rate scatter
  plot (custom SVG: regression line, drag-to-zoom, grouping, tooltip).
- `src/utils/` -- pure logic ported from the old `utils.js`/`player-profile.js`
  (formatting, name matching, profile stat computation) -- kept
  framework-agnostic so it's covered by `test-fixtures`-backed unit checks
  independent of rendering.
- `src/style.css` -- unchanged copy of the old `public/style.css`. Every
  component uses the same class names the old HTML did, so today's look is
  preserved; restyling later is just editing this file and/or the JSX, not
  untangling render logic first.
