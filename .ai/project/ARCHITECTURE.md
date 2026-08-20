# Architecture

## Current architecture
Proyecto nuevo. No existe codigo de aplicacion todavia. La arquitectura planificada es una aplicacion web full-stack separada por frontend React y backend Node.js/Express, con PostgreSQL como base de datos principal.

## Repository structure
Estructura candidata para la implementacion:

```text
apps/
  web/        # React + Vite
  api/        # Node.js + Express
packages/
  shared/     # tipos/esquemas compartidos si se justifica
infra/
  docker/     # configuracion de contenedores/proxy si se separa
.ai/          # memoria del proyecto AB
```

La estructura definitiva se debe confirmar al iniciar implementacion. Mantener cambios minimos y evitar complejidad innecesaria si el proyecto no requiere monorepo formal.

## Backend flow
- API REST sobre Express.
- Validacion de entrada con esquemas, preferentemente Zod.
- Servicios por modulo: auth, usuarios, productos, stock, pedidos, pagos, entregas, promociones, reportes y notificaciones.
- Prisma como capa de acceso a PostgreSQL.
- Errores normalizados para respuestas HTTP.
- Logs de operaciones administrativas relevantes.
- Las operaciones de pedidos deben ejecutarse con transacciones cuando afecten stock/reservas, items, pagos o totales.

## Frontend flow
- React + Vite con TypeScript.
- Diseno responsive mobile-first.
- Catalogo publico accesible sin login.
- Carrito anonimo/local antes del login y migracion al usuario durante checkout.
- Area cliente para pedidos e historial.
- Panel admin protegido por rol.
- Las pantallas admin deben priorizar carga rapida y edicion simple de productos, precios, stock, promociones y pedidos.
- Los modulos admin deben seguir el patron definido en `decisions/ADR-006-admin-module-ui-pattern.md`: una pagina por modulo, una seccion principal de listado filtrable y acciones de alta/edicion en modales.

## Data layer
PostgreSQL con Prisma. La conexion por defecto usa la base `postgres` y el schema `ecom_natura`. Entidades iniciales candidatas:

- users
- roles o user_roles
- categories
- products
- product_variants
- product_images
- catalogs
- prices
- promotions
- carts
- cart_items
- orders
- order_items
- payments
- delivery_methods
- stock_movements
- notifications
- audit_logs

Los pedidos deben guardar snapshots de precio, descuento, nombre/variante relevante y costo de envio para preservar historial aunque cambie el catalogo.

## Authentication / authorization
- Autenticacion con email/password.
- JWT access token de corta duracion.
- Refresh token seguro con rotacion y almacenamiento hasheado en base de datos.
- Passwords hasheadas con algoritmo robusto, por ejemplo bcrypt o argon2.
- Autorizacion por roles: cliente, admin y super_admin.
- Endpoints admin protegidos por middleware de autenticacion y rol.
- Rate limiting en login, registro, recuperacion de password y endpoints sensibles.
- Cookies httpOnly/secure/sameSite para refresh token si se usa flujo web con cookies; evitar almacenar refresh tokens en localStorage.
- Access token puede mantenerse en memoria del frontend o manejarse via cookies seguras segun decision final de implementacion.
- Recuperacion de password mediante token de un solo uso con expiracion.

## Infrastructure
- Docker Compose para desarrollo y despliegue inicial.
- Servicios previstos: frontend, API, PostgreSQL, Nginx y eventualmente servicio/volumen para imagenes si no se usa proveedor externo.
- VPS contratado para produccion.
- Nginx como reverse proxy y terminacion TLS.
- Backups periodicos de PostgreSQL obligatorios antes de operacion real.
- Variables de entorno para secretos, credenciales SMTP, JWT secrets, URLs y configuracion de base de datos.
