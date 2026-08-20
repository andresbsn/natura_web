# ADR-002: Authentication And Security Baseline

## Status
Accepted

## Context
Customers must register before creating orders. Admin users need protected access to manage products, stock, orders, payments and reports. The system handles personal data such as names, phones, emails and addresses.

## Decision
Use JWT-based authentication with short-lived access tokens and refresh-token rotation. Store password hashes only. Protect admin APIs with role-based authorization. Validate all inputs and keep secrets in environment variables.

## Consequences
- Access tokens reduce database lookups for normal authenticated requests.
- Refresh-token rotation and server-side token tracking reduce risk from stolen tokens.
- Admin functionality must be protected by role checks, not only hidden in the frontend.
- Security-sensitive endpoints require rate limiting and careful error responses.
