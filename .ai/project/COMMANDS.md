# Project Commands

Agents must use verified commands from this file rather than inventing project commands.

El proyecto usa npm workspaces con `apps/api` y `apps/web`.

## Install
- `npm install`

## Development
- Full stack con Docker: `npm run dev`
- API local: `npm run dev:api`
- Web local: `npm run dev:web`

## Frontend
- lint: `npm run lint -w apps/web`
- test: `npm run test -w apps/web`
- build: `npm run build -w apps/web`
- typecheck: `npm run typecheck -w apps/web`

## Backend
- lint: `npm run lint -w apps/api`
- test: `npm run test -w apps/api`
- build: `npm run build -w apps/api`
- typecheck: `npm run typecheck -w apps/api`

## Database / migrations
- generate client: `npm run prisma:generate`
- development migration: `npm run prisma:migrate`
- import initial Natura products: `npm run import:natura-products -w apps/api`
- import initial Natura products in production container: `docker compose -f docker-compose.prod.yml run --rm api npm run import:natura-products:prod -w apps/api`
- direct workspace generate: `npm run prisma:generate -w apps/api`
- direct workspace migrate: `npm run prisma:migrate -w apps/api`
- Docker migrate against `postgres.ecom_natura`: `docker compose run --rm api npm run prisma:migrate -w apps/api`
- production migration deploy: `docker compose -f docker-compose.prod.yml run --rm api npm run prisma:migrate:deploy -w apps/api`

## Docker / services
- start/rebuild: `docker compose up --build`
- start with optional local PostgreSQL container: `docker compose --profile local-db up --build`
- stop: `docker compose down`
- logs: `docker compose logs`

## Logs / health checks
- API health con Docker: `GET http://127.0.0.1:3001/api/health`
- API health local sin Docker: `GET http://localhost:3000/api/health`
- API logs: `docker compose logs api`
- Web logs: `docker compose logs web`

## API endpoints
- Public catalog: `GET /api/catalog/categories`, `GET /api/catalog/products`, `GET /api/catalog/products/:slug`.
- Admin catalog: `GET|POST /api/admin/categories`, `PATCH /api/admin/categories/:id`, `GET|POST /api/admin/products`, `PATCH /api/admin/products/:id`.

## Deployment
- VPS production build/start: `docker compose -f docker-compose.prod.yml up -d --build`
- VPS production status: `docker compose -f docker-compose.prod.yml ps`
- Produccion en VPS requiere `.env` creado manualmente fuera de git, backup previo antes de migraciones con datos reales y aprobacion humana antes de acciones destructivas o cambios productivos.
