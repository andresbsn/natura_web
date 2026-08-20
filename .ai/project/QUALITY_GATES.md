# Quality Gates

Quality gates are project-specific evidence required before a task can be declared verified.
Do not invent commands: reference verified commands from `COMMANDS.md`.

## Global
- `git status` reviewed before and after substantial work.
- `git diff` reviewed before completion.
- No secrets or real `.env` values added to tracked files.
- Unrelated/local-only changes preserved.

## Frontend
- lint: `npm run lint -w apps/web`.
- tests: `npm run test -w apps/web`.
- build/typecheck: `npm run build -w apps/web` and `npm run typecheck -w apps/web`.
- manual verification: validar responsive desktop/mobile, catalogo, carrito, login, checkout y vistas admin afectadas.

## Backend
- lint: `npm run lint -w apps/api`.
- tests: `npm run test -w apps/api`.
- build/typecheck: `npm run build -w apps/api` and `npm run typecheck -w apps/api`.
- API/integration verification: validar endpoints afectados, errores, autorizacion por rol y transacciones de stock/pedidos.

## Database
- migration reviewed: toda modificacion de esquema debe tener migracion revisada.
- backward/rollback strategy evaluated: evaluar rollback y compatibilidad antes de aplicar en produccion.
- constraints/indexes/data compatibility reviewed: revisar claves, indices, unicidad, integridad referencial y datos existentes.
- production impact assessed: migraciones productivas requieren aprobacion humana y backup previo.

## Infrastructure / deployment
- config validated: TODO
- health check: TODO
- rollback procedure: TODO
- production approval required: yes

## Completion rule
If a required gate cannot run or is not configured, report the task as partially verified rather than fully verified.
