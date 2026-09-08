# ADR-002: Authentication And Security Baseline

## Status
Accepted

## Context
Customers must register before creating orders. Admin users need protected access to manage products, stock, orders, payments and reports. The system handles personal data such as names, phones, emails and addresses.

## Decision
Use JWT-based authentication with short-lived access tokens and refresh-token rotation. Store password hashes only. Customer registration requires email verification with a short-lived opaque token before login/session creation. Protect admin APIs with role-based authorization. Validate all inputs and keep secrets in environment variables.

## Consequences
- Access tokens reduce database lookups for normal authenticated requests.
- Refresh-token rotation and server-side token tracking reduce risk from stolen tokens.
- Admin functionality must be protected by role checks, not only hidden in the frontend.
- Security-sensitive endpoints require rate limiting and careful error responses.
- Email verification requires SMTP configuration in real environments; without SMTP the account remains pending verification.
