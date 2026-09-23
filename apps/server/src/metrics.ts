/** Contadores en memoria; el panel admin los leerá de GET /metrics */
export const metrics = {
  startedAt: new Date().toISOString(),
  alertsNormalized: 0,
  alertsDuplicated: 0,
  alertsInvalid: 0,
  alertsDispatched: 0,
  deliveries: 0,
  acksReceived: 0,
  acksAcknowledged: 0,
  syncRequests: 0,
  connections: 0,
  sensorTriggers: 0,
  sensorRateLimited: 0,
  seismicDetections: 0,
  chatMessages: 0,
  lastPipelineLatencyMs: null as number | null,
};
