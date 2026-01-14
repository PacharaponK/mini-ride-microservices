# 🚗 Mini Ride-Hailing Microservices

โปรเจกต์สาธิตหลักการ **Microservices Architecture** แบบครบวงจร พร้อม **Database Per Service Pattern**

---

## 🏗️ สถาปัตยกรรม

```
┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│ API Gateway │
│  React:5173 │     │ Express:3000│
└─────────────┘     └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   Matching    │  │    Pricing    │  │    Payment    │
│ Node.js:3001  │  │  Go/gRPC:3002 │  │ Python:3003   │
│    ↓          │  │    ↓          │  │    ↓          │
│ PostgreSQL    │  │   MongoDB     │  │ PostgreSQL    │
└───────────────┘  └───────────────┘  └───────────────┘
        │                                     │
        └─────────────┬───────────────────────┘
                      ▼
              ┌───────────────┐
              │     Kafka     │
              └───────────────┘
```

---

## 🛠️ Tech Stack

| Service     | เทคโนโลยี       | Database       |    Port     |
| :---------- | :-------------- | :------------- | :---------: |
| Frontend    | React + Vite    | -              |    5173     |
| API Gateway | Node.js/Express | -              |    3000     |
| Matching    | Node.js/Express | **PostgreSQL** |    3001     |
| Pricing     | Go/Gin + gRPC   | **MongoDB**    | 3002, 50051 |
| Payment     | Python/FastAPI  | **PostgreSQL** |    3003     |

### Infrastructure

| Service               | Port  |
| :-------------------- | :---: |
| Kafka                 | 9092  |
| Redis                 | 6379  |
| PostgreSQL (Matching) | 5432  |
| PostgreSQL (Payment)  | 5433  |
| MongoDB (Pricing)     | 27017 |

---

## 🗄️ Database Per Service Pattern

แต่ละ Service มี Database ของตัวเอง - **ไม่มี Service ใดเข้าถึงข้อมูลของ Service อื่นโดยตรง**

| Service  | Database   | ข้อมูลที่เก็บ                   |
| :------- | :--------- | :------------------------------ |
| Matching | PostgreSQL | drivers, rides                  |
| Pricing  | MongoDB    | pricing_rules, price_history    |
| Payment  | PostgreSQL | wallets, payments, transactions |

---

## 🚀 Quick Start

```bash
# Clone และเข้าโปรเจกต์
cd Microservice-Project

# รันทุก services + databases
docker-compose up --build

# หยุดทุก services
docker-compose down

# ลบข้อมูล database (reset)
docker-compose down -v
```

### เข้าใช้งาน

- **Frontend:** http://localhost:5173
- **API Gateway:** http://localhost:3000

---

## 🧪 ทดสอบระบบ

### curl command

```bash
curl -X POST http://localhost:3000/api/request-ride ^
  -H "Content-Type: application/json" ^
  -d "{\"riderId\":\"rider-001\",\"pickupLocation\":{\"lat\":13.7563,\"lng\":100.5018},\"dropoffLocation\":{\"lat\":13.7469,\"lng\":100.5349}}"
```

### ตรวจสอบ Health

```bash
curl http://localhost:3001/health  # Matching (PostgreSQL status)
curl http://localhost:3002/health  # Pricing (MongoDB status)
curl http://localhost:3003/health  # Payment (PostgreSQL status)
```

---

## 📁 โครงสร้างโปรเจกต์

```
Microservice-Project/
├── docker-compose.yml
├── proto/pricing.proto
├── matching-service/
│   ├── server.js        # + PostgreSQL client
│   └── init.sql         # Database schema
├── pricing-service/
│   ├── main.go          # + MongoDB client
│   └── init.js          # Database seed
└── payment-service/
    ├── main.py          # + PostgreSQL client
    └── init.sql         # Database schema
```

---

## 📚 เทคโนโลยีที่เรียนรู้

- ✅ **Database Per Service** - แยก database ตามหน้าที่
- ✅ **Polyglot Persistence** - PostgreSQL + MongoDB
- ✅ **Multi-language** - Node.js, Go, Python
- ✅ **gRPC** - High-performance RPC
- ✅ **Kafka** - Async messaging
- ✅ **Docker Compose** - Container orchestration
