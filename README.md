# Stockroom

Stockroom is a small admin app for an online store. Staff use it to see how the store is doing, browse the catalog, look up orders and create phone orders.

Your task is in [TASK.md](TASK.md). This file explains how to run the app.

## Stack

- **API:** Node, TypeScript, Fastify, Zod, PostgreSQL (raw SQL with `pg`)
- **Web:** React, TypeScript, Vite, React Router, Recharts
- **Tests:** Vitest, against a real Postgres test database

## Setup

You need Node 20 or later and Docker.

```bash
npm install
npm run setup   # starts Postgres in Docker, runs migrations, loads seed data
npm run dev     # API on http://localhost:4000, web app on http://localhost:5173
```

Open http://localhost:5173.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the API tests against the `stockroom_test` database |
| `npm run typecheck` | Type-checks the API and the web app |
| `npm run db:seed` | Resets the dev database to the seed data |
| `npm run db:migrate` | Applies new files in `server/db/migrations` |
| `npm run db:down` | Stops Postgres |

Seed data is relative to today's date, so it always shows recent activity. Reseed whenever you want a clean state.

## Layout

```
server/
  db/migrations/    SQL migrations, applied in file-name order
  scripts/          migrate and seed scripts
  src/
    routes/         HTTP routes (validation with Zod)
    services/       business logic and SQL
    config.ts       app settings
  test/             API tests
web/
  src/
    pages/          one component per screen
    components/     shared UI (ui.tsx), charts, layout
    api.ts          typed API client
    styles.css      design tokens and component styles
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/dashboard?days=30` | KPIs, revenue by day, top products |
| GET | `/api/products?limit=20&cursor=...` | Cursor-paginated catalog |
| GET | `/api/orders` | 50 most recent orders |
| GET | `/api/orders/:id` | Order with line items, refunds and derived status (`paid`, `partially_refunded`, `refunded`, `cancelled`) |
| POST | `/api/orders` | `{ customerEmail, items: [{ productId, quantity }], discountCode? }` |
| POST | `/api/orders/:id/refunds/preview` | `{ items: [{ orderItemId, quantity }] }`, returns the amount without refunding |
| POST | `/api/orders/:id/refunds` | `{ items: [{ orderItemId, quantity }], reason? }`, refunds, restocks, returns the order |

## Design

The web app has a small design system in `web/src/styles.css` and `web/src/components/ui.tsx`. Please build new UI with these tokens and components so it looks like the rest of the app.
