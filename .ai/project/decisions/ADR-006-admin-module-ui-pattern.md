# ADR-006: Patron de UI para modulos admin tipo ABM

## Estado
Aceptada

## Contexto
El panel admin debe permitir administrar productos, pedidos, usuarios, promociones y configuracion sin pantallas saturadas. Los modulos activos ya evolucionaron hacia paginas separadas con listados filtrables y formularios de alta/edicion en modales.

## Decision
Los ABM del panel admin deben seguir este patron:

- Una pagina/ruta por modulo dentro de `/admin`.
- Encabezado con `eyebrow`, titulo, descripcion breve y metricas/resumen cuando aplique.
- Seccion principal con tarjeta `adminCard`, toolbar, contador de registros y busqueda/filtros.
- Listado en filas accionables (`adminTableRow`) que abren un modal de detalle/edicion.
- Altas solo cuando exista endpoint/caso de uso confirmado; la accion primaria abre un modal `Nuevo ...`.
- Edicion de registros existentes siempre en modal, con cierre por boton, backdrop y tecla Escape, preservando foco inicial en el boton de cierre.
- Estados vacios y filtros sin resultados deben mostrar `statusText` claro.
- Mantener estilos y clases existentes (`adminPage`, `productListCard`, `productToolbar`, `modalBackdrop`, `productModal`, `modalFields`, `modalActions`) salvo que el modulo requiera una extension pequena.

## Aplicacion actual
- Productos: listado filtrable + modal de nuevo producto + modal de detalle/edicion.
- Pedidos: listado filtrable + modal de detalle/edicion/pagos/items.
- Promociones: listado filtrable + modal de nueva promocion + modal de detalle/edicion.
- Usuarios: listado filtrable + modal de detalle/edicion de usuario existente. No incluye alta admin porque no hay endpoint frontend confirmado para crear usuarios desde admin.
- Configuracion / metodos de entrega: listado filtrable + modal de nuevo metodo + modal de detalle/edicion.

## Consecuencias
Los futuros ABM admin deben priorizar consistencia, carga rapida y lectura de listado. Los formularios inline extensos quedan reservados para casos excepcionales documentados.
