/**
 * Saga Orchestrator Service
 * จัดการ distributed transactions ด้วย SAGA Pattern (Orchestration-based)
 */

import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Kafka } from "kafkajs";
import { MongoClient } from "mongodb";
import axios from "axios";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import {
  SagaState,
  StepStatus,
  createSaga,
  getCurrentStep,
  getCompensationSteps,
  updateStepStatus,
  advanceToNextStep,
  isSagaComplete,
} from "./sagaStateMachine.js";

const app = express();
const PORT = process.env.PORT || 3004;

// =========================================
// Configuration
// =========================================
const CONFIG = {
  stepTimeout: 10000, // 10 seconds per step
  maxRetries: 3,
  retryDelay: 1000, // 1 second between retries
  services: {
    matching:
      process.env.MATCHING_SERVICE_URL || "http://matching-service:3001",
    pricing: process.env.PRICING_SERVICE_HOST || "pricing-service:50051",
    payment: process.env.PAYMENT_SERVICE_URL || "http://payment-service:3003",
  },
};

// =========================================
// MongoDB Connection (Saga State Store)
// =========================================
let mongoClient = null;
let sagaDB = null;

async function initMongoDB() {
  try {
    const mongoUrl =
      process.env.MONGO_URL ||
      "mongodb://saga_user:saga_pass@saga-db:27017/saga_db?authSource=admin";
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    sagaDB = mongoClient.db("saga_db");
    console.log("✅ MongoDB connected for saga state");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}

async function saveSaga(saga) {
  if (!sagaDB) return;
  await sagaDB
    .collection("sagas")
    .updateOne({ _id: saga._id }, { $set: saga }, { upsert: true });
}

async function getSaga(sagaId) {
  if (!sagaDB) return null;
  return await sagaDB.collection("sagas").findOne({ _id: sagaId });
}

// =========================================
// Kafka Producer
// =========================================
let kafkaProducer = null;

async function initKafka() {
  try {
    const kafka = new Kafka({
      clientId: "saga-orchestrator",
      brokers: [process.env.KAFKA_BROKER || "kafka:9092"],
      retry: { initialRetryTime: 3000, retries: 10 },
    });

    kafkaProducer = kafka.producer();
    await kafkaProducer.connect();
    console.log("✅ Kafka producer connected");
  } catch (err) {
    console.error("❌ Kafka connection failed:", err.message);
  }
}

async function publishEvent(topic, event) {
  if (!kafkaProducer) return;
  try {
    await kafkaProducer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }],
    });
    console.log(`📤 [Kafka] Published: ${topic}`);
  } catch (err) {
    console.error(`❌ Kafka publish failed: ${err.message}`);
  }
}

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
    pricingClient = new pricingProto.PricingService(
      CONFIG.services.pricing,
      grpc.credentials.createInsecure()
    );
    console.log(`✅ gRPC client connected to ${CONFIG.services.pricing}`);
  } catch (err) {
    console.error("❌ gRPC client init failed:", err.message);
  }
}

// =========================================
// Saga Step Executors
// =========================================

async function reserveDriver(saga) {
  console.log(`🚗 [Step 1] Reserving driver...`);
  const response = await axios.post(
    `${CONFIG.services.matching}/reserve-driver`,
    {
      sagaId: saga._id,
      riderId: saga.payload.riderId,
      pickupLocation: saga.payload.pickupLocation,
    }
  );
  return response.data;
}

async function releaseDriver(saga, stepResult) {
  console.log(`🔙 [Compensate] Releasing driver...`);
  await axios.post(`${CONFIG.services.matching}/release-driver`, {
    sagaId: saga._id,
    driverId: stepResult.driverId,
  });
}

async function calculatePrice(saga) {
  console.log(`💰 [Step 2] Calculating price...`);
  return new Promise((resolve, reject) => {
    if (!pricingClient) {
      reject(new Error("gRPC client not initialized"));
      return;
    }
    pricingClient.CalculatePrice(
      {
        pickup_lat: saga.payload.pickupLocation.lat,
        pickup_lng: saga.payload.pickupLocation.lng,
        dropoff_lat: saga.payload.dropoffLocation.lat,
        dropoff_lng: saga.payload.dropoffLocation.lng,
      },
      (err, response) => {
        if (err) reject(err);
        else
          resolve({
            total: response.total,
            baseFare: response.base_fare,
            distanceFee: response.distance_fee,
            distanceKm: response.distance_km,
            currency: response.currency || "THB",
          });
      }
    );
  });
}

async function processPayment(saga) {
  console.log(`💳 [Step 3] Processing payment...`);
  const pricingResult = saga.steps[1].result;
  const response = await axios.post(`${CONFIG.services.payment}/process`, {
    rideId: saga._id,
    riderId: saga.payload.riderId,
    amount: pricingResult.total,
    currency: pricingResult.currency,
  });
  return response.data;
}

async function refundPayment(saga, stepResult) {
  console.log(`🔙 [Compensate] Refunding payment...`);
  await axios.post(`${CONFIG.services.payment}/refund`, {
    sagaId: saga._id,
    paymentId: stepResult.paymentId,
    amount: stepResult.amount,
  });
}

async function confirmRide(saga) {
  console.log(`✅ [Step 4] Confirming ride...`);
  const driverResult = saga.steps[0].result;
  const pricingResult = saga.steps[1].result;
  const paymentResult = saga.steps[2].result;

  const response = await axios.post(
    `${CONFIG.services.matching}/confirm-ride`,
    {
      sagaId: saga._id,
      riderId: saga.payload.riderId,
      driverId: driverResult.driverId,
      driver: driverResult.driver,
      pickupLocation: saga.payload.pickupLocation,
      dropoffLocation: saga.payload.dropoffLocation,
      pricing: pricingResult,
      payment: paymentResult,
    }
  );
  return response.data;
}

async function cancelRide(saga, stepResult) {
  console.log(`🔙 [Compensate] Cancelling ride...`);
  await axios.post(`${CONFIG.services.matching}/cancel-ride`, {
    sagaId: saga._id,
    rideId: stepResult.rideId,
  });
}

// Step executor mapping
const stepExecutors = {
  reserveDriver,
  calculatePrice,
  processPayment,
  confirmRide,
};

const compensationExecutors = {
  releaseDriver,
  refundPayment,
  cancelRide,
};

// =========================================
// Saga Execution Engine
// =========================================

async function executeStep(saga, stepDef, stepIndex) {
  const executor = stepExecutors[stepDef.action];
  if (!executor) throw new Error(`Unknown action: ${stepDef.action}`);

  updateStepStatus(saga, stepIndex, StepStatus.IN_PROGRESS);
  await saveSaga(saga);

  const result = await executor(saga);

  updateStepStatus(saga, stepIndex, StepStatus.COMPLETED, result);
  await saveSaga(saga);

  return result;
}

async function runCompensation(saga) {
  console.log(`\n🔄 Starting compensation for saga ${saga._id}`);
  saga.status = SagaState.COMPENSATING;
  await saveSaga(saga);

  const compensationSteps = getCompensationSteps(saga);

  for (const { step, definition } of compensationSteps) {
    try {
      const compensator = compensationExecutors[definition.compensation];
      if (compensator) {
        await compensator(saga, step.result);
        step.status = StepStatus.COMPENSATED;
        await saveSaga(saga);
        console.log(`✅ Compensated: ${definition.name}`);
      }
    } catch (err) {
      console.error(
        `❌ Compensation failed for ${definition.name}: ${err.message}`
      );
    }
  }

  saga.status = SagaState.COMPENSATED;
  await saveSaga(saga);
  await publishEvent("saga.compensated", { sagaId: saga._id });
}

async function executeSaga(saga) {
  console.log(`\n🚀 Starting saga execution: ${saga._id}`);
  await publishEvent("saga.started", { sagaId: saga._id, type: saga.type });

  try {
    while (!isSagaComplete(saga)) {
      const stepDef = getCurrentStep(saga);
      if (!stepDef) break;

      console.log(`\n📍 Executing step: ${stepDef.name}`);
      saga.status =
        SagaState[`${stepDef.name.replace("_", "ING_")}`] || saga.status;
      await saveSaga(saga);

      try {
        await executeStep(saga, stepDef, saga.currentStepIndex);
        advanceToNextStep(saga);

        // Check if completed
        if (saga.status === SagaState.COMPLETED) {
          console.log(`\n🎉 Saga completed successfully!`);
          await publishEvent("saga.completed", { sagaId: saga._id });
        }
      } catch (stepError) {
        console.error(`❌ Step failed: ${stepError.message}`);
        updateStepStatus(
          saga,
          saga.currentStepIndex,
          StepStatus.FAILED,
          null,
          stepError.message
        );
        await saveSaga(saga);
        await runCompensation(saga);
        break;
      }
    }
  } catch (error) {
    console.error(`❌ Saga execution failed: ${error.message}`);
    saga.status = SagaState.FAILED;
    await saveSaga(saga);
    await publishEvent("saga.failed", {
      sagaId: saga._id,
      error: error.message,
    });
  }

  return saga;
}

// =========================================
// Express Middleware & Routes
// =========================================
app.use(express.json());

// Health check
app.get("/health", async (req, res) => {
  res.json({
    service: "saga-orchestrator",
    status: "healthy",
    mongodb: sagaDB ? "connected" : "disconnected",
    kafka: kafkaProducer ? "connected" : "disconnected",
    grpc: pricingClient ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Start new saga (Ride Booking)
app.post("/saga/ride-booking", async (req, res) => {
  const { riderId, pickupLocation, dropoffLocation } = req.body;

  if (!riderId || !pickupLocation || !dropoffLocation) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log(
    `\n📨 [Orchestrator] New ride booking saga request from ${riderId}`
  );

  // Create saga
  const saga = createSaga("RIDE_BOOKING", {
    riderId,
    pickupLocation,
    dropoffLocation,
  });
  saga._id = `saga-${uuidv4().slice(0, 8)}`;
  await saveSaga(saga);

  // Execute saga asynchronously
  executeSaga(saga).catch((err) => {
    console.error(`Saga execution error: ${err.message}`);
  });

  // Return immediately with saga ID
  res.status(202).json({
    sagaId: saga._id,
    status: saga.status,
    message: "Saga started, use /saga/:id to check status",
  });
});

// Get saga status
app.get("/saga/:id", async (req, res) => {
  const saga = await getSaga(req.params.id);
  if (!saga) {
    return res.status(404).json({ error: "Saga not found" });
  }
  res.json(saga);
});

// List all sagas
app.get("/sagas", async (req, res) => {
  if (!sagaDB) {
    return res.json({ sagas: [], total: 0 });
  }
  const sagas = await sagaDB
    .collection("sagas")
    .find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  res.json({ sagas, total: sagas.length });
});

// =========================================
// Start Server
// =========================================
app.listen(PORT, async () => {
  console.log(`🎭 Saga Orchestrator running on port ${PORT}`);

  await initMongoDB();
  await initKafka();
  setTimeout(() => initGrpcClient(), 2000);
});
