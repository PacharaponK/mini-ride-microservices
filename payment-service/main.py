"""
Payment Service - Python/FastAPI + PostgreSQL + Kafka Producer
"""
import os
import uuid
import asyncio
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager
from decimal import Decimal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from aiokafka import AIOKafkaProducer
import asyncpg
import json

# =========================================
# Logging Setup
# =========================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =========================================
# PostgreSQL Database Connection
# =========================================
db_pool: Optional[asyncpg.Pool] = None

async def init_database():
    global db_pool
    database_url = os.getenv("DATABASE_URL", 
        "postgresql://payment_user:payment_pass@payment-db:5432/payment_db")
    
    try:
        db_pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
        logger.info("✅ PostgreSQL connected")
    except Exception as e:
        logger.warning(f"⚠️ PostgreSQL connection failed: {e}")
        logger.info("Using in-memory storage as fallback")

async def close_database():
    global db_pool
    if db_pool:
        await db_pool.close()
        logger.info("PostgreSQL connection closed")

# Database helper functions
async def get_wallet(rider_id: str) -> Optional[dict]:
    if not db_pool:
        return None
    
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM wallets WHERE rider_id = $1", rider_id
        )
        if row:
            return dict(row)
    return None

async def create_wallet(rider_id: str, balance: float = 500.0):
    if not db_pool:
        return
    
    async with db_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO wallets (rider_id, balance, currency) 
               VALUES ($1, $2, 'THB') ON CONFLICT (rider_id) DO NOTHING""",
            rider_id, balance
        )

async def update_wallet_balance(rider_id: str, new_balance: float):
    if not db_pool:
        return
    
    async with db_pool.acquire() as conn:
        await conn.execute(
            "UPDATE wallets SET balance = $1, updated_at = NOW() WHERE rider_id = $2",
            new_balance, rider_id
        )

async def create_payment(payment_data: dict):
    if not db_pool:
        return
    
    async with db_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO payments (id, ride_id, rider_id, amount, currency, status)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            payment_data['paymentId'], payment_data['rideId'], 
            payment_data['riderId'], payment_data['amount'],
            payment_data['currency'], payment_data['status']
        )

async def create_transaction(wallet_id: str, payment_id: str, tx_type: str, 
                            amount: float, balance_before: float, balance_after: float):
    if not db_pool:
        return
    
    async with db_pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO transactions (wallet_id, payment_id, type, amount, balance_before, balance_after)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            wallet_id, payment_id, tx_type, amount, balance_before, balance_after
        )

async def get_payment(payment_id: str) -> Optional[dict]:
    if not db_pool:
        return None
    
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM payments WHERE id = $1", payment_id
        )
        if row:
            return dict(row)
    return None

async def get_all_payments() -> list:
    if not db_pool:
        return []
    
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM payments ORDER BY processed_at DESC LIMIT 100"
        )
        return [dict(row) for row in rows]

# =========================================
# In-Memory Fallback (if DB not available)
# =========================================
fallback_payments: list = []
fallback_wallets: dict = {
    "rider-001": {"balance": 1000.0, "currency": "THB"},
    "rider-002": {"balance": 500.0, "currency": "THB"},
    "rider-003": {"balance": 2000.0, "currency": "THB"},
}

# =========================================
# Kafka Producer
# =========================================
kafka_producer: Optional[AIOKafkaProducer] = None

async def init_kafka():
    global kafka_producer
    kafka_broker = os.getenv("KAFKA_BROKER", "kafka:9092")
    
    try:
        kafka_producer = AIOKafkaProducer(
            bootstrap_servers=kafka_broker,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        await kafka_producer.start()
        logger.info(f"✅ Kafka producer connected to {kafka_broker}")
    except Exception as e:
        logger.warning(f"⚠️ Kafka connection failed: {e}")

async def close_kafka():
    global kafka_producer
    if kafka_producer:
        await kafka_producer.stop()
        logger.info("Kafka producer stopped")

async def publish_payment_event(event_data: dict):
    if kafka_producer:
        try:
            await kafka_producer.send_and_wait("payment.completed", event_data)
            logger.info(f"📤 [Kafka] Published: payment.completed - {event_data['paymentId']}")
        except Exception as e:
            logger.error(f"❌ Kafka publish failed: {e}")
    else:
        logger.warning("⚠️ Kafka producer not available, skipping event publish")

# =========================================
# FastAPI App
# =========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("💳 Starting Payment Service (Python/FastAPI + PostgreSQL)")
    await asyncio.sleep(3)  # Wait for DB to be ready
    await init_database()
    await asyncio.sleep(2)  # Wait for Kafka to be ready
    await init_kafka()
    yield
    # Shutdown
    await close_kafka()
    await close_database()

app = FastAPI(
    title="Payment Service",
    description="Microservice สำหรับชำระเงิน (PostgreSQL + Kafka)",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================
# Pydantic Models
# =========================================
class ProcessPaymentRequest(BaseModel):
    rideId: str
    riderId: str
    amount: float
    currency: str = "THB"

class PaymentResponse(BaseModel):
    paymentId: str
    rideId: str
    riderId: str
    amount: float
    currency: str
    status: str
    processedAt: str

class HealthResponse(BaseModel):
    service: str
    status: str
    database: str
    kafkaConnected: bool
    paymentsCount: int
    timestamp: str

# =========================================
# Endpoints
# =========================================
@app.get("/health", response_model=HealthResponse)
async def health_check():
    db_status = "connected" if db_pool else "disconnected (using fallback)"
    payments_count = len(await get_all_payments()) if db_pool else len(fallback_payments)
    
    return HealthResponse(
        service="payment-service",
        status="healthy",
        database=db_status,
        kafkaConnected=kafka_producer is not None,
        paymentsCount=payments_count,
        timestamp=datetime.now().isoformat()
    )

@app.post("/process", response_model=PaymentResponse)
async def process_payment(request: ProcessPaymentRequest):
    """
    Process payment for a ride
    
    1. Check wallet balance (PostgreSQL or fallback)
    2. Deduct amount
    3. Record payment
    4. Record transaction
    5. Publish Kafka event
    """
    logger.info(f"💳 [Payment] Processing payment for ride {request.rideId}")
    logger.info(f"   Rider: {request.riderId}, Amount: {request.amount} {request.currency}")
    
    # Get wallet (from DB or fallback)
    wallet = None
    using_db = False
    
    if db_pool:
        wallet = await get_wallet(request.riderId)
        if not wallet:
            # Create new wallet
            await create_wallet(request.riderId, 500.0)
            wallet = await get_wallet(request.riderId)
        if wallet:
            using_db = True
            wallet['balance'] = float(wallet['balance'])  # Convert Decimal to float
    
    if not wallet:
        # Use fallback
        wallet = fallback_wallets.get(request.riderId)
        if not wallet:
            fallback_wallets[request.riderId] = {"balance": 500.0, "currency": "THB"}
            wallet = fallback_wallets[request.riderId]
        logger.info(f"   Created new wallet for {request.riderId}")
    
    # Check balance
    if wallet["balance"] < request.amount:
        logger.warning(f"❌ Insufficient balance: {wallet['balance']} < {request.amount}")
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance. Required: {request.amount}, Available: {wallet['balance']}"
        )
    
    balance_before = wallet["balance"]
    new_balance = balance_before - request.amount
    
    # Create payment record
    payment_id = f"pay-{uuid.uuid4().hex[:8]}"
    processed_at = datetime.now().isoformat()
    
    payment_data = {
        "paymentId": payment_id,
        "rideId": request.rideId,
        "riderId": request.riderId,
        "amount": request.amount,
        "currency": request.currency,
        "status": "completed",
        "processedAt": processed_at,
        "remainingBalance": new_balance
    }
    
    if using_db:
        # Update wallet
        await update_wallet_balance(request.riderId, new_balance)
        
        # Create payment record
        await create_payment(payment_data)
        
        # Create transaction record
        await create_transaction(
            request.riderId, payment_id, 'debit',
            request.amount, balance_before, new_balance
        )
        
        logger.info(f"💾 [Payment] Saved to PostgreSQL")
    else:
        # Update fallback
        wallet["balance"] = new_balance
        fallback_payments.append(payment_data)
    
    logger.info(f"✅ [Payment] Completed: {payment_id}")
    logger.info(f"   Remaining balance: {new_balance} {request.currency}")
    
    # Publish Kafka event
    await publish_payment_event({
        "paymentId": payment_id,
        "rideId": request.rideId,
        "riderId": request.riderId,
        "amount": request.amount,
        "status": "completed",
        "timestamp": processed_at
    })
    
    return PaymentResponse(
        paymentId=payment_id,
        rideId=request.rideId,
        riderId=request.riderId,
        amount=request.amount,
        currency=request.currency,
        status="completed",
        processedAt=processed_at
    )

@app.get("/payments/{payment_id}")
async def get_payment_by_id(payment_id: str):
    payment = await get_payment(payment_id) if db_pool else \
               next((p for p in fallback_payments if p["paymentId"] == payment_id), None)
    
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment

@app.get("/payments")
async def list_payments():
    payments = await get_all_payments() if db_pool else fallback_payments
    return {"payments": payments, "total": len(payments)}

@app.get("/wallets/{rider_id}")
async def get_wallet_balance(rider_id: str):
    wallet = await get_wallet(rider_id) if db_pool else fallback_wallets.get(rider_id)
    
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if isinstance(wallet.get('balance'), Decimal):
        wallet['balance'] = float(wallet['balance'])
    
    return {"riderId": rider_id, **wallet}

# =========================================
# Main
# =========================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3003"))
    uvicorn.run(app, host="0.0.0.0", port=port)
