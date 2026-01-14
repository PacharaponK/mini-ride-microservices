"""
Notification Service - Python/FastAPI + Kafka Consumer
Subscribe to payment.completed events and send notifications
"""
import os
import asyncio
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from aiokafka import AIOKafkaConsumer
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
# In-Memory Storage for Notifications
# =========================================
notifications: list = []

# =========================================
# Kafka Consumer
# =========================================
kafka_consumer: Optional[AIOKafkaConsumer] = None
consumer_task: Optional[asyncio.Task] = None

async def process_payment_event(event_data: dict):
    """
    Process payment.completed event and create notification
    """
    logger.info(f"📬 [Notification] Received payment event: {event_data}")
    
    # Create notification record
    notification = {
        "id": f"notif-{len(notifications) + 1:04d}",
        "type": "payment_completed",
        "riderId": event_data.get("riderId"),
        "rideId": event_data.get("rideId"),
        "paymentId": event_data.get("paymentId"),
        "amount": event_data.get("amount"),
        "message": f"การชำระเงิน {event_data.get('amount')} บาท สำเร็จแล้ว! 🎉",
        "channel": "push",  # Could be: push, sms, email
        "status": "sent",
        "createdAt": datetime.now().isoformat()
    }
    
    notifications.append(notification)
    
    # Simulate sending notification (in real world: call FCM, Twilio, SendGrid, etc.)
    logger.info(f"📤 [Notification] Sent to rider {event_data.get('riderId')}: {notification['message']}")
    logger.info(f"   Payment ID: {event_data.get('paymentId')}")
    logger.info(f"   Amount: {event_data.get('amount')} THB")
    
    return notification

async def consume_kafka_events():
    """
    Background task to consume Kafka events
    """
    global kafka_consumer
    kafka_broker = os.getenv("KAFKA_BROKER", "kafka:9092")
    
    try:
        kafka_consumer = AIOKafkaConsumer(
            "payment.completed",
            bootstrap_servers=kafka_broker,
            group_id="notification-service",
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='earliest'
        )
        await kafka_consumer.start()
        logger.info(f"✅ Kafka consumer connected to {kafka_broker}")
        logger.info(f"📡 Subscribed to topic: payment.completed")
        
        async for message in kafka_consumer:
            try:
                event_data = message.value
                await process_payment_event(event_data)
            except Exception as e:
                logger.error(f"❌ Error processing message: {e}")
                
    except asyncio.CancelledError:
        logger.info("Kafka consumer task cancelled")
    except Exception as e:
        logger.warning(f"⚠️ Kafka connection failed: {e}")
        logger.info("Service will run without Kafka (demo mode)")

async def stop_kafka():
    global kafka_consumer, consumer_task
    
    if consumer_task:
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass
            
    if kafka_consumer:
        await kafka_consumer.stop()
        logger.info("Kafka consumer stopped")

# =========================================
# FastAPI App
# =========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global consumer_task
    
    # Startup
    logger.info("🔔 Starting Notification Service (Python/FastAPI + Kafka Consumer)")
    await asyncio.sleep(5)  # Wait for Kafka to be ready
    
    # Start Kafka consumer in background
    consumer_task = asyncio.create_task(consume_kafka_events())
    
    yield
    
    # Shutdown
    await stop_kafka()

app = FastAPI(
    title="Notification Service",
    description="Microservice สำหรับส่ง Notification (Kafka Consumer)",
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
class HealthResponse(BaseModel):
    service: str
    status: str
    kafkaConnected: bool
    notificationsCount: int
    timestamp: str

class NotificationResponse(BaseModel):
    id: str
    type: str
    riderId: str
    rideId: str
    paymentId: str
    amount: float
    message: str
    channel: str
    status: str
    createdAt: str

# =========================================
# Endpoints
# =========================================
@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        service="notification-service",
        status="healthy",
        kafkaConnected=kafka_consumer is not None and not kafka_consumer._closed if kafka_consumer else False,
        notificationsCount=len(notifications),
        timestamp=datetime.now().isoformat()
    )

@app.get("/notifications")
async def list_notifications():
    """List all notifications (newest first)"""
    return {
        "notifications": sorted(notifications, key=lambda x: x['createdAt'], reverse=True),
        "total": len(notifications)
    }

@app.get("/notifications/{rider_id}")
async def get_notifications_by_rider(rider_id: str):
    """Get notifications for a specific rider"""
    rider_notifications = [n for n in notifications if n.get('riderId') == rider_id]
    return {
        "riderId": rider_id,
        "notifications": sorted(rider_notifications, key=lambda x: x['createdAt'], reverse=True),
        "total": len(rider_notifications)
    }

@app.post("/notifications/test")
async def send_test_notification():
    """Send a test notification (for demo purposes)"""
    test_event = {
        "paymentId": "pay-demo1234",
        "rideId": "ride-demo1234",
        "riderId": "rider-demo",
        "amount": 150.0,
        "status": "completed",
        "timestamp": datetime.now().isoformat()
    }
    
    notification = await process_payment_event(test_event)
    return {"message": "Test notification sent", "notification": notification}

# =========================================
# Main
# =========================================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3005"))
    uvicorn.run(app, host="0.0.0.0", port=port)
