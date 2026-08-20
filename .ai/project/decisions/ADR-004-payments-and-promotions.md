# ADR-004: Manual Payments And Simple Promotions In MVP

## Status
Accepted

## Context
The MVP should support orders and admin payment tracking without integrating a payment gateway. Admins also need promotional tools, but unrestricted promotion rules can create excessive complexity early.

## Decision
Do not integrate online payments in the MVP. Admins will register payment status manually. Promotions in the MVP will support simple active/inactive discounts by product, variant, category or catalog/campaign, with validity dates and priority.

## Consequences
- Checkout is simpler and lower risk.
- Payment reconciliation remains manual.
- The data model should leave room for future online payments and advanced promotions.
- Complex promotions such as 2x1, bundles, coupons and stacking rules are deferred.
