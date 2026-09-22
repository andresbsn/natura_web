# Despliegue en VPS

Configuracion pensada para clonar el repo en el VPS y levantar contenedores sin usar archivos `.env` versionados.

## Puertos por defecto

- Web: `127.0.0.1:8097 -> 80` (`WEB_HOST_PORT=8097`)
- API: `127.0.0.1:3027 -> 3000` (`API_HOST_PORT=3027`)
- PostgreSQL: sin puerto publicado; solo red interna de Docker.

Estos puertos evitan los contenedores existentes informados en el VPS.

## Variables requeridas en el VPS

Crear manualmente un archivo `.env` en la raiz del clon del VPS. No subirlo al repositorio.

```dotenv
POSTGRES_DB=postgres
POSTGRES_USER=...
POSTGRES_PASSWORD=...
DATABASE_URL=postgresql://USUARIO_REAL:PASSWORD_REAL@postgres:5432/postgres?schema=ecom_natura

WEB_URL=https://IP_O_DOMINIO
CORS_ORIGIN=https://IP_O_DOMINIO
VITE_API_URL=https://IP_O_DOMINIO

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Usar secretos largos y reales solo en el VPS. Nginx externo debe terminar TLS y publicar el web; debe reenviar `/api` al API local. No publicar directamente los puertos de los contenedores: si se requiere otra topologia, configurar explicitamente `API_BIND` y `WEB_BIND` y conservar HTTPS.

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

## Migracion de cuenta corriente y creditos

Las migraciones de separacion de deuda/credito y de idempotencia de pagos requieren una ventana de mantenimiento. No ejecutar un despliegue rolling con una API anterior activa: esa version no conoce `appliedAmount`, `creditAmount` ni las claves idempotentes.

Orden seguro en el VPS:

```bash
docker compose -f docker-compose.prod.yml stop api
# realizar y verificar backup de PostgreSQL y uploads
docker compose -f docker-compose.prod.yml run --rm api npm run prisma:migrate:deploy -w apps/api
docker compose -f docker-compose.prod.yml up -d api web
docker compose -f docker-compose.prod.yml ps
```

Verificar luego que los pagos nuevos incluyan clave idempotente, que los importes aplicados y excedentes sean correctos, y que la cuenta corriente muestre deuda y credito por separado. La migracion debe probarse primero sobre una copia representativa de los datos.
