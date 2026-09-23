/** Nombres de topics: deben coincidir con infra/kafka/create-topics.sh */
export const Topics = {
  ALERTS_RAW: "alerts.raw",
  ALERTS_NORMALIZED: "alerts.normalized",
  ALERTS_CRITICAL: "alerts.critical",
  CHECKINS: "checkins",
  CHAT: "chat.global",
  DEVICE_ACKS: "device.acks",
  SENSOR_TRIGGERS: "sensor.triggers",
  SIM_FLOOD: "sim.flood",
  DEAD_LETTER: "dead.letter",
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];
