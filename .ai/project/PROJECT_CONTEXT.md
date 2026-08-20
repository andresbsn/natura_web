# Project Context

## Purpose
Sistema ecommerce para una revendedora de Natura. Permite publicar un catalogo de productos, recibir pedidos de clientes registrados y administrar productos, precios, stock, promociones, pagos manuales, entregas y reportes desde un panel privado.

El proyecto no representa una tienda oficial de Natura. Cualquier uso de marca, imagenes oficiales o integraciones con sistemas oficiales queda sujeto a autorizacion o disponibilidad publica documentada.

## Users and roles
- Visitante: navega el catalogo publico, busca productos y consulta detalles. No puede crear pedidos sin registrarse.
- Cliente: se registra, arma carrito, crea pedidos, consulta historial y seguimiento, y puede cancelar pedidos pendientes.
- Admin: gestiona productos, variantes, imagenes, precios, catalogos, promociones, stock, metodos de entrega, pedidos, pagos manuales y reportes.
- Super admin: gestiona admins y configuraciones sensibles. Puede existir desde el modelo inicial aunque el MVP tenga pocos usuarios internos.

## Main modules
- Catalogo publico responsive mobile-first.
- Autenticacion y perfiles de usuario.
- Carrito anonimo/local con migracion a usuario autenticado al checkout.
- Pedidos y detalle de pedidos.
- Panel admin.
- Productos, categorias, variantes e imagenes.
- Catalogos/campanas y precios editables por admin.
- Promociones simples activables/desactivables.
- Stock real con reservas por pedidos pendientes/confirmados.
- Metodos y costos de entrega configurables.
- Pagos manuales registrados por admin.
- Notificaciones por email para eventos principales del pedido.
- Reportes administrativos.

## External integrations
- SMTP para envio de emails transaccionales.
- Posible almacenamiento externo de imagenes, por ejemplo S3 compatible o Cloudinary.
- WhatsApp queda como mejora posterior: inicialmente puede usarse link manual/prearmado; WhatsApp Business API requiere evaluacion y configuracion especifica.
- Posible integracion con API oficial de Natura solo si existe endpoint publico/documentado o autorizacion formal. No depender de endpoints privados/no documentados del sitio oficial.

## Environments
- Development: entorno local con Docker Compose para backend, frontend y PostgreSQL cuando se defina la estructura del repo.
- Testing: entorno local/CI para ejecutar lint, tests, build y migraciones de prueba.
- Production: VPS contratado, contenedores Docker, Nginx como reverse proxy, PostgreSQL persistente y backups configurados.

## Operational constraints / known gotchas
- No se implementa pasarela de pagos en el MVP; los pagos se registran manualmente desde el admin.
- Los pedidos congelan precios, descuentos, nombres relevantes y costo de envio al momento de compra.
- El stock disponible mostrado al cliente debe considerar unidades reservadas por pedidos pendientes y confirmados no finalizados.
- Los administradores pueden editar pedidos, por lo que se requiere auditoria de cambios relevantes.
- El diseno puede usar una estetica natural/cosmetica, pero se debe evitar copiar identidad oficial si no hay autorizacion.
- No guardar secretos reales en el repositorio. Usar variables de entorno y ejemplos sin valores sensibles.
