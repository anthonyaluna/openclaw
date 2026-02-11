import type { WorkforceSeat, WorkforceSeatId } from "./roster.js";

export type WorkforceRunSource = "chat" | "subagent" | "cron" | "workforce";
export type WorkforceRunStatus = "queued" | "running" | "ok" | "error" | "blocked" | "escalated";

export type WorkforcePolicyDecision = "allow" | "block" | "escalate";
export type WorkforceGuidancePriority = "high" | "medium" | "low";

export type WorkforceGuidanceStep = {
  id: string;
  title: string;
  detail: string;
  priority: WorkforceGuidancePriority;
  seatId?: WorkforceSeatId;
  action?: string;
  requireWritebackReceipt?: boolean;
};

export type WorkforceQueue = {
  id: string;
  seatId: WorkforceSeatId;
  name: string;
  priority: "low" | "normal" | "high";
  concurrency: number;
  backpressurePolicy: "drop-oldest" | "drop-newest" | "block";
  slaMinutes: number;
  pending: number;
};

export type WorkforceSchedule = {
  id: string;
  seatId: WorkforceSeatId;
  name: string;
  triggerType: "cron" | "event" | "manual";
  spec: string;
  enabled: boolean;
  intervalMs?: number;
  maxConcurrentRuns: number;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  action: string;
};

export type WorkforceDecisionOption = {
  id: string;
  label: string;
  decision: "allow" | "deny";
};

export type WorkforceDecisionCard = {
  decisionId: string;
  runId?: string;
  seatId: WorkforceSeatId;
  title: string;
  summary: string;
  options: WorkforceDecisionOption[];
  recommended: "allow" | "deny";
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  status: "pending" | "resolved";
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  resolvedBy?: string;
  resolution?: "allow" | "deny";
};

export type WorkforceReceipt = {
  receiptId: string;
  runId?: string;
  decisionId?: string;
  actor: string;
  action: string;
  outcome: string;
  ts: number;
  artifacts: string[];
  signature?: string;
};

export type WorkforceReplayFrame = {
  frameId: string;
  runId: string;
  seq: number;
  eventType: string;
  payloadRef?: string;
  stateDelta?: string;
  ts: number;
  source: WorkforceRunSource;
};

export type WorkforceRunEnvelope = {
  runId: string;
  source: WorkforceRunSource;
  seatId: WorkforceSeatId;
  action: string;
  status: WorkforceRunStatus;
  startedAtMs: number;
  endedAtMs?: number;
  summary?: string;
  error?: string;
  artifacts: string[];
};

export type WorkforceSeatRuntime = {
  id: WorkforceSeatId;
  label: string;
  autonomyMode: WorkforceSeat["autonomyMode"];
  queueId: string;
  status: "idle" | "running" | "blocked";
  owner: string;
  lastRunAtMs?: number;
};

export type WorkforceWorkspaceState = {
  appfolioWritebackEnforced: boolean;
  defaultChannel: "appfolio";
  commsRules: string[];
};

export type WorkforceStoreFile = {
  version: 1;
  initializedAtMs: number;
  updatedAtMs: number;
  seats: WorkforceSeatRuntime[];
  queues: WorkforceQueue[];
  schedules: WorkforceSchedule[];
  decisions: WorkforceDecisionCard[];
  receipts: WorkforceReceipt[];
  replayframes: WorkforceReplayFrame[];
  runs: WorkforceRunEnvelope[];
  workspace: WorkforceWorkspaceState;
  seqByRunId: Record<string, number>;
};

export type WorkforceStatus = {
  updatedAtMs: number;
  readiness: "ready" | "degraded";
  seats: WorkforceSeatRuntime[];
  queues: WorkforceQueue[];
  schedules: WorkforceSchedule[];
  nextSteps: WorkforceGuidanceStep[];
  summary: {
    seats: number;
    queues: number;
    schedules: number;
    pendingDecisions: number;
    running: number;
    blocked: number;
    recentRuns24h: number;
    autonomy: {
      autonomous: number;
      supervised: number;
      manual: number;
    };
    queuesPressured: number;
  };
};

export type WorkforceActionInput = {
  seatId: WorkforceSeatId;
  action: string;
  payload?: Record<string, unknown>;
  source?: WorkforceRunSource;
  actor?: string;
  requireWritebackReceipt?: boolean;
};

export type WorkforceActionResult = {
  policy: WorkforcePolicyDecision;
  run: WorkforceRunEnvelope;
  decision?: WorkforceDecisionCard;
  receipt: WorkforceReceipt;
  nextSteps: WorkforceGuidanceStep[];
};
