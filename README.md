# 🚆 IRCTC Backend - Microservices Architecture

> A production-grade microservices-based railway booking system backend, built for learning and demonstrating enterprise architecture patterns.

**YouTube Tutorial Series**: https://youtu.be/K_cTtCXCPeY?si=VLIxFdgK2k3XraXA

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Port Reference](#-port-reference)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Application](#running-the-application)
- [Services](#-services)
- [Kafka Topics](#-kafka-topics)
- [API Documentation](#-api-documentation)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)

---

## 🎯 Overview

This project demonstrates a complete microservices architecture for a railway booking system (IRCTC clone), covering:

- **Microservices Design Patterns** — Database-per-service, API Gateway, Saga
- **Inter-Service Communication** — REST (sync) and Kafka (async/event-driven)
- **Authentication & Authorization** — JWT (access + refresh), OTP via email, Google OAuth
- **Database Management** — PostgreSQL via Prisma ORM (5 services), Elasticsearch (search)
- **Caching & Locking** — Redis for sessions, OTP storage, distributed seat locks
- **Containerization** — Docker Compose for the full infra stack
- **Resilience** — Rate limiting, circuit breakers, Dead-Letter Queues (DLQ) on every Kafka consumer

**🎓 Learning Objectives:**
- Build scalable microservices with database-per-service ownership
- Implement real-world authentication flows (OTP + JWT + Google OAuth)
- Coordinate distributed transactions with Saga + Kafka
- Handle concurrent seat reservations with Redis distributed locks
- Build a production-style API Gateway with proxying, JWT enforcement, rate limiting, and circuit breakers

---

## 🏗️ Architecture

```
                            ┌───────────────────────┐
                            │  Frontend (React)     │
                            │  Port 3000            │
                            └───────────┬───────────┘
                                        │
                            ┌───────────▼───────────┐
                            │   API Gateway         │
                            │   Port 4000           │
                            │ (JWT, rate limit,     │
                            │  circuit breaker)     │
                            └───┬───────┬───────┬───┘
              ┌─────────────────┼───────┼───────┼───────────────┐
              │                 │       │       │               │
   ┌──────────▼──────┐ ┌────────▼─┐ ┌───▼────┐ ┌▼──────────┐ ┌──▼──────────┐
   │ User Service    │ │ Search   │ │ Admin  │ │ Booking   │ │ Payment     │
   │ Port 4001       │ │ 4002     │ │ 4003   │ │ 4005      │ │ 4006        │
   └────────┬────────┘ └────┬─────┘ └───┬────┘ └─────┬─────┘ └─────┬───────┘
            │               │           │            │             │
            │          ┌────▼──────┐    │     ┌──────▼─────┐       │
            │          │ Inventory │    │     │ Notification│      │
            │          │ 4007      │    │     │ 4004 (Kafka)│      │
            │          └────┬──────┘    │     └──────┬──────┘      │
            │               │           │            │             │
            └───────────────┴───────────┴────────────┴─────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
        ┌───────▼──────┐    ┌─────────▼────────┐   ┌────────▼────────┐
        │  PostgreSQL  │    │  Redis Stack     │   │   Kafka         │
        │  Port 5432   │    │  Port 6379/8001  │   │   Port 9092/9093│
        └──────────────┘    └──────────────────┘   └─────────────────┘
                                                            │
                                                  ┌─────────▼─────────┐
                                                  │  Elasticsearch    │
                                                  │  Port 9200        │
                                                  └───────────────────┘
```

**Highlights:**
- **API Gateway** is the single entrypoint for the frontend; it proxies to the right service and enforces JWT, rate limits, and circuit breakers.
- **Database-per-service** — each service owns its own Postgres database, search-service uses Elasticsearch.
- **Event-driven** — Kafka decouples booking, payment, inventory, search and notification flows. Topics are centralized in [shared/constants/kafka-topics.js](shared/constants/kafka-topics.js).
- **Notification service has no HTTP API** — it is purely a Kafka consumer that sends emails via SendGrid.

---

## 🔌 Port Reference

A single quick-glance table of every port the project uses.

### Application Services

| Service | Port | Direct URL |
|---|---|---|
| Frontend (Vite + React) | 3000 | http://localhost:3000 |
| API Gateway | 4000 | http://localhost:4000 |
| User Service | 4001 | http://localhost:4001 |
| Search Service | 4002 | http://localhost:4002 |
| Admin Service | 4003 | http://localhost:4003 |
| Notification Service | 4004 | (Kafka-only, no HTTP) |
| Booking Service | 4005 | http://localhost:4005 |
| Payment Service | 4006 | http://localhost:4006 |
| Inventory Service | 4007 | http://localhost:4007 |

### Infrastructure (from [docker-compose.yml](docker-compose.yml))

| Component | Port(s) | Access |
|---|---|---|
| PostgreSQL 15 | 5432 | `admin` / `irctcpass` |
| pgAdmin | 8081 | http://localhost:8081 — `admin@admin.com` / `admin` |
| Redis Stack | 6379 (Redis), 8001 (RedisInsight) | password `irctcpass` — RedisInsight at http://localhost:8001 |
| Zookeeper | 2181 | — |
| Kafka | 9092 (internal), 9093 (host) | host clients connect to `localhost:9093` |
| Kafka UI | 8080 | http://localhost:8080 |
| Elasticsearch 8.12 | 9200 | http://localhost:9200 (single-node, security disabled) |
| Kibana 8.12 | 5601 | http://localhost:5601 |

---

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js (v18+)
- **Language**: JavaScript (ES Modules)
- **Framework**: Express.js 5
- **ORM**: Prisma 7 (user, admin, booking, payment, inventory)
- **Authentication**: JWT (access + refresh), OTP via SendGrid, Google OAuth (`google-auth-library`)
- **Search**: Elasticsearch 8.12
- **Logging**: Winston
- **Security**: Helmet, CORS, bcrypt
- **Payments**: Razorpay SDK
- **Messaging**: KafkaJS

### Frontend
- React 18 + Vite 6
- React Router 6, Zustand (state), React Hook Form, Axios
- Tailwind CSS 3
- Dev server proxies `/api` → API Gateway (port 4000)

### Databases & Caching
- **PostgreSQL 15** — one database per Prisma service
- **Redis Stack** — sessions, OTP cache, distributed seat locks, rate-limit counters
- **Elasticsearch 8.12** — train and station search index

### Messaging
- **Apache Kafka** (Confluent 7.5) with Zookeeper
- **Kafka UI** for topic inspection
- Dead-Letter Queue topics (`dlq.<service>`) for every consumer

### DevOps
- Docker, Docker Compose
- pgAdmin, RedisInsight, Kafka UI, Kibana

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version | Download |
|---|---|---|
| Node.js | >= 18.0.0 | [nodejs.org](https://nodejs.org/) |
| npm | >= 9.0.0 | (bundled with Node.js) |
| Docker | >= 20.0.0 | [docker.com](https://www.docker.com/) |
| Docker Compose | >= 2.0.0 | (bundled with Docker Desktop) |
| Git | >= 2.30.0 | [git-scm.com](https://git-scm.com/) |

```bash
node --version
npm --version
docker --version
docker compose version
```

---

### Installation

#### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/irctc-backend.git
cd irctc-backend
```

#### 2. Start the infrastructure stack
```bash
docker-compose up -d
docker ps
```

This starts **all** infrastructure containers: PostgreSQL, pgAdmin, Redis Stack, Zookeeper, Kafka, Kafka UI, Elasticsearch and Kibana. See the [Port Reference](#-port-reference) for access URLs.

#### 3. Install and configure each service
For every backend service (`user-service`, `admin-service`, `booking-service`, `payment-service`, `inventory-service`, `search-service`, `notification-service`, `api-gateway`):

```bash
cd <service-name>
npm install
cp .env.example .env       # then fill in real secrets
```

For the **5 services with Prisma** (`user-service`, `admin-service`, `booking-service`, `payment-service`, `inventory-service`), also run migrations:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

#### 4. Install the frontend
```bash
cd frontend
npm install
cp .env.example .env
```

---

### Running the Application

Open one terminal per service. The recommended startup order respects Kafka consumer dependencies:

```bash
# 1. Infrastructure
docker-compose up -d

# 2. Admin service (publishes station/train/route/schedule events)
cd admin-service && npm run dev

# 3. Inventory service (consumes admin.schedule-* events)
cd inventory-service && npm run dev

# 4. Search service (consumes admin.* and inventory.* events)
cd search-service && npm run dev

# 5. User service
cd user-service && npm run dev

# 6. Payment service
cd payment-service && npm run dev

# 7. Booking service (consumes payment.* and admin.schedule-cancelled)
cd booking-service && npm run dev

# 8. Notification service (consumes booking.* and notification.* events)
cd notification-service && npm run dev

# 9. API Gateway
cd api-gateway && npm run dev

# 10. Frontend
cd frontend && npm run dev
```

Frontend will be available at **http://localhost:3000** and proxies API calls to the gateway at **http://localhost:4000**.

---

## 📦 Services

All services are implemented (✅). Endpoints below show the **direct** path on each service. Through the API Gateway, prefix everything with `/api/<service-name>` (see each service's "Gateway path" below).

### 1. API Gateway — Port 4000
Single entrypoint. Routes requests to backend services, enforces JWT, applies per-route rate limits, and trips circuit breakers on downstream failure.

**Notable endpoints:**

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/api/gateway/health` | Aggregate downstream health |
| GET | `/api/gateway/circuit-breakers` | Inspect breaker state |
| ANY | `/api/users/*` → user-service | |
| ANY | `/api/search/*` → search-service | |
| ANY | `/api/admins/*` → admin-service | |
| ANY | `/api/bookings/*` → booking-service | |
| ANY | `/api/payments/*` → payment-service | |
| ANY | `/api/inventory/*` → inventory-service | |

**Tech:** Express, axios, ioredis, jsonwebtoken, helmet, morgan, winston.

---

### 2. User Service — Port 4001
User registration, OTP verification, JWT issuance + rotation, Google OAuth, profile management.

**Database:** PostgreSQL `user_service_database` (models: `User`, `AuthProvider`)
**Gateway path:** `/api/users/*`

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/send-otp` | — |
| POST | `/auth/verify-otp` | — |
| POST | `/auth/login` | — |
| POST | `/auth/refresh` | — |
| POST | `/auth/google-auth` | — |
| GET | `/user/profile` | JWT |
| PUT | `/user/profile` | JWT |
| DELETE | `/user/profile` | JWT |
| GET | `/user/internal/:userId` | `INTERNAL_SERVICE_KEY` |
| GET | `/health` | — |

**Kafka — produces:** `notification.otp-email`, `notification.welcome-email`

---

### 3. Search Service — Port 4002
Train and station search backed by Elasticsearch. Indexes are kept fresh by consuming admin and inventory events.

**Datastore:** Elasticsearch (no Postgres)
**Gateway path:** `/api/search/*`

| Method | Path | Notes |
|---|---|---|
| GET | `/trains?from=&to=&date=` | Train search |
| GET | `/autocomplete?q=` | Station autocomplete |
| GET | `/debug/stations` | Indexed stations (debug) |
| GET | `/debug/trains` | Indexed trains (debug) |

**Kafka — consumes:** `admin.station-created`, `admin.route-created`, `admin.schedule-created`, `admin.schedule-cancelled`, `inventory.seat-availability-updated`
**DLQ:** `dlq.search-service`

---

### 4. Admin Service — Port 4003
Source of truth for stations, trains, routes and schedules. Publishes domain events that all read-side services consume.

**Database:** PostgreSQL `admin_service_database` (models: `Station`, `Train`, `Seat`, `Route`, `RouteStation`, `Schedule`)
**Gateway path:** `/api/admins/*`

| Method | Path | Notes |
|---|---|---|
| GET | `/station` | List stations |
| POST | `/station` | Create station |
| GET | `/station/:stationId` | Get station |
| GET | `/station/internal/:stationId` | Internal lookup |
| GET | `/train` | List trains |
| POST | `/train` | Create train |
| GET | `/train/:trainId` | Get train |
| POST | `/route` | Create route |
| GET | `/schedule` | List schedules |
| POST | `/schedule` | Create schedule |
| PUT | `/schedule/:scheduleId` | Cancel schedule |
| GET | `/health` | — |

**Kafka — produces:** `admin.station-created`, `admin.train-created`, `admin.route-created`, `admin.schedule-created`, `admin.schedule-cancelled`

---

### 5. Notification Service — Port 4004
Kafka-only consumer (no HTTP API). Sends OTP, welcome and booking emails via SendGrid.

**Kafka — consumes:** `notification.otp-email`, `notification.welcome-email`, `booking.confirmed`, `booking.failed`, `booking.cancelled`
**DLQ:** `dlq.notification-service`

---

### 6. Booking Service — Port 4005
Orchestrates the booking saga: locks seats in inventory, creates a payment order, waits for payment confirmation via Kafka, then confirms or rolls back.

**Database:** PostgreSQL `booking_service_database` (`Booking` with saga tracking, segment bookings)
**Gateway path:** `/api/bookings/*`

| Method | Path | Auth |
|---|---|---|
| POST | `/bookings` | JWT |
| GET | `/bookings` | JWT |
| GET | `/bookings/:bookingId` | JWT |
| POST | `/bookings/:bookingId/verify-payment` | JWT |
| POST | `/bookings/:bookingId/cancel` | JWT |
| GET | `/health` | — |

**Kafka — produces:** `booking.confirmed`, `booking.failed`, `booking.cancelled`
**Kafka — consumes:** `payment.success`, `payment.failed`, `admin.schedule-cancelled`

---

### 7. Payment Service — Port 4006
Razorpay integration. Creates payment orders, verifies signatures, processes webhooks and refunds.

**Database:** PostgreSQL `payment_service_database` (models: `PaymentOrder`, `Refund`, `PaymentAuditLog`)
**Gateway path:** `/api/payments/*`

| Method | Path | Auth |
|---|---|---|
| POST | `/orders` | `INTERNAL_SERVICE_KEY` |
| GET | `/orders/:paymentOrderId` | `INTERNAL_SERVICE_KEY` |
| POST | `/orders/:paymentOrderId/verify` | `INTERNAL_SERVICE_KEY` |
| POST | `/refunds` | `INTERNAL_SERVICE_KEY` |
| POST | `/webhooks/razorpay` | Razorpay signature (raw body) |
| GET | `/health` | — |

**Kafka — produces:** `payment.success`, `payment.failed`

---

### 8. Inventory Service — Port 4007
Tracks per-schedule seat availability and segment locks. Background job expires stale locks every 60s.

**Database:** PostgreSQL `inventory_service_database` (models: `ScheduleInventory`, `SeatInventory`, `RouteStop`, `SeatSegmentLock`, `IdempotencyRecord`)
**Gateway path:** `/api/inventory/*`

| Method | Path | Auth |
|---|---|---|
| GET | `/schedules/:scheduleId/availability` | — |
| GET | `/schedules/:scheduleId/seats` | JWT or internal |
| POST | `/seats/lock` | `INTERNAL_SERVICE_KEY` |
| POST | `/seats/unlock` | `INTERNAL_SERVICE_KEY` |
| POST | `/seats/confirm` | `INTERNAL_SERVICE_KEY` |
| POST | `/seats/cancel-booking` | `INTERNAL_SERVICE_KEY` |

**Kafka — consumes:** `admin.schedule-created`, `admin.schedule-cancelled`
**Kafka — produces:** `inventory.seat-availability-updated`
**DLQ:** `dlq.inventory-service`

---

### 9. Frontend — Port 3000
React 18 + Vite 6 + Tailwind. Auth state via Zustand, forms via React Hook Form, requests via Axios. The Vite dev server proxies `/api` to the gateway at port 4000.

```bash
cd frontend
npm install
npm run dev      # → http://localhost:3000
npm run build
npm run preview
```

---

## 📡 Kafka Topics

All topic names live in [shared/constants/kafka-topics.js](shared/constants/kafka-topics.js).

| Topic | Producer | Consumer(s) |
|---|---|---|
| `notification.otp-email` | user-service | notification-service |
| `notification.welcome-email` | user-service | notification-service |
| `admin.station-created` | admin-service | search-service |
| `admin.train-created` | admin-service | — |
| `admin.route-created` | admin-service | search-service |
| `admin.schedule-created` | admin-service | inventory-service, search-service |
| `admin.schedule-cancelled` | admin-service | inventory-service, search-service, booking-service |
| `inventory.seat-availability-updated` | inventory-service | search-service |
| `payment.success` | payment-service | booking-service |
| `payment.failed` | payment-service | booking-service |
| `booking.confirmed` | booking-service | notification-service |
| `booking.failed` | booking-service | notification-service |
| `booking.cancelled` | booking-service | notification-service |
| `dlq.<service>` | each consumer on failure | (operator-driven) |

Every consumer is wrapped with [shared/utils/dlqHandler.js](shared/utils/dlqHandler.js), which retries up to 3 times before publishing the failed message to the service's DLQ topic.

---

## 📖 API Documentation

You can call the backend two ways:

- **Through the gateway (recommended for clients):** `http://localhost:4000/api/<service>/...`
- **Directly to a service (for development/testing):** `http://localhost:<service-port>/...`

Examples below show direct user-service calls (port 4001). Through the gateway, the same routes are exposed under `/api/users/auth/...` and `/api/users/user/...`.

### Send OTP
```http
POST http://localhost:4001/auth/send-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": { "email": "user@example.com" }
}
```

### Verify OTP
```http
POST http://localhost:4001/auth/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

### Login
```http
POST http://localhost:4001/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Refresh access token
```http
POST http://localhost:4001/auth/refresh
Cookie: refreshToken=<refresh-jwt>
```

### Get profile
```http
GET http://localhost:4001/user/profile
Authorization: Bearer <access-jwt>
```

### Search trains
```http
GET http://localhost:4002/trains?from=NDLS&to=BCT&date=2026-05-01
```

### Create a booking
```http
POST http://localhost:4005/bookings
Authorization: Bearer <access-jwt>
Content-Type: application/json
```

A full OpenAPI / Postman collection will be added in a future update.

---

## 🔐 Environment Variables

Each service ships with a `.env.example`. Copy it to `.env` and fill in real values. **Never commit `.env`.**

> Tip — generate a strong secret:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

### API Gateway — [api-gateway/.env.example](api-gateway/.env.example)
```bash
PORT=4000
NODE_ENV=development

ALLOWED_ORIGINS=http://localhost:3000
REDIS_URL=redis://:irctcpass@localhost:6379

JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
ACCESS_TOKEN_EXP=15m
REFRESH_TOKEN_EXP=7d
ACCESS_TOKEN_EXP_SEC=900
REFRESH_TOKEN_EXP_SEC=604800

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

USER_SERVICE_URL=http://localhost:4001
SEARCH_SERVICE_URL=http://localhost:4002
BOOKING_SERVICE_URL=http://localhost:4005
NOTIFICATION_SERVICE_URL=http://localhost:4004
PAYMENT_SERVICE_URL=http://localhost:4006

SERVICE_TIMEOUT_MS=60000
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
```

### User Service — [user-service/.env.example](user-service/.env.example)
```bash
PORT=4001
NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://admin:irctcpass@localhost:5432/user_service_database
REDIS_URL=redis://:irctcpass@localhost:6379
KAFKA_BROKER=localhost:9093

ALLOWED_ORIGINS=http://localhost:4000,http://localhost:4001,http://localhost:4005

OTP_TTL=300
OTP_HMAC_SECRET=your_64_char_hex
OTP_RATE_MAX_PER_HOUR=5
OTP_MAX_VERIFY_ATTEMPTS=5
SENDGRID_API_KEY=SG.your_key

JWT_ACCESS_SECRET=your_64_char_hex
JWT_REFRESH_SECRET=your_128_char_hex
ACCESS_TOKEN_EXP=15m
REFRESH_TOKEN_EXP=7d
ACCESS_TOKEN_EXP_SEC=900
REFRESH_TOKEN_EXP_SEC=604800
REDIS_USER_TTL=86400

INTERNAL_SERVICE_KEY=your_shared_internal_service_key
```

### Search Service — [search-service/.env.example](search-service/.env.example)
```bash
PORT=4002
NODE_ENV=development
LOG_LEVEL=info

ELASTICSEARCH_URL=http://localhost:9200
KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=search-service
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000,http://localhost:4001
ES_RECREATE_INDICES=true
```

### Admin Service — [admin-service/.env.example](admin-service/.env.example)
```bash
PORT=4003
NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://admin:irctcpass@localhost:5432/admin_service_database
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000,http://localhost:4001,http://localhost:4003,http://localhost:4005

KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=admin-service

INTERNAL_SERVICE_KEY=your_shared_internal_service_key
```

### Notification Service — [notification-service/.env.example](notification-service/.env.example)
```bash
PORT=4004
NODE_ENV=development
LOG_LEVEL=info

ALLOWED_ORIGINS=http://localhost:4000,http://localhost:4001,http://localhost:4004
KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=notification-service

SENDGRID_API_KEY=SG.your_key
MAIL_SEND=your_sender_email
FRONTEND_URL=http://localhost:3000/login
```

### Booking Service — [booking-service/.env.example](booking-service/.env.example)
```bash
PORT=4005
NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://admin:irctcpass@localhost:5432/booking_service_database
REDIS_URL=redis://:irctcpass@localhost:6379
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000

KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=booking-service

INVENTORY_SERVICE_URL=http://localhost:4007
PAYMENT_SERVICE_URL=http://localhost:4006
USER_SERVICE_URL=http://localhost:4001
ADMIN_SERVICE_URL=http://localhost:4003
INTERNAL_SERVICE_KEY=your_shared_internal_service_key

BOOKING_TTL_SECONDS=600
BOOKING_EXPIRY_CHECK_INTERVAL_MS=30000
LOCK_TTL_SECONDS=600
```

### Payment Service — [payment-service/.env.example](payment-service/.env.example)
```bash
PORT=4006
NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://admin:irctcpass@localhost:5432/payment_service_database
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000

KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=payment-service

INTERNAL_SERVICE_KEY=your_shared_internal_service_key

PAYMENT_GATEWAY=razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

### Inventory Service — [inventory-service/.env.example](inventory-service/.env.example)
```bash
PORT=4007
NODE_ENV=development
LOG_LEVEL=info

DATABASE_URL=postgres://admin:irctcpass@localhost:5432/inventory_service_database
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000

KAFKA_BROKER=localhost:9093
KAFKA_CLIENT_ID=inventory-service

LOCK_TTL_SECONDS=300
LOCK_EXPIRY_INTERVAL_MS=60000

INTERNAL_SERVICE_KEY=your_shared_internal_service_key
```

### Frontend — [frontend/.env.example](frontend/.env.example)
```bash
VITE_API_BASE_URL=/api
```

**🔒 Security checklist**
- ❌ Never commit `.env` files.
- ✅ The same `INTERNAL_SERVICE_KEY` value must be set across all services that talk to each other internally (user, admin, booking, payment, inventory, notification).
- ✅ Use 32+ byte secrets for JWT and OTP HMAC.
- ✅ Rotate Razorpay and SendGrid keys on every leak.

---

## 📁 Project Structure

```
irctc-backend/
├── api-gateway/           # Port 4000 — entry point, JWT, rate-limit, circuit breaker
├── user-service/          # Port 4001 — auth, OTP, JWT, profile (Postgres + Redis)
├── search-service/        # Port 4002 — Elasticsearch-backed train/station search
├── admin-service/         # Port 4003 — stations/trains/routes/schedules CRUD (Postgres)
├── notification-service/  # Port 4004 — Kafka-only consumer, sends emails via SendGrid
├── booking-service/       # Port 4005 — booking saga (Postgres + Redis)
├── payment-service/       # Port 4006 — Razorpay orders/refunds/webhooks (Postgres)
├── inventory-service/     # Port 4007 — per-schedule seat inventory & locks (Postgres)
├── frontend/              # Port 3000 — React 18 + Vite 6 + Tailwind
├── shared/                # Cross-service utilities (see below)
│   ├── constants/
│   │   ├── kafka-topics.js     # Single source of truth for Kafka topic names
│   │   ├── asyncHandler.js     # Express async error wrapper
│   │   └── error.js            # Error definitions
│   └── utils/
│       └── dlqHandler.js       # Kafka consumer wrapper with retry + DLQ publishing
└── docker-compose.yml     # Postgres, pgAdmin, Redis, Zookeeper, Kafka, Kafka UI, ES, Kibana
```

Each backend service follows the same internal layout:

```
<service>/
├── src/
│   ├── index.js           # Server bootstrap
│   ├── app.js             # Express app + middleware
│   ├── config/            # Env + clients (db, redis, kafka)
│   ├── routes/            # Route definitions
│   ├── controllers/       # Request handlers
│   ├── services/          # Business logic
│   ├── middlewares/       # Auth, error, validation
│   ├── kafka/             # Producers and consumers
│   └── utils/             # Logger and helpers
├── prisma/                # Schema + migrations (Prisma services only)
├── .env.example
└── package.json
```
