/**
 * Saga State Machine - จัดการ state transitions สำหรับ Ride Booking Saga
 */

// Saga States
export const SagaState = {
  INITIATED: "INITIATED",
  RESERVING_DRIVER: "RESERVING_DRIVER",
  CALCULATING_PRICE: "CALCULATING_PRICE",
  PROCESSING_PAYMENT: "PROCESSING_PAYMENT",
  CONFIRMING_RIDE: "CONFIRMING_RIDE",
  COMPLETED: "COMPLETED",
  COMPENSATING: "COMPENSATING",
  COMPENSATED: "COMPENSATED",
  FAILED: "FAILED",
};

// Step Status
export const StepStatus = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  COMPENSATED: "COMPENSATED",
};

// Saga Step Definitions for Ride Booking
export const RIDE_BOOKING_STEPS = [
  {
    name: "RESERVE_DRIVER",
    action: "reserveDriver",
    compensation: "releaseDriver",
    nextState: SagaState.CALCULATING_PRICE,
  },
  {
    name: "CALCULATE_PRICE",
    action: "calculatePrice",
    compensation: null, // No compensation needed
    nextState: SagaState.PROCESSING_PAYMENT,
  },
  {
    name: "PROCESS_PAYMENT",
    action: "processPayment",
    compensation: "refundPayment",
    nextState: SagaState.CONFIRMING_RIDE,
  },
  {
    name: "CONFIRM_RIDE",
    action: "confirmRide",
    compensation: "cancelRide",
    nextState: SagaState.COMPLETED,
  },
];

/**
 * Create initial saga object
 */
export function createSaga(type, payload) {
  return {
    type,
    status: SagaState.INITIATED,
    payload,
    steps: RIDE_BOOKING_STEPS.map((step) => ({
      name: step.name,
      status: StepStatus.PENDING,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    })),
    currentStepIndex: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeout: 30000, // 30 seconds
  };
}

/**
 * Get current step definition
 */
export function getCurrentStep(saga) {
  return RIDE_BOOKING_STEPS[saga.currentStepIndex];
}

/**
 * Get steps that need compensation (in reverse order)
 */
export function getCompensationSteps(saga) {
  const completedSteps = saga.steps
    .slice(0, saga.currentStepIndex)
    .filter((step) => step.status === StepStatus.COMPLETED);

  return completedSteps
    .map((step, index) => ({
      step,
      definition: RIDE_BOOKING_STEPS[index],
    }))
    .filter(({ definition }) => definition.compensation !== null)
    .reverse();
}

/**
 * Update step status
 */
export function updateStepStatus(
  saga,
  stepIndex,
  status,
  result = null,
  error = null
) {
  const step = saga.steps[stepIndex];
  step.status = status;
  step.result = result;
  step.error = error;
  step.updatedAt = new Date().toISOString();

  if (status === StepStatus.IN_PROGRESS) {
    step.startedAt = new Date().toISOString();
  } else if (status === StepStatus.COMPLETED || status === StepStatus.FAILED) {
    step.completedAt = new Date().toISOString();
  }

  saga.updatedAt = new Date().toISOString();
  return saga;
}

/**
 * Advance saga to next step
 */
export function advanceToNextStep(saga) {
  const stepDef = getCurrentStep(saga);
  saga.status = stepDef.nextState;
  saga.currentStepIndex++;
  saga.updatedAt = new Date().toISOString();
  return saga;
}

/**
 * Check if saga is complete
 */
export function isSagaComplete(saga) {
  return (
    saga.status === SagaState.COMPLETED ||
    saga.status === SagaState.COMPENSATED ||
    saga.status === SagaState.FAILED
  );
}
