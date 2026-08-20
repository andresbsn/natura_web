# ADR-003: Stock Reservations For Orders

## Status
Accepted

## Context
The business requires real stock. Creating a customer order should not be treated as final stock consumption, but pending orders must reduce visible availability to prevent overselling.

## Decision
Use stock reservations for pending and confirmed orders. The public available stock will exclude reserved units. Final stock movements are recorded as orders progress or are delivered. Cancellations release reservations according to order state.

## Consequences
- Availability shown to customers is more accurate.
- Order creation, admin edits and cancellations must update reservations transactionally.
- Stock logic is higher risk and requires tests around concurrency, edits and cancellations.
