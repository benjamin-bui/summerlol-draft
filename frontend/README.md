# Frontend

React application built with Vite. It consumes the API from the sibling
`../backend/` service; the production bundle is served from
`../backend/public/`.

## Development

Use Node.js 22.12 or newer with npm:

```sh
npm ci
npm run dev
```

Start the backend separately from `../backend/` on port 3000. Vite runs on
port 5173 and proxies `/api` and `/icons` to that backend.

## Build

```sh
npm run build
```

The local build writes to `../backend/public/`. This directory contains
generated output; make UI changes under `src/`. The root Dockerfile sets
`VITE_OUT_DIR` so its multi-stage build does not modify the working tree.

## Tests and Lint

```sh
npm run lint
npm test
```

Vitest runs in jsdom. The current smoke suite mounts the app against API
response fixtures in `test-fixtures/`; `src/__tests__/setup.js` mocks
`fetch`, `ResizeObserver`, and `matchMedia`. These tests exercise component
rendering, data loading, tab navigation, and selected user flows. They do not
replace browser-level visual or interaction testing.

When an API response shape intentionally changes, update the relevant
fixtures from a running local backend and review the resulting JSON before
committing it. Fixtures should represent the response contract required by
the UI, not unrelated database changes.

## Source Layout

- `src/App.jsx` and `src/main.jsx`: app shell and client entry point.
- `src/pages/`: tab and profile views.
- `src/components/`: shared controls and table components.
- `src/api/client.js`: API requests.
- `src/charts/`: chart components.
- `src/utils/`: formatting, filtering, and profile calculations.
- `src/__tests__/`: Vitest tests and shared setup.
- `test-fixtures/`: API response fixtures used by tests.
- `src/style.css`: application styles.
