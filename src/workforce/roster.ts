export const AUTONOMY_MODES = ["manual", "supervised", "autonomous"] as const;

export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export type WorkforceSeatId =
  | "ops-lead"
  | "queue-manager"
  | "scheduler"
  | "ui-operator"
  | "qa-reviewer"
  | "security-analyst"
  | "incident-commander"
  | "knowledge-curator";

export type WorkforceSeat = {
  id: WorkforceSeatId;
  label: string;
  autonomyMode: AutonomyMode;
  permissions: string[];
  systemsAccess: string[];
  defaultSchedule: {
    timezone: string;
    windows: string[];
  };
};

export const REQUIRED_SEAT_IDS = [
  "ops-lead",
  "queue-manager",
  "scheduler",
  "ui-operator",
  "qa-reviewer",
  "security-analyst",
  "incident-commander",
  "knowledge-curator",
] as const satisfies readonly WorkforceSeatId[];

export const WORKFORCE_ROSTER: readonly WorkforceSeat[] = [
  {
    id: "ops-lead",
    label: "Ops Lead",
    autonomyMode: "supervised",
    permissions: ["queue:prioritize", "queue:assign", "scheduler:approve"],
    systemsAccess: ["queue-service", "scheduler-service", "ops-dashboard"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Fri 08:00-16:00"],
    },
  },
  {
    id: "queue-manager",
    label: "Queue Manager",
    autonomyMode: "autonomous",
    permissions: ["queue:create", "queue:update", "queue:route"],
    systemsAccess: ["queue-service", "routing-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Sun 00:00-23:59"],
    },
  },
  {
    id: "scheduler",
    label: "Scheduler",
    autonomyMode: "autonomous",
    permissions: ["scheduler:seed", "scheduler:update", "scheduler:pause"],
    systemsAccess: ["scheduler-service", "calendar-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Sun 00:00-23:59"],
    },
  },
  {
    id: "ui-operator",
    label: "UI Operator",
    autonomyMode: "manual",
    permissions: ["ui:render", "ui:annotate"],
    systemsAccess: ["ui-service", "queue-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Fri 09:00-17:00"],
    },
  },
  {
    id: "qa-reviewer",
    label: "QA Reviewer",
    autonomyMode: "supervised",
    permissions: ["qa:review", "qa:approve"],
    systemsAccess: ["qa-service", "reporting-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Fri 07:00-15:00"],
    },
  },
  {
    id: "security-analyst",
    label: "Security Analyst",
    autonomyMode: "supervised",
    permissions: ["security:review", "security:block"],
    systemsAccess: ["security-service", "audit-log-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Fri 10:00-18:00"],
    },
  },
  {
    id: "incident-commander",
    label: "Incident Commander",
    autonomyMode: "manual",
    permissions: ["incident:declare", "incident:resolve"],
    systemsAccess: ["incident-service", "queue-service", "scheduler-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Sun 00:00-23:59"],
    },
  },
  {
    id: "knowledge-curator",
    label: "Knowledge Curator",
    autonomyMode: "manual",
    permissions: ["knowledge:publish", "knowledge:archive"],
    systemsAccess: ["knowledge-base", "ui-service"],
    defaultSchedule: {
      timezone: "UTC",
      windows: ["Mon-Fri 06:00-14:00"],
    },
  },
];

export type QueueSeat = Pick<WorkforceSeat, "id" | "autonomyMode" | "permissions">;
export type SchedulerSeedSeat = Pick<WorkforceSeat, "id" | "defaultSchedule" | "autonomyMode">;
export type UiSeat = Pick<WorkforceSeat, "id" | "label" | "autonomyMode" | "systemsAccess">;

// The roster is the single source of truth for queue creation.
export const QUEUE_SEATS: readonly QueueSeat[] = WORKFORCE_ROSTER.map((seat) => ({
  id: seat.id,
  autonomyMode: seat.autonomyMode,
  permissions: seat.permissions,
}));

// The roster is the single source of truth for scheduler seeding.
export const SCHEDULER_SEEDS: readonly SchedulerSeedSeat[] = WORKFORCE_ROSTER.map((seat) => ({
  id: seat.id,
  autonomyMode: seat.autonomyMode,
  defaultSchedule: seat.defaultSchedule,
}));

// The roster is the single source of truth for UI rendering.
export const UI_SEATS: readonly UiSeat[] = WORKFORCE_ROSTER.map((seat) => ({
  id: seat.id,
  label: seat.label,
  autonomyMode: seat.autonomyMode,
  systemsAccess: seat.systemsAccess,
}));
