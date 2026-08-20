# ADR-001: Initial Application Stack

## Status
Accepted

## Context
The project is a new ecommerce application for a Natura reseller. The preferred technologies are React, Node.js and PostgreSQL. The system must be responsive, support an admin panel and run on a VPS using Docker.

## Decision
Use React + Vite + TypeScript for the frontend, Node.js + Express + TypeScript for the backend, PostgreSQL for persistence and Prisma as ORM. Deploy with Docker Compose behind Nginx on a VPS.

## Consequences
- The stack is simple and familiar for the requested scope.
- Express is sufficient if the backend is organized by modules and uses validation, auth middleware and service boundaries.
- Prisma provides typed database access and migration management.
- Docker/Nginx deployment requires explicit production configuration, backups and TLS setup before launch.
