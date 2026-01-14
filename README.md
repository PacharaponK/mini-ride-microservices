# 🚗 Mini Ride-Hailing Microservices

โปรเจกต์สาธิต **Microservices Architecture** แบบครบวงจร สำหรับระบบ Ride-Hailing (เรียกรถ) พร้อม **Database Per Service Pattern**, **SAGA Pattern**, และ **Event-Driven Architecture**

---

## 📑 สารบัญ

- [สถาปัตยกรรม](#-สถาปัตยกรรม)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Services](#-services)
  - [API Gateway](#1-api-gateway)
  - [Matching Service](#2-matching-service)
  - [Pricing Service](#3-pricing-service)
  - [Payment Service](#4-payment-service)
  - [Saga Orchestrator](#5-saga-orchestrator)
  - [Notification Service](#6-notification-service)
- [Communication Patterns](#-communication-patterns)
- [Database Per Service Pattern](#-database-per-service-pattern)
- [SAGA Pattern](#-saga-pattern)
- [API Reference](#-api-reference)
- [โครงสร้างโปรเจกต์](#-โครงสร้างโปรเจกต์)
- [เทคโนโลยีและ Patterns](#-เทคโนโลยีและ-patterns)

---

## 🏗️ สถาปัตยกรรม

### System Overview

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              MINI RIDE-HAILING                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────┐                      ┌─────────────┐                          │
│  │   Frontend  │─────── HTTP ────────▶│ API Gateway │                          │
│  │  React:5173 │                      │ Express:3000│                          │
│  └─────────────┘                      └──────┬──────┘                          │
│                                              │                                 │
│         ┌────────────────────────────────────┼────────────────────────┐        │
│         │                                    │                        │        │
│         ▼                                    ▼                        ▼        │
│  ┌───────────────┐               ┌───────────────┐           ┌───────────────┐ │
│  │   Matching    │───── gRPC ───▶│    Pricing    │           │    Payment    │ │
│  │ Node.js:3001  │               │   Go:3002     │           │ Python:3003   │ │
│  │               │◀─── HTTP ─────│   gRPC:50051  │           │               │ │
│  └───────┬───────┘               └───────┬───────┘           └───────┬───────┘ │
│          │                               │                           │         │
│          ▼                               ▼                           ▼         │
│  ┌───────────────┐               ┌───────────────┐           ┌───────────────┐ │
│  │  PostgreSQL   │               │    MongoDB    │           │  PostgreSQL   │ │
│  │   :5432       │               │    :27017     │           │    :5433      │ │
│  └───────────────┘               └───────────────┘           └───────────────┘ │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                           Apache Kafka :9092                            │   │
│  │  Topics: payment.completed, payment.refunded, saga.started, etc.        │   │
│  └──────────────────────────────────┬──────────────────────────────────────┘   │
│                                     │                                          │
│         ┌───────────────────────────┼───────────────────────────┐              │
│         ▼                           ▼                           ▼              │
│  ┌───────────────┐          ┌───────────────┐          ┌───────────────┐       │
│  │     Saga      │          │ Notification  │          │    Redis      │       │
│  │ Orchestrator  │          │   Service     │          │   (Cache)     │       │
│  │ Node.js:3004  │          │ Python:3005   │          │    :6379      │       │
│  └───────┬───────┘          └───────────────┘          └───────────────┘       │
│          ▼                                                                     │
│  ┌───────────────┐                                                             │
│  │    MongoDB    │                                                             │
│  │    :27018     │                                                             │
│  └───────────────┘                                                             │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Request Flow

```
User Request → Frontend → API Gateway → Matching Service
                                              │
                                              ├──▶ Pricing Service (gRPC)
                                              │         └──▶ MongoDB (pricing rules)
                                              │         └──▶ Redis (cache)
                                              │
                                              ├──▶ Payment Service (HTTP)
                                              │         └──▶ PostgreSQL (wallets, payments)
                                              │         └──▶ Kafka (publish event)
                                              │
                                              └──▶ PostgreSQL (rides, drivers)

Kafka Event → Notification Service → Send Push/SMS/Email
```

---

## 🛠️ Tech Stack

### Backend Services

| Service           | Language   | Framework    | Database   |    Port     | Description                     |
| :---------------- | :--------- | :----------- | :--------- | :---------: | :------------------------------ |
| Frontend          | JavaScript | React + Vite | -          |    5173     | Web UI สำหรับเรียกรถ            |
| API Gateway       | JavaScript | Express.js   | -          |    3000     | Single entry point              |
| Matching          | JavaScript | Express.js   | PostgreSQL |    3001     | จับคู่ rider กับ driver         |
| Pricing           | Go         | Gin + gRPC   | MongoDB    | 3002, 50051 | คำนวณราคาค่าโดยสาร              |
| Payment           | Python     | FastAPI      | PostgreSQL |    3003     | ประมวลผลการชำระเงิน             |
| Saga Orchestrator | JavaScript | Express.js   | MongoDB    |    3004     | จัดการ distributed transactions |
| Notification      | Python     | FastAPI      | In-Memory  |    3005     | ส่ง notifications               |

### Infrastructure

| Component             | Port  | Description             |
| :-------------------- | :---: | :---------------------- |
| Apache Kafka          | 9092  | Message broker          |
| Zookeeper             | 2181  | Kafka coordination      |
| Redis                 | 6379  | Caching layer           |
| PostgreSQL (Matching) | 5432  | Rides & Drivers data    |
| PostgreSQL (Payment)  | 5433  | Wallets & Payments data |
| MongoDB (Pricing)     | 27017 | Pricing rules & history |
| MongoDB (Saga)        | 27018 | Saga state tracking     |

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- 8GB+ RAM recommended

### Commands

```bash
# Clone repository
git clone <repository-url>
cd Microservice-Project

# Build และ Start ทุก services
docker-compose up --build

# Start แบบ detached (background)
docker-compose up -d --build

# ดู logs ของ service ใดๆ
docker-compose logs -f matching-service

# หยุดทุก services
docker-compose down

# ลบข้อมูล database ทั้งหมด (reset)
docker-compose down -v
```

### Access Points

| Service           | URL                   |
| :---------------- | :-------------------- |
| Frontend          | http://localhost:5173 |
| API Gateway       | http://localhost:3000 |
| Matching Service  | http://localhost:3001 |
| Pricing Service   | http://localhost:3002 |
| Payment Service   | http://localhost:3003 |
| Saga Orchestrator | http://localhost:3004 |
| Notification      | http://localhost:3005 |

---

## 📦 Services

### 1. API Gateway

**Location:** `api-gateway/`  
**Technology:** Node.js + Express.js  
**Port:** 3000

#### หน้าที่

- **Single Entry Point** - จุดเข้าเดียวสำหรับ Frontend
- **Reverse Proxy** - Forward requests ไป Matching Service
- **Request Logging** - Log ทุก incoming requests

#### Endpoints

```
GET  /health              - Health check
ALL  /api/*               - Proxy to Matching Service
```

#### Code Highlights

```javascript
// Proxy configuration
app.use(
  "/api",
  createProxyMiddleware({
    target: "http://matching-service:3001",
    pathRewrite: { "^/api": "" },
  })
);
```

---

### 2. Matching Service

**Location:** `matching-service/`  
**Technology:** Node.js + Express.js  
**Database:** PostgreSQL  
**Port:** 3001

#### หน้าที่

- **Driver Matching** - หา driver ที่ว่างอยู่
- **Ride Management** - สร้างและจัดการ rides
- **Coordination** - ประสานงานกับ Pricing และ Payment services

#### Database Schema

```sql
-- drivers table
CREATE TABLE drivers (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  vehicle VARCHAR,
  plate VARCHAR,
  available BOOLEAN DEFAULT true
);

-- rides table
CREATE TABLE rides (
  id VARCHAR PRIMARY KEY,
  rider_id VARCHAR NOT NULL,
  driver_id VARCHAR REFERENCES drivers(id),
  pickup_lat NUMERIC,
  pickup_lng NUMERIC,
  dropoff_lat NUMERIC,
  dropoff_lng NUMERIC,
  price_total NUMERIC,
  status VARCHAR DEFAULT 'pending'
);
```

#### Endpoints

```
GET   /health              - Health check
POST  /request-ride        - เรียกรถ (full flow)
GET   /rides               - List all rides
GET   /rides/:id           - Get ride by ID

# SAGA Endpoints
POST  /reserve-driver      - จอง driver (Step 1)
POST  /release-driver      - คืน driver (Compensation)
POST  /confirm-ride        - ยืนยัน ride (Step 4)
POST  /cancel-ride         - ยกเลิก ride (Compensation)
```

#### Communication

- **gRPC** → Pricing Service (คำนวณราคา)
- **HTTP** → Payment Service (ชำระเงิน)
- **Kafka Consumer** → รับ payment.completed events

---

### 3. Pricing Service

**Location:** `pricing-service/`  
**Technology:** Go + Gin + gRPC  
**Database:** MongoDB  
**Cache:** Redis  
**Ports:** 3002 (HTTP), 50051 (gRPC)

#### หน้าที่

- **Price Calculation** - คำนวณราคาจาก Haversine distance
- **gRPC Server** - รับ requests จาก Matching Service
- **Caching** - Cache ราคาที่คำนวณแล้วใน Redis

#### Pricing Formula

```
Distance = Haversine(pickup, dropoff)
Total = BaseFare + (Distance × PerKmRate)
If Total < MinFare: Total = MinFare
```

#### MongoDB Schema

```javascript
// pricing_rules collection
{
  rule_id: "default",
  base_fare: 25.0,    // ค่าเริ่มต้น (บาท)
  per_km_rate: 7.0,   // ค่าต่อ km (บาท)
  min_fare: 35.0,     // ขั้นต่ำ (บาท)
  currency: "THB",
  active: true
}

// price_history collection
{
  ride_id: "ride-xxx",
  distance_km: 8.5,
  total: 84.50,
  base_fare: 25.0,
  created_at: ISODate()
}
```

#### gRPC Definition

```protobuf
service PricingService {
  rpc CalculatePrice(PriceRequest) returns (PriceResponse);
}

message PriceRequest {
  double pickup_lat = 1;
  double pickup_lng = 2;
  double dropoff_lat = 3;
  double dropoff_lng = 4;
}

message PriceResponse {
  double total = 1;
  double base_fare = 2;
  double distance_fee = 3;
  double distance_km = 4;
  string currency = 5;
}
```

#### Endpoints

```
GET   /health              - Health check
POST  /calculate           - HTTP fallback for price calculation
GET   /rules               - Get current pricing rules
```

---

### 4. Payment Service

**Location:** `payment-service/`  
**Technology:** Python + FastAPI  
**Database:** PostgreSQL  
**Messaging:** Kafka Producer  
**Port:** 3003

#### หน้าที่

- **Wallet Management** - จัดการกระเป๋าเงินของ riders
- **Payment Processing** - หักเงินจาก wallet
- **Transaction Recording** - บันทึกประวัติธุรกรรม
- **Kafka Producer** - Publish payment events

#### Database Schema

```sql
-- wallets table
CREATE TABLE wallets (
  rider_id VARCHAR PRIMARY KEY,
  balance DECIMAL(10,2) DEFAULT 500.00,
  currency VARCHAR DEFAULT 'THB'
);

-- payments table
CREATE TABLE payments (
  id VARCHAR PRIMARY KEY,
  ride_id VARCHAR NOT NULL,
  rider_id VARCHAR NOT NULL,
  amount DECIMAL(10,2),
  status VARCHAR DEFAULT 'pending'  -- pending, completed, refunded
);

-- transactions table
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  wallet_id VARCHAR REFERENCES wallets(rider_id),
  payment_id VARCHAR,
  type VARCHAR,  -- debit, refund
  amount DECIMAL(10,2),
  balance_before DECIMAL(10,2),
  balance_after DECIMAL(10,2)
);
```

#### Endpoints

```
GET   /health              - Health check
POST  /process             - Process payment
GET   /payments            - List all payments
GET   /payments/:id        - Get payment by ID
GET   /wallets/:rider_id   - Get wallet balance

# SAGA Endpoint
POST  /refund              - Refund payment (Compensation)
```

#### Kafka Events

```json
// Topic: payment.completed
{
  "paymentId": "pay-xxx",
  "rideId": "ride-xxx",
  "riderId": "rider-001",
  "amount": 85.50,
  "status": "completed",
  "timestamp": "2026-01-15T00:30:00Z"
}

// Topic: payment.refunded
{
  "paymentId": "pay-xxx",
  "sagaId": "saga-xxx",
  "amount": 85.50,
  "status": "refunded",
  "timestamp": "2026-01-15T00:35:00Z"
}
```

---

### 5. Saga Orchestrator

**Location:** `saga-orchestrator/`  
**Technology:** Node.js + Express.js  
**Database:** MongoDB  
**Messaging:** Kafka  
**Port:** 3004

#### หน้าที่

- **Saga Coordination** - ควบคุม distributed transaction flow
- **State Management** - Track saga state ทุก step
- **Compensation** - Execute rollback เมื่อ step ใดล้มเหลว

#### MongoDB Schema

```javascript
// sagas collection
{
  _id: "saga-xxx",
  type: "RIDE_BOOKING",
  status: "COMPLETED",  // INITIATED, RESERVING_DRIVER, PROCESSING_PAYMENT, COMPLETED, COMPENSATING, FAILED
  payload: {
    riderId: "rider-001",
    pickupLocation: { lat: 13.7563, lng: 100.5018 },
    dropoffLocation: { lat: 13.7234, lng: 100.5123 }
  },
  steps: [
    { name: "RESERVE_DRIVER", status: "COMPLETED", result: {...} },
    { name: "CALCULATE_PRICE", status: "COMPLETED", result: {...} },
    { name: "PROCESS_PAYMENT", status: "COMPLETED", result: {...} },
    { name: "CONFIRM_RIDE", status: "COMPLETED", result: {...} }
  ],
  createdAt: ISODate(),
  updatedAt: ISODate()
}
```

#### SAGA Steps

| Step               | Action                          | Compensation                    |
| ------------------ | ------------------------------- | ------------------------------- |
| 1. Reserve Driver  | `POST /matching/reserve-driver` | `POST /matching/release-driver` |
| 2. Calculate Price | `gRPC CalculatePrice`           | - (no compensation needed)      |
| 3. Process Payment | `POST /payment/process`         | `POST /payment/refund`          |
| 4. Confirm Ride    | `POST /matching/confirm-ride`   | `POST /matching/cancel-ride`    |

#### Endpoints

```
GET   /health              - Health check
POST  /saga/ride-booking   - Start new saga
GET   /saga/:id            - Get saga status
GET   /sagas               - List all sagas
```

---

### 6. Notification Service

**Location:** `notification-service/`  
**Technology:** Python + FastAPI  
**Messaging:** Kafka Consumer  
**Port:** 3005

#### หน้าที่

- **Event Listening** - Subscribe to payment.completed events
- **Notification Creation** - สร้าง notification records
- **Send Notifications** - (Simulated) ส่ง push/SMS/email

#### Kafka Consumer

```python
# Subscribed Topics
topics = ["payment.completed"]

# Event Processing
async def process_payment_event(event):
    notification = {
        "type": "payment_completed",
        "riderId": event["riderId"],
        "message": f"การชำระเงิน {event['amount']} บาท สำเร็จแล้ว! 🎉"
    }
    # Send via FCM, Twilio, SendGrid, etc.
```

#### Endpoints

```
GET   /health                    - Health check
GET   /notifications             - List all notifications
GET   /notifications/:rider_id   - Get notifications by rider
POST  /notifications/test        - Send test notification
```

---

## 🔗 Communication Patterns

### 1. Synchronous (Request-Response)

| From        | To           | Protocol   | Use Case               |
| ----------- | ------------ | ---------- | ---------------------- |
| Frontend    | API Gateway  | HTTP REST  | User requests          |
| API Gateway | Matching     | HTTP Proxy | Forward requests       |
| Matching    | Pricing      | **gRPC**   | Calculate price (fast) |
| Matching    | Payment      | HTTP REST  | Process payment        |
| Saga        | All Services | HTTP REST  | Saga step execution    |

### 2. Asynchronous (Event-Driven)

| From    | To           | Protocol | Topic               |
| ------- | ------------ | -------- | ------------------- |
| Payment | Matching     | Kafka    | `payment.completed` |
| Payment | Notification | Kafka    | `payment.completed` |
| Payment | Saga         | Kafka    | `payment.refunded`  |

### gRPC vs HTTP

```
┌─────────────────────────────────────────────────────────┐
│                  gRPC (Pricing)                         │
│  ✅ Fast (binary protocol, HTTP/2)                      │
│  ✅ Type-safe (Protocol Buffers)                        │
│  ✅ Low latency for internal services                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  HTTP REST (Others)                     │
│  ✅ Simple, widely supported                            │
│  ✅ Easy debugging (JSON)                               │
│  ✅ Browser compatible                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Per Service Pattern

แต่ละ Service มี Database ของตัวเอง - **ไม่มี Service ใดเข้าถึงข้อมูลของ Service อื่นโดยตรง**

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE PER SERVICE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │   Matching    │    │    Pricing    │    │    Payment    │    │
│  │   Service     │    │    Service    │    │    Service    │    │
│  └───────┬───────┘    └───────┬───────┘    └───────┬───────┘    │
│          │                    │                    │            │
│          │ OWNS               │ OWNS               │ OWNS       │
│          ▼                    ▼                    ▼            │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │  PostgreSQL   │    │   MongoDB     │    │  PostgreSQL   │    │
│  │  - drivers    │    │  - rules      │    │  - wallets    │    │
│  │  - rides      │    │  - history    │    │  - payments   │    │
│  └───────────────┘    └───────────────┘    └───────────────┘    │
│                                                                 │
│  ❌ No direct database access between services                  │
│  ✅ Services communicate via APIs only                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits

- **Loose Coupling** - Services independent
- **Technology Freedom** - Each service uses best-fit database
- **Independent Scaling** - Scale databases separately
- **Fault Isolation** - Database failure affects only one service

---

## 🔄 SAGA Pattern

### Why SAGA?

ในระบบ microservices ไม่สามารถใช้ traditional database transactions (ACID) ข้าม services ได้ SAGA Pattern ช่วยจัดการ **distributed transactions** โดย:

1. แบ่ง transaction เป็น steps
2. แต่ละ step มี compensation (rollback) action
3. ถ้า step ใดล้มเหลว → execute compensations ย้อนกลับ

### SAGA Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RIDE BOOKING SAGA                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        HAPPY PATH ✅                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│     Step 1              Step 2              Step 3              Step 4      │
│  ┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐   │
│  │ Reserve  │───────▶│Calculate │───────▶│ Process  │───────▶│ Confirm  │   │
│  │ Driver   │        │  Price   │        │ Payment  │        │  Ride    │   │
│  └──────────┘        └──────────┘        └──────────┘        └──────────┘   │
│                                                                      │      │
│                                                                      ▼      │
│                                                               ✅ COMPLETED  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     FAILURE SCENARIO ❌                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│     Step 1              Step 2              Step 3 ❌                       │
│  ┌──────────┐        ┌──────────┐        ┌──────────┐                       │
│  │ Reserve  │───────▶│Calculate │───────▶│ Process  │ ──── FAILED!         │
│  │ Driver   │        │  Price   │        │ Payment  │                       │
│  └──────────┘        └──────────┘        └──────────┘                       │
│       ▲                                        │                            │
│       │                                        │                            │
│       │         COMPENSATION FLOW              │                            │
│       │         ◀──────────────────────────────┘                            │
│       │                                                                     │
│  ┌──────────┐                                                               │
│  │ Release  │◀──────────────────  Rollback in reverse order                │
│  │ Driver   │                                                               │
│  └──────────┘                                                               │
│       │                                                                     │
│       ▼                                                                     │
│   ❌ COMPENSATED                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### State Machine

```
INITIATED → RESERVING_DRIVER → CALCULATING_PRICE → PROCESSING_PAYMENT → CONFIRMING_RIDE → COMPLETED
                   │                   │                   │                    │
                   └───────────────────┴───────────────────┴────────────────────┘
                                               │
                                               ▼
                                         COMPENSATING → COMPENSATED
                                               │
                                               ▼
                                            FAILED
```

---

## 📡 API Reference

### API Gateway (Port 3000)

```bash
# Health check
curl http://localhost:3000/health

# Request ride (proxied to Matching)
curl -X POST http://localhost:3000/api/request-ride \
  -H "Content-Type: application/json" \
  -d '{
    "riderId": "rider-001",
    "pickupLocation": {"lat": 13.7563, "lng": 100.5018},
    "dropoffLocation": {"lat": 13.7469, "lng": 100.5349}
  }'
```

### Saga Orchestrator (Port 3004)

```bash
# Start ride booking saga
curl -X POST http://localhost:3004/saga/ride-booking \
  -H "Content-Type: application/json" \
  -d '{
    "riderId": "rider-001",
    "pickupLocation": {"lat": 13.7563, "lng": 100.5018},
    "dropoffLocation": {"lat": 13.7469, "lng": 100.5349}
  }'

# Get saga status
curl http://localhost:3004/saga/{saga-id}

# List all sagas
curl http://localhost:3004/sagas
```

### Health Checks

```bash
curl http://localhost:3001/health  # Matching
curl http://localhost:3002/health  # Pricing
curl http://localhost:3003/health  # Payment
curl http://localhost:3004/health  # Saga Orchestrator
curl http://localhost:3005/health  # Notification
```

---

## 📁 โครงสร้างโปรเจกต์

```
Microservice-Project/
├── docker-compose.yml           # Container orchestration
├── README.md                    # Documentation
│
├── proto/
│   └── pricing.proto            # gRPC service definition
│
├── api-gateway/
│   ├── server.js                # Express proxy server
│   ├── package.json
│   └── Dockerfile
│
├── matching-service/
│   ├── server.js                # Main service + SAGA endpoints
│   ├── init.sql                 # PostgreSQL schema
│   ├── package.json
│   └── Dockerfile
│
├── pricing-service/
│   ├── main.go                  # Gin + gRPC server
│   ├── pricingpb/
│   │   └── pricing.go           # Generated gRPC code
│   ├── init.js                  # MongoDB seed data
│   ├── go.mod
│   └── Dockerfile
│
├── payment-service/
│   ├── main.py                  # FastAPI + Kafka producer
│   ├── init.sql                 # PostgreSQL schema
│   ├── requirements.txt
│   └── Dockerfile
│
├── saga-orchestrator/
│   ├── server.js                # Orchestrator service
│   ├── sagaStateMachine.js      # State machine logic
│   ├── package.json
│   └── Dockerfile
│
├── notification-service/
│   ├── main.py                  # FastAPI + Kafka consumer
│   ├── requirements.txt
│   └── Dockerfile
│
└── frontend/
    ├── src/
    │   └── App.jsx              # React application
    ├── package.json
    └── Dockerfile
```

---

## 📚 เทคโนโลยีและ Patterns

### Microservices Patterns

| Pattern                  | Implementation          | Description                          |
| ------------------------ | ----------------------- | ------------------------------------ |
| **API Gateway**          | `api-gateway/`          | Single entry point, routing, logging |
| **Database Per Service** | Each service has own DB | Loose coupling, polyglot persistence |
| **SAGA (Orchestration)** | `saga-orchestrator/`    | Distributed transactions             |
| **Event-Driven**         | Kafka                   | Async communication, decoupling      |

### Technology Stack

| Category             | Technologies                     |
| -------------------- | -------------------------------- |
| **Languages**        | JavaScript (Node.js), Go, Python |
| **Web Frameworks**   | Express.js, Gin, FastAPI         |
| **Databases**        | PostgreSQL, MongoDB              |
| **Cache**            | Redis                            |
| **Messaging**        | Apache Kafka                     |
| **RPC**              | gRPC + Protocol Buffers          |
| **Containerization** | Docker, Docker Compose           |

### Resilience Patterns

| Pattern           | Where              | Description                                             |
| ----------------- | ------------------ | ------------------------------------------------------- |
| **Fallback**      | Matching → Pricing | Use HTTP if gRPC fails, calculate locally if HTTP fails |
| **Compensation**  | Saga Orchestrator  | Rollback on failure                                     |
| **Retry**         | Kafka consumers    | Retry on transient failures                             |
| **Health Checks** | All services       | Liveness/readiness probes                               |

---

## 🧑‍💻 Development

### Local Development (without Docker)

```bash
# Matching Service
cd matching-service
npm install
npm run dev

# Pricing Service
cd pricing-service
go run main.go

# Payment Service
cd payment-service
pip install -r requirements.txt
python main.py
```

### Adding New Service

1. สร้าง folder ใหม่พร้อม Dockerfile
2. เพิ่ม service ใน `docker-compose.yml`
3. Connect to Kafka/Database ตามต้องการ
4. Register endpoints ใน API Gateway (ถ้าต้องการ expose)

---

## 📄 License

MIT License - Free to use for learning and development.
