import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Kafka } from "kafkajs";
import pg from "pg";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3001;

// =========================================
// PostgreSQL Database Connection
// =========================================
let dbPool = null;

async function initDatabase() {
  try {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgres://matching_user:matching_pass@matching-db:5432/matching_db";

    dbPool = new Pool({ connectionString });

    // Test connection
    const client = await dbPool.connect();
    console.log("✅ PostgreSQL connected");
    client.release();
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
    // Fallback to in-memory if DB not available
    console.log("⚠️ Using in-memory storage as fallback");
  }
}

// Database helper functions
async function getAvailableDriver() {
  if (!dbPool) return null;

  const result = await dbPool.query(
    "SELECT * FROM drivers WHERE available = true LIMIT 1"
  );
  return result.rows[0];
}

async function updateDriverAvailability(driverId, available) {
  if (!dbPool) return;

  await dbPool.query("UPDATE drivers SET available = $1 WHERE id = $2", [
    available,
    driverId,
  ]);
}

async function createRide(ride) {
  if (!dbPool) return;

  await dbPool.query(
    `INSERT INTO rides (id, rider_id, driver_id, pickup_lat, pickup_lng, 
     dropoff_lat, dropoff_lng, price_total, price_currency, payment_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ride.rideId,
      ride.riderId,
      ride.driver.id,
      ride.pickupLocation.lat,
      ride.pickupLocation.lng,
      ride.dropoffLocation.lat,
      ride.dropoffLocation.lng,
      ride.pricing.total,
      ride.pricing.currency,
      ride.payment?.paymentId,
      ride.status,
    ]
  );
}

async function getRideById(rideId) {
  if (!dbPool) return null;

  const result = await dbPool.query(
    `SELECT r.*, d.name as driver_name, d.vehicle, d.plate
     FROM rides r
     LEFT JOIN drivers d ON r.driver_id = d.id
     WHERE r.id = $1`,
    [rideId]
  );
  return result.rows[0];
}

async function getAllRides() {
  if (!dbPool) return [];

  const result = await dbPool.query(
    `SELECT r.*, d.name as driver_name, d.vehicle, d.plate
     FROM rides r
     LEFT JOIN drivers d ON r.driver_id = d.id
     ORDER BY r.created_at DESC`
  );
  return result.rows;
}

// =========================================
// In-Memory Fallback (if DB not available)
// =========================================
const fallbackDrivers = [
  {
    id: "driver-001",
    name: "สมชาย",
    vehicle: "Toyota Camry",
    plate: "กข-1234",
    available: true,
  },
  {
    id: "driver-002",
    name: "สมหญิง",
    vehicle: "Honda Civic",
    plate: "คง-5678",
    available: true,
  },
  {
    id: "driver-003",
    name: "สมศักดิ์",
    vehicle: "Mazda 3",
    plate: "จฉ-9012",
    available: true,
  },
];
const fallbackRides = [];

// =========================================
// Kafka Consumer (Payment Events)
// =========================================
let kafkaConsumer = null;

async function initKafkaConsumer() {
  try {
    const kafka = new Kafka({
      clientId: "matching-service",
      brokers: [process.env.KAFKA_BROKER || "kafka:9092"],
      retry: { initialRetryTime: 3000, retries: 10 },
    });

    kafkaConsumer = kafka.consumer({ groupId: "matching-group" });
    await kafkaConsumer.connect();
    await kafkaConsumer.subscribe({
      topic: "payment.completed",
      fromBeginning: false,
    });

    await kafkaConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value.toString());
        console.log(`📨 [Kafka] Received: ${topic}`, event);

        // Update ride status in database
        if (dbPool) {
          await dbPool.query(
            "UPDATE rides SET status = $1, payment_id = $2 WHERE id = $3",
            ["payment_confirmed", event.paymentId, event.rideId]
          );
        }
        console.log(`✅ Ride ${event.rideId} payment confirmed via Kafka`);
      },
    });

    console.log("✅ Kafka consumer connected");
  } catch (err) {
    console.error("❌ Kafka consumer init failed:", err.message);
  }
}

// =========================================
// Express Middleware
// =========================================
app.use(express.json());

// Health check
app.get("/health", async (req, res) => {
  let dbStatus = "disconnected";
  if (dbPool) {
    try {
      await dbPool.query("SELECT 1");
      dbStatus = "connected";
    } catch (e) {
      dbStatus = "error";
    }
  }

  res.json({
    service: "matching-service",
    status: "healthy",
    database: dbStatus,
    kafkaConnected: !!kafkaConsumer,
    timestamp: new Date().toISOString(),
  });
});

// =========================================
// Query Endpoints
// =========================================

// Get ride by ID
app.get("/rides/:id", async (req, res) => {
  const ride = dbPool
    ? await getRideById(req.params.id)
    : fallbackRides.find((r) => r.rideId === req.params.id);

  if (!ride) {
    return res.status(404).json({ error: "Ride not found" });
  }
  res.json(ride);
});

// List all rides
app.get("/rides", async (req, res) => {
  const rides = dbPool ? await getAllRides() : fallbackRides;
  res.json(rides);
});

// =========================================
// SAGA Pattern Endpoints
// =========================================

// Reserve driver (SAGA Step 1)
app.post("/reserve-driver", async (req, res) => {
  const { sagaId, riderId, pickupLocation } = req.body;
  console.log(`\n🎭 [SAGA] Reserve driver request for saga ${sagaId}`);

  try {
    let driver;
    if (dbPool) {
      driver = await getAvailableDriver();
      if (driver) {
        await updateDriverAvailability(driver.id, false);
      }
    } else {
      driver = fallbackDrivers.find((d) => d.available);
      if (driver) driver.available = false;
    }

    if (!driver) {
      return res.status(503).json({ error: "No drivers available" });
    }

    console.log(`✅ [SAGA] Driver reserved: ${driver.name}`);
    res.json({
      sagaId,
      driverId: driver.id,
      driver: {
        id: driver.id,
        name: driver.name,
        vehicle: driver.vehicle,
        plate: driver.plate,
      },
    });
  } catch (err) {
    console.error(`❌ [SAGA] Reserve driver failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Release driver (SAGA Compensation)
app.post("/release-driver", async (req, res) => {
  const { sagaId, driverId } = req.body;
  console.log(`\n🔙 [SAGA] Release driver ${driverId} for saga ${sagaId}`);

  try {
    if (dbPool) {
      await updateDriverAvailability(driverId, true);
    } else {
      const driver = fallbackDrivers.find((d) => d.id === driverId);
      if (driver) driver.available = true;
    }

    console.log(`✅ [SAGA] Driver released: ${driverId}`);
    res.json({ success: true, driverId });
  } catch (err) {
    console.error(`❌ [SAGA] Release driver failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Confirm ride (SAGA Step 4)
app.post("/confirm-ride", async (req, res) => {
  const {
    sagaId,
    riderId,
    driverId,
    driver,
    pickupLocation,
    dropoffLocation,
    pricing,
    payment,
  } = req.body;
  console.log(`\n✅ [SAGA] Confirm ride for saga ${sagaId}`);

  try {
    const rideId = sagaId; // Use saga ID as ride ID for traceability
    const ride = {
      rideId,
      riderId,
      driver,
      pickupLocation,
      dropoffLocation,
      pricing,
      payment,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };

    if (dbPool) {
      await createRide(ride);
      console.log(`💾 [SAGA] Ride saved to PostgreSQL`);
    } else {
      fallbackRides.push(ride);
    }

    console.log(`✅ [SAGA] Ride confirmed: ${rideId}`);
    res.json(ride);
  } catch (err) {
    console.error(`❌ [SAGA] Confirm ride failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Cancel ride (SAGA Compensation)
app.post("/cancel-ride", async (req, res) => {
  const { sagaId, rideId } = req.body;
  console.log(`\n🔙 [SAGA] Cancel ride ${rideId} for saga ${sagaId}`);

  try {
    if (dbPool) {
      await dbPool.query("UPDATE rides SET status = $1 WHERE id = $2", [
        "cancelled",
        rideId,
      ]);
    } else {
      const ride = fallbackRides.find((r) => r.rideId === rideId);
      if (ride) ride.status = "cancelled";
    }

    console.log(`✅ [SAGA] Ride cancelled: ${rideId}`);
    res.json({ success: true, rideId });
  } catch (err) {
    console.error(`❌ [SAGA] Cancel ride failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// Start Server
// =========================================
app.listen(PORT, async () => {
  console.log(`🚗 Matching Service running on port ${PORT}`);

  // Initialize PostgreSQL
  await initDatabase();

  // Initialize Kafka consumer
  setTimeout(() => initKafkaConsumer(), 5000);
});
