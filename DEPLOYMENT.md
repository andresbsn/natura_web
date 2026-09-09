# Despliegue en VPS

Configuracion pensada para clonar el repo en el VPS y levantar contenedores sin usar archivos `.env` versionados.

## Puertos por defecto

- Web: `8097 -> 80` (`WEB_HOST_PORT=8097`)
- API: `3027 -> 3000` (`API_HOST_PORT=3027`)
- PostgreSQL: sin puerto publicado; solo red interna de Docker.

Estos puertos evitan los contenedores existentes informados en el VPS.

## Variables requeridas en el VPS

Crear manualmente un archivo `.env` en la raiz del clon del VPS. No subirlo al repositorio.

```dotenv
POSTGRES_DB=postgres
POSTGRES_USER=...
POSTGRES_PASSWORD=...
DATABASE_URL=postgresql://USUARIO_REAL:PASSWORD_REAL@postgres:5432/postgres?schema=ecom_natura

WEB_URL=http://IP_O_DOMINIO:8097
CORS_ORIGIN=http://IP_O_DOMINIO:8097
VITE_API_URL=http://IP_O_DOMINIO:3027

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Usar secretos largos y reales solo en el VPS. Para exponer por dominio con Nginx externo/TLS, cambiar `WEB_URL`, `CORS_ORIGIN` y `VITE_API_URL` al dominio publico correspondiente.

## Comandos

```bash
git clone <repo>
cd natura
# crear .env manualmente
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api npm run prisma:migrate:deploy -w apps/api
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Para cargar los productos iniciales en la imagen de produccion:

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run import:natura-products:prod -w apps/api
```

Antes de migraciones productivas con datos reales: hacer backup de PostgreSQL y tener definido el commit anterior para rollback.
