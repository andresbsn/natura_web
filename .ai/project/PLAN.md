# Initial Project Plan

## Goal
Build a responsive ecommerce system for a Natura reseller. The system will expose a public product catalog and allow registered customers to create orders. Admin users will manage products, variants, prices, stock, promotions, delivery options, manual payments, order states and reports.

## MVP Scope
- Public catalog with search and basic filters.
- Product detail pages.
- Product variants.
- Customer registration and login.
- Anonymous/local cart that migrates to the logged-in user at checkout.
- Order creation for authenticated customers.
- Customer order history and status tracking.
- Admin panel for products, variants, images, prices, stock, promotions, delivery methods, orders, manual payments and reports.
- Email notifications for important order events.
- Docker-based deployment on a VPS.

## Out Of Scope For MVP
- Online payment gateway.
- Official Natura integration unless a documented/authorized API is available.
- WhatsApp Business API automation.
- Advanced promotion engine for 2x1, bundles, coupons or complex stacking rules.
- Native mobile application.
- Multi-language support.

## Recommended Stack
- Frontend: React + Vite + TypeScript.
- Backend: Node.js + Express + TypeScript.
- Database: PostgreSQL.
- ORM: Prisma.
- Validation: Zod.
- Infrastructure: Docker Compose, Nginx, VPS.
- Email: SMTP provider configured through environment variables.

## Core Domain Model
- User
- Role/UserRole
- Category
- Product
- ProductVariant
- ProductImage
- Catalog/Campaign
- Price
- Promotion
- Cart
- CartItem
- Order
- OrderItem
- Payment
- DeliveryMethod
- StockMovement
- Notification
- AuditLog

## Main Flows

### Browse And Cart
1. Visitor browses the public catalog.
2. Visitor can build a local cart.
3. At checkout, the visitor must register or log in.
4. Local cart is associated with the authenticated user.
5. System validates availability before creating the order.

### Order Creation
1. Customer selects delivery method.
2. System applies configured delivery cost.
3. System freezes item prices, discounts and delivery cost.
4. System creates a pending order.
5. Units are reserved for availability calculation.
6. Customer and admins can receive email notification.

### Admin Order Management
1. Admin reviews pending orders.
2. Admin can modify items, quantities, delivery method/cost and observations.
3. Admin confirms, prepares, delivers or cancels the order.
4. Admin records manual payments.
5. System updates stock reservations or stock movements as needed.
6. Relevant changes are audited and can notify the customer.

## Security Plan
- Use JWT-based authentication.
- Use short-lived access tokens.
- Use refresh tokens with rotation and server-side storage of hashed token identifiers.
- Prefer httpOnly, secure, sameSite cookies for refresh tokens in browser flows.
- Do not store refresh tokens in localStorage.
- Hash passwords with bcrypt or argon2.
- Enforce role-based authorization for admin and super_admin endpoints.
- Rate-limit login, registration, password reset and other sensitive endpoints.
- Validate all request bodies, params and query strings.
- Normalize API errors to avoid leaking internals.
- Keep secrets only in environment variables.
- Never commit real `.env` files.
- Add CORS allowlist for production domains.
- Add audit logs for admin changes to orders, stock, products, prices, promotions and users.
- Treat customer names, phones, emails and addresses as personal data.
- Restrict access to customer/order data by role and ownership.

## Risks
- Brand/legal risk if official Natura assets, logos, product data or private endpoints are used without authorization.
- Stock consistency risk due to pending reservations, admin edits and cancellations.
- Security risk around admin privileges and customer personal data.
- Operational risk if VPS backups, TLS and secret management are not configured before production.
- Scope risk if promotion requirements become too broad early.

## Backlog By Phase

### Phase 1: Foundation
- Project structure.
- Docker development environment.
- PostgreSQL and Prisma setup.
- Auth and roles.
- Product/category/variant model.
- Public catalog.
- Cart and order creation.
- Basic admin panel.

### Phase 2: Operations
- Stock reservations and movement audit.
- Admin order editing.
- Manual payment registration.
- Delivery method configuration.
- Simple promotions.
- Email notifications.
- Reports MVP.

### Phase 3: Enhancements
- CSV/Excel import for products/prices.
- Internal endpoint for bulk updates.
- WhatsApp workflow.
- Advanced promotions.
- Official integration if authorized/documented.
- Production hardening and monitoring.

## Open Decisions
- Choose package manager: npm, pnpm or yarn.
- Decide final repo layout: simple two-app structure or formal workspace/monorepo.
- Decide image storage provider: local volume, S3-compatible storage or Cloudinary.
- Decide access-token storage strategy in the frontend.
- Define exact delivery methods and initial prices.
- Define low-stock threshold logic for reports.
