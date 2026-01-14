import express from "express";
import { v4 as uuidv4 } from "uuid";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { Kafka } from "kafkajs";
import axios from "axios";
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
// gRPC Client (Pricing Service)
// =========================================
let pricingClient = null;

function initGrpcClient() {
  try {
    const PROTO_PATH = process.env.PROTO_PATH || "/app/proto/pricing.proto";
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const pricingProto = grpc.loadPackageDefinition(packageDefinition).pricing;
    const PRICING_HOST =
      process.env.PRICING_SERVICE_HOST || "pricing-service:50051";

    pricingClient = new pricingProto.PricingService(
      PRICING_HOST,
      grpc.credentials.createInsecure()
    );
    console.log(`✅ gRPC client connected to ${PRICING_HOST}`);
  } catch (err) {
    console.error("❌ gRPC client init failed:", err.message);
  }
}

function calculatePriceGrpc(pickup, dropoff) {
  return new Promise((resolve, reject) => {
    if (!pricingClient) {
      reject(new Error("gRPC client not initialized"));
      return;
    }

    pricingClient.CalculatePrice(
      {
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
      },
      (err, response) => {
        if (err) reject(err);
        else resolve(response);
      }
    );
  });
}

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
    grpcConnected: !!pricingClient,
    kafkaConnected: !!kafkaConsumer,
    timestamp: new Date().toISOString(),
  });
});

// =========================================
// Resilience Logic: Fallback Pricing
// =========================================
function calculateFallbackPrice(pickup, dropoff) {
  // Simple Haversine Distance (copied logic for fallback)
  const R = 6371; // Earth radius in km
  const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
  const dLng = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pickup.lat * Math.PI) / 180) *
      Math.cos((dropoff.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  // Static Fallback Rules
  const BASE_FARE = 30; // แพงกว่าปกติหน่อย (Penalty) หรือ Safety margin
  const PER_KM = 8;
  const total = Math.ceil(BASE_FARE + distanceKm * PER_KM);

  return {
    total: total,
    currency: "THB",
    source: "fallback (matching local)", // ระบุที่มา
    breakdown: {
      baseFare: BASE_FARE,
      distanceFee: Math.ceil(distanceKm * PER_KM),
      distanceKm: distanceKm,
    },
  };
}

// =========================================
// Main Endpoint: Request Ride
// =========================================
app.post("/request-ride", async (req, res) => {
  const { riderId, pickupLocation, dropoffLocation } = req.body;

  console.log(`\n🚗 [Matching] New ride request from ${riderId}`);
  console.log(`   📍 Pickup: ${JSON.stringify(pickupLocation)}`);
  console.log(`   🎯 Dropoff: ${JSON.stringify(dropoffLocation)}`);

  try {
    // 1. Find available driver
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
    console.log(
      `✅ [Matching] Assigned driver: ${driver.name} (from ${
        dbPool ? "PostgreSQL" : "memory"
      })`
    );

    // 2. Pricing Strategy (Resilience Pattern)
    // Try gRPC -> Fail -> Try HTTP -> Fail -> Use Fallback
    let pricing;
    try {
      console.log(`📡 [Matching] Asking Pricing Service (gRPC)...`);
      const grpcResponse = await calculatePriceGrpc(
        pickupLocation,
        dropoffLocation
      );
      pricing = {
        total: grpcResponse.total,
        currency: grpcResponse.currency || "THB",
        source: "pricing-service (gRPC)",
        breakdown: {
          baseFare: grpcResponse.base_fare,
          distanceFee: grpcResponse.distance_fee,
          distanceKm: grpcResponse.distance_km,
        },
      };
      console.log(`✅ [Matching] Got price from gRPC: ${pricing.total} THB`);
    } catch (grpcErr) {
      console.warn(
        `⚠️ [Matching] gRPC failed (${grpcErr.message}). Trying HTTP fallback...`
      );

      try {
        const pricingUrl =
          process.env.PRICING_HTTP_URL || "http://pricing-service:3002";
        const httpResponse = await axios.post(`${pricingUrl}/calculate`, {
          pickupLocation,
          dropoffLocation,
        });
        pricing = { ...httpResponse.data, source: "pricing-service (HTTP)" };
        console.log(`✅ [Matching] Got price from HTTP: ${pricing.total} THB`);
      } catch (httpErr) {
        console.error(
          `❌ [Matching] HTTP failed too (${httpErr.message}). Using Local Fallback!`
        );

        // FINAL FALLBACK: Calculate locally
        pricing = calculateFallbackPrice(pickupLocation, dropoffLocation);
        console.log(`🛡️ [Matching] Used Fallback Price: ${pricing.total} THB`);
      }
    }

    // 3. Create ride record
    const rideId = `ride-${uuidv4().slice(0, 8)}`;
    const ride = {
      rideId,
      riderId,
      driver: {
        id: driver.id,
        name: driver.name,
        vehicle: driver.vehicle,
        plate: driver.plate,
      },
      pickupLocation,
      dropoffLocation,
      pricing,
      status: "matched",
      createdAt: new Date().toISOString(),
    };

    // 4. Process Payment
    let payment;
    try {
      const paymentUrl =
        process.env.PAYMENT_SERVICE_URL || "http://payment-service:3003";
      const paymentResponse = await axios.post(`${paymentUrl}/process`, {
        rideId,
        riderId,
        amount: pricing.total,
        currency: pricing.currency,
      });
      payment = paymentResponse.data;
      console.log(`✅ [Matching] Payment processed: ${payment.paymentId}`);
    } catch (payErr) {
      console.error("❌ [Matching] Payment failed:", payErr.message);
      // Rollback driver
      if (dbPool) await updateDriverAvailability(driver.id, true);
      else driver.available = true;
      return res.status(500).json({ error: "Payment processing failed" });
    }

    // 5. Finalize ride
    ride.payment = payment;
    ride.status = "confirmed";

    if (dbPool) {
      await createRide(ride);
      console.log(`💾 [Matching] Ride saved to PostgreSQL`);
    } else {
      fallbackRides.push(ride);
    }

    console.log(`✅ [Matching] Ride confirmed: ${rideId}\n`);

    res.json(ride);
  } catch (err) {
    console.error("❌ [Matching] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
// Start Server
// =========================================
app.listen(PORT, async () => {
  console.log(`🚗 Matching Service running on port ${PORT}`);

  // Initialize PostgreSQL
  await initDatabase();

  // Initialize gRPC client
  setTimeout(() => initGrpcClient(), 2000);

  // Initialize Kafka consumer
  setTimeout(() => initKafkaConsumer(), 5000);
});
