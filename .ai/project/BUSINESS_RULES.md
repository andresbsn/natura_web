# Business Rules

Record only verified durable business rules. Do not use this file for temporary implementation notes.

## Rules
- El proyecto es para una revendedora de Natura, no una tienda oficial.
- El catalogo publico puede ser navegado por visitantes sin cuenta.
- Para crear un pedido, el usuario debe estar registrado e iniciar sesion.
- Para completar el registro e iniciar sesion, el cliente debe validar su email mediante enlace enviado por correo.
- Las contrasenas de clientes deben tener al menos 8 caracteres.
- El carrito puede comenzar como anonimo/local y debe asociarse al usuario al iniciar sesion o durante checkout.
- No se integra pasarela de pagos en el MVP.
- Los pagos se registran manualmente desde el panel admin.
- Puede existir mas de un admin.
- Los roles iniciales son cliente, admin y super_admin.
- Los productos pueden tener variantes como tono, fragancia, tamano, presentacion o kit.
- Los admins pueden cargar imagenes de productos desde el panel.
- Los precios pueden variar por catalogo/campana y son editables por admin.
- Los precios, descuentos, datos relevantes de items y costo de envio quedan congelados al momento de crear el pedido.
- El stock real lo administra el admin.
- Al crear un pedido, el stock no se descuenta como salida definitiva, pero queda reservado para calcular disponibilidad visible al cliente.
- El stock disponible para clientes debe excluir unidades reservadas por pedidos pendientes y confirmados no finalizados.
- Si un pedido pendiente se cancela, sus reservas se liberan.
- Si un pedido confirmado/preparando se cancela por admin, sus reservas o salidas deben ajustarse segun el estado operativo.
- El cliente puede cancelar un pedido solo si esta pendiente.
- Si el pedido ya fue aprobado/confirmado, solo un admin puede cancelarlo.
- Estados iniciales de pedido: pendiente, confirmado, preparando, entregado y cancelado.
- El estado de pago debe manejarse separado del estado del pedido: sin_pago, pago_parcial, pagado y eventualmente reembolsado.
- Los admins pueden modificar pedidos, incluyendo agregar productos, quitar productos, cambiar cantidades, cambiar metodo de entrega, ajustar envio, registrar pagos y cambiar estados.
- Las modificaciones administrativas relevantes deben auditarse.
- Metodos de entrega iniciales: retiro, envio local y envio por correo.
- Los costos de entrega se cargan en una tabla/configuracion administrable.
- El costo de entrega se aplica automaticamente al seleccionar metodo y queda congelado en el pedido.
- Cambios posteriores en costos de entrega no deben modificar pedidos ya creados.
- Las promociones del MVP deben ser simples, activables/desactivables y administrables: descuento por producto/variante, categoria o catalogo/campana, con fechas de vigencia y prioridad.
- Promociones avanzadas como 2x1, segunda unidad con descuento, combos, cupones o descuentos acumulables quedan para fases posteriores salvo decision contraria.
- El cliente puede ver sus pedidos y cambios de estado.
- Las notificaciones iniciales seran por email para eventos principales del pedido.
- WhatsApp queda para fase posterior o uso manual con enlaces prearmados.
- El admin debe contar con modulo de reportes.
- Reportes MVP: ventas por periodo, pedidos por estado, productos mas vendidos, stock bajo, ingresos registrados, pedidos pendientes y ventas por metodo de entrega.
- El sistema debe ser responsive mobile-first.
- Idioma inicial: espanol.
