# Agent Guidelines

## Project shape

- This is a lightweight React/Vite frontend with an Express/SQLite backend.
  The backend serves the production frontend bundle and owns data ingestion,
  match analysis, authentication, and editing APIs.
- Work in `frontend/src/` and `backend/`; do not hand-edit generated files in
  `backend/public/assets/`.
- See the [project README](README.md), [frontend guide](frontend/README.md),
  and [backend guide](backend/README.md) for setup, data formats, and detailed
  workflows.

## Conventions and verification

- Preserve existing patterns and API behavior. Keep changes focused, reuse
  existing components/helpers, and update directly related documentation.
- Use the repository's Node.js 22.12+ toolchain. Frontend code uses React and
  Vite; backend code uses CommonJS, Express, and SQLite.
- Run the narrow relevant tests first. The frontend scripts are `npm test`,
  `npm run lint`, and `npm run build` from `frontend/`; backend tests are
  `npm test` from `backend/`.
- Do not commit credentials, local environment files, runtime databases, or
  generated frontend bundles.

## Hosting constraints

Keep the application practical to run on a small Oracle Cloud Free Tier VPS
alongside an OIDC provider and other lightweight containers. Prefer the
existing single Express + SQLite service and static frontend build over adding
always-on services or heavy dependencies without a clear need.

As a planning baseline only, Oracle currently describes Always Free Ampere A1
compute as a combined allowance equivalent to up to 2 OCPUs and 12 GB memory,
with 200 GB of block-volume storage. Oracle's published outbound-transfer
allowance is commonly around 10 TB/month. These are tenancy-wide allowances,
not resources reserved for this project; they may vary by account, region,
availability, and current Oracle terms. Confirm the current limits in the OCI
Console and current pricing documentation:

- [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Cloud pricing](https://www.oracle.com/cloud/price-list/#pricing-networking)

Do not treat quota as a target or assume the application uses a particular
amount of CPU, memory, disk, or bandwidth without measuring it. Account for
the host OS, OIDC provider, and all containers together; leave headroom, set
conservative per-container CPU/memory limits where supported, monitor actual
usage and egress, and avoid unnecessary polling, scheduled work, or large
network transfers.
