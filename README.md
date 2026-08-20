# Natura Reseller Ecommerce

Ecommerce responsive para una revendedora de Natura. El proyecto inicia con una arquitectura React + Node.js/Express + PostgreSQL + Prisma, preparado para Docker y despliegue posterior en VPS.

## Stack
- React + Vite + TypeScript
- Node.js + Express + TypeScript
- PostgreSQL
- Prisma
- Docker Compose

## Setup Local
1. Instalar dependencias: `npm install`
2. Copiar `.env.example` a `.env` y configurar `DATABASE_URL` con la base PostgreSQL real.
3. Generar Prisma Client: `npm run prisma:generate`
4. Crear/aplicar migraciones: `npm run prisma:migrate`
5. Levantar servicios: `npm run dev`

La API usa la base `postgres` y el schema PostgreSQL `ecom_natura`. Si la API corre en Docker y PostgreSQL corre en el host, `DATABASE_URL` debe usar `host.docker.internal` como host. Para DBeaver, usar `localhost`.

## Comandos
- `npm run dev`: levanta el stack con Docker Compose.
- `docker compose --profile local-db up -d postgres`: levanta un PostgreSQL local opcional en el puerto host `5433`.
- `npm run dev:api`: levanta solo API local.
- `npm run dev:web`: levanta solo web local.
- `npm run lint`: ejecuta lint en API y web.
- `npm run typecheck`: ejecuta typecheck en API y web.
- `npm run test`: ejecuta tests configurados.
- `npm run build`: compila API y web.
- `npm run prisma:generate`: genera Prisma Client.
- `npm run prisma:migrate`: crea/aplica migraciones de desarrollo.

## Healthcheck
- API con Docker: `GET http://127.0.0.1:3001/api/health`
- API local sin Docker: `GET http://localhost:3000/api/health`

## API Inicial
- `POST /api/auth/register`: registro de cliente.
- `POST /api/auth/login`: login.
- `GET /api/catalog/categories`: categorias activas publicas.
- `GET /api/catalog/products`: productos activos publicos. Acepta `search` y `categorySlug`.
- `GET /api/catalog/products/:slug`: detalle publico de producto.
- `GET /api/admin/categories`: categorias admin, requiere rol `ADMIN` o `SUPER_ADMIN`.
- `POST /api/admin/categories`: crear categoria admin.
- `PATCH /api/admin/categories/:id`: editar categoria admin.
- `GET /api/admin/products`: productos admin.
- `POST /api/admin/products`: crear producto con imagenes, variantes, stock y precio inicial.
- `PATCH /api/admin/products/:id`: editar producto. En esta primera version, si se envian `images` o `variants`, se reemplaza esa coleccion completa.

## Admin Web Inicial
El panel admin minimo esta en la misma web, seccion `#admin`:

- URL: `http://localhost:5173/#admin`
- Requiere iniciar sesion con un usuario cuyo rol sea `ADMIN` o `SUPER_ADMIN`.
- Permite crear categorias.
- Permite crear productos con una variante inicial, stock, precio e imagen por URL.
- Permite listar productos existentes y editar datos principales, imagen principal, variante inicial, stock y precio.
- Despues de crear un producto, el catalogo publico se refresca automaticamente.
- Despues de editar un producto, el catalogo publico y la lista admin se refrescan automaticamente.

Para promover manualmente un usuario a admin durante desarrollo:

```sql
update ecom_natura."User"
set role = 'ADMIN'
where email = 'admin@example.com';
```

## Seguridad
No guardar secretos reales en el repositorio. Usar `.env` local y mantener `.env.example` sin credenciales reales.
