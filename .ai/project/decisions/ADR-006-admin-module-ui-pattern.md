# ADR-006: Admin Module UI Pattern

## Status
Accepted

## Context
El panel admin necesita crecer con modulos como productos, pedidos, usuarios, configuracion, promociones y reportes. La primera version mezclaba formularios, listados y edicion en la misma pantalla, lo que hacia la interfaz saturada y poco profesional.

## Decision
Cada modulo admin debe usar una estructura consistente:

- Una pagina dedicada por modulo dentro de `/admin/*`.
- Una seccion principal por pagina, con titulo claro del modulo.
- Listado principal filtrable o buscable cuando aplique.
- Acciones primarias en la parte superior de la seccion, por ejemplo `Agregar nuevo producto`.
- Alta, detalle y edicion en modal, no incrustados junto al listado.
- Evitar multiples cards/formularios permanentes compitiendo en la misma pagina.
- Diseno responsive, sin superposicion de textos, tablas o tarjetas.
- Modales con accesibilidad basica: `role="dialog"`, `aria-modal`, foco inicial, cierre con `Escape` y contencion de foco.

## Consequences
- Nuevos modulos admin deben replicar este esquema antes de agregar variantes visuales.
- Pedidos y usuarios deben evolucionar hacia el mismo patron usado por productos: listado central, filtros y acciones en modales cuando haya detalle o edicion compleja.
- La configuracion debe dividirse en secciones claras solo cuando haya grupos de datos realmente distintos.
- Si una pantalla necesita mas de una seccion permanente, debe justificarse por flujo de trabajo, no por conveniencia tecnica.
