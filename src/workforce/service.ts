import { createHash, randomUUID } from "node:crypto";
import { AUTONOMY_MODES, WORKFORCE_ROSTER, type WorkforceSeatId } from "./roster.js";
import { loadWorkforceStore, resolveWorkforceStorePath, updateWorkforceStore } from "./store.js";
import {
  type WorkforceActionInput,
  type WorkforceActionResult,
  type WorkforceDecisionCard,
  type WorkforceGuidanceStep,
  type WorkforcePolicyDecision,
  type WorkforceReceipt,
  type WorkforceReplayFrame,
  type WorkforceRunEnvelope,
  type WorkforceRunSource,
  type WorkforceSchedule,
  type WorkforceStatus,
  type WorkforceStoreFile,
} from "./types.js";

const MAX_STORED_RUNS = 5000;
const MAX_STORED_RECEIPTS = 10000;
const MAX_STORED_REPLAYFRAMES = 20000;
const MAX_STORED_DECISIONS = 5000;

const DAY_MS = 86_400_000;

type EnsureOptions = {
  storePath?: string;
  force?: boolean;
};

type WorkforceListOpts = {
  storePath?: string;
  limit?: number;
};

type WorkforceRunListOpts = WorkforceListOpts & {
  query?: string;
  status?: WorkforceRunEnvelope["status"];
};

type ExecuteActionOpts = {
  storePath?: string;
  input: WorkforceActionInput;
};

type ResolveDecisionOpts = {
  storePath?: string;
  decisionId: string;
  resolution: "allow" | "deny";
  actor?: string;
};

type ReplayRunOpts = {
  storePath?: string;
  runId: string;
  actor?: string;
};

type RecordWritebackOpts = {
  storePath?: string;
  actor?: string;
  note?: string;
  artifact?: string;
};

function nowMs() {
  return Date.now();
}

function clampListLimit(limit: number | undefined, fallback = 100, max = 1000): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function normalizeSeatId(value: unknown): WorkforceSeatId | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const exists = WORKFORCE_ROSTER.some((seat) => seat.id === trimmed);
  return exists ? (trimmed as WorkforceSeatId) : null;
}

function defaultIntervalMsForSeat(seatId: WorkforceSeatId) {
  const seat = WORKFORCE_ROSTER.find((entry) => entry.id === seatId);
  if (!seat) {
    return DAY_MS;
  }
  if (seat.autonomyMode === "autonomous") {
    return 60 * 60 * 1000;
  }
  if (seat.autonomyMode === "supervised") {
    return 4 * 60 * 60 * 1000;
  }
  return 8 * 60 * 60 * 1000;
}

function deriveRiskLevel(action: string): "low" | "medium" | "high" {
  const normalized = action.trim().toLowerCase();
  if (
    normalized.includes("deploy") ||
    normalized.includes("broadcast") ||
    normalized.includes("security.block") ||
    normalized.includes("incident")
  ) {
    return "high";
  }
  if (
    normalized.includes("review") ||
    normalized.includes("approve") ||
    normalized.includes("retro") ||
    normalized.includes("standup")
  ) {
    return "medium";
  }
  return "low";
}

function findQueue(store: WorkforceStoreFile, seatId: WorkforceSeatId) {
  return store.queues.find((entry) => entry.id === `queue:${seatId}`);
}

function decrementQueuePending(queue: WorkforceStoreFile["queues"][number] | undefined) {
  if (!queue) {
    return;
  }
  if (queue.pending > 0) {
    queue.pending -= 1;
  }
}

function createReceiptSignature(receipt: Omit<WorkforceReceipt, "signature">): string {
  const base = `${receipt.receiptId}|${receipt.runId ?? ""}|${receipt.decisionId ?? ""}|${receipt.actor}|${receipt.action}|${receipt.outcome}|${receipt.ts}|${receipt.artifacts.join(",")}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

function createDefaultStore(ts = nowMs()): WorkforceStoreFile {
  const seats = WORKFORCE_ROSTER.map((seat) => ({
    id: seat.id,
    label: seat.label,
    autonomyMode: seat.autonomyMode,
    queueId: `queue:${seat.id}`,
    status: "idle" as const,
    owner: "workforce",
  }));
  const queues = WORKFORCE_ROSTER.map((seat) => ({
    id: `queue:${seat.id}`,
    seatId: seat.id,
    name: `${seat.label} Queue`,
    priority: seat.autonomyMode === "autonomous" ? ("high" as const) : ("normal" as const),
    concurrency: seat.autonomyMode === "autonomous" ? 2 : 1,
    backpressurePolicy: "block" as const,
    slaMinutes: seat.autonomyMode === "manual" ? 240 : 60,
    pending: 0,
  }));
  const schedules: WorkforceSchedule[] = WORKFORCE_ROSTER.map((seat) => {
    const intervalMs = defaultIntervalMsForSeat(seat.id);
    return {
      id: `schedule:${seat.id}:patrol`,
      seatId: seat.id,
      name: `${seat.label} Patrol`,
      triggerType: "cron",
      spec: `every:${intervalMs}`,
      enabled: true,
      intervalMs,
      maxConcurrentRuns: 1,
      nextRunAtMs: ts + intervalMs,
      action: `patrol:${seat.id}`,
    };
  });
  return {
    version: 1,
    initializedAtMs: ts,
    updatedAtMs: ts,
    seats,
    queues,
    schedules,
    decisions: [],
    receipts: [],
    replayframes: [],
    runs: [],
    workspace: {
      appfolioWritebackEnforced: true,
      defaultChannel: "appfolio",
      commsRules: [
        "Tenant/vendor/owner communications require writeback receipts.",
        "Manual seats must be approved through decision cards.",
      ],
    },
    seqByRunId: {},
  };
}

function sanitizeStore(input: WorkforceStoreFile | null, ts = nowMs()): WorkforceStoreFile {
  if (!input || input.version !== 1) {
    return createDefaultStore(ts);
  }
  const seats = Array.isArray(input.seats) ? input.seats : [];
  const queues = Array.isArray(input.queues) ? input.queues : [];
  const schedules = Array.isArray(input.schedules) ? input.schedules : [];
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const replayframes = Array.isArray(input.replayframes) ? input.replayframes : [];
  const runs = Array.isArray(input.runs) ? input.runs : [];
  return {
    ...input,
    updatedAtMs: typeof input.updatedAtMs === "number" ? input.updatedAtMs : ts,
    seats,
    queues,
    schedules,
    decisions,
    receipts,
    replayframes,
    runs,
    workspace: input.workspace ?? createDefaultStore(ts).workspace,
    seqByRunId: input.seqByRunId && typeof input.seqByRunId === "object" ? input.seqByRunId : {},
  };
}

function trimStore(store: WorkforceStoreFile) {
  if (store.runs.length > MAX_STORED_RUNS) {
    store.runs = store.runs.slice(-MAX_STORED_RUNS);
  }
  if (store.receipts.length > MAX_STORED_RECEIPTS) {
    store.receipts = store.receipts.slice(-MAX_STORED_RECEIPTS);
  }
  if (store.replayframes.length > MAX_STORED_REPLAYFRAMES) {
    store.replayframes = store.replayframes.slice(-MAX_STORED_REPLAYFRAMES);
  }
  if (store.decisions.length > MAX_STORED_DECISIONS) {
    store.decisions = store.decisions.slice(-MAX_STORED_DECISIONS);
  }
}

function appendReplay(
  store: WorkforceStoreFile,
  params: {
    runId: string;
    source: WorkforceRunSource;
    eventType: string;
    stateDelta?: string;
    payloadRef?: string;
    ts: number;
  },
): WorkforceReplayFrame {
  const prev = store.seqByRunId[params.runId] ?? 0;
  const nextSeq = prev + 1;
  store.seqByRunId[params.runId] = nextSeq;
  const frame: WorkforceReplayFrame = {
    frameId: randomUUID(),
    runId: params.runId,
    seq: nextSeq,
    eventType: params.eventType,
    payloadRef: params.payloadRef,
    stateDelta: params.stateDelta,
    ts: params.ts,
    source: params.source,
  };
  store.replayframes.push(frame);
  return frame;
}

function appendReceipt(
  store: WorkforceStoreFile,
  params: Omit<WorkforceReceipt, "signature">,
): WorkforceReceipt {
  const signature = createReceiptSignature(params);
  const receipt: WorkforceReceipt = { ...params, signature };
  store.receipts.push(receipt);
  return receipt;
}

function createDecisionCard(
  store: WorkforceStoreFile,
  params: {
    runId: string;
    seatId: WorkforceSeatId;
    title: string;
    summary: string;
    riskLevel: "low" | "medium" | "high";
    createdAtMs: number;
  },
): WorkforceDecisionCard {
  const decision: WorkforceDecisionCard = {
    decisionId: randomUUID(),
    runId: params.runId,
    seatId: params.seatId,
    title: params.title,
    summary: params.summary,
    options: [
      { id: "allow", label: "Allow", decision: "allow" },
      { id: "deny", label: "Deny", decision: "deny" },
    ],
    recommended: "allow",
    riskLevel: params.riskLevel,
    requiresApproval: true,
    status: "pending",
    createdAtMs: params.createdAtMs,
    expiresAtMs: params.createdAtMs + 24 * 60 * 60 * 1000,
  };
  store.decisions.push(decision);
  return decision;
}

function evaluatePolicy(input: {
  seatId: WorkforceSeatId;
  action: string;
  requireWritebackReceipt: boolean;
  payload?: Record<string, unknown>;
  store: WorkforceStoreFile;
}): { decision: WorkforcePolicyDecision; reason: string } {
  const seat = WORKFORCE_ROSTER.find((entry) => entry.id === input.seatId);
  if (!seat) {
    return { decision: "block", reason: `unknown seat: ${input.seatId}` };
  }
  if (
    input.requireWritebackReceipt &&
    input.store.workspace.appfolioWritebackEnforced &&
    seat.systemsAccess.includes("queue-service")
  ) {
    const rawReceiptId = input.payload?.writebackReceiptId;
    const maybeReceiptId = typeof rawReceiptId === "string" ? rawReceiptId.trim() : "";
    const hasReceipt = input.store.receipts.some((receipt) => receipt.receiptId === maybeReceiptId);
    if (!hasReceipt) {
      return {
        decision: "block",
        reason: "appfolio_writeback_receipt_required",
      };
    }
  }
  const queue = findQueue(input.store, input.seatId);
  if (queue && queue.backpressurePolicy === "block" && queue.pending >= queue.concurrency * 4) {
    return { decision: "block", reason: "queue_backpressure_block" };
  }
  const action = input.action.trim().toLowerCase();
  if (action.startsWith("appfolio.") && !input.requireWritebackReceipt) {
    return { decision: "block", reason: "appfolio_action_requires_writeback_gate" };
  }
  if (action.includes("deploy.prod")) {
    return { decision: "escalate", reason: "prod_deploy_requires_approval" };
  }
  if (!AUTONOMY_MODES.includes(seat.autonomyMode)) {
    return { decision: "block", reason: "invalid_autonomy_mode" };
  }
  if (seat.autonomyMode === "autonomous") {
    return { decision: "allow", reason: "autonomy_allow" };
  }
  if (seat.autonomyMode === "supervised") {
    return { decision: "escalate", reason: "autonomy_supervised" };
  }
  return { decision: "escalate", reason: "autonomy_manual" };
}

function executeActionInStore(
  store: WorkforceStoreFile,
  input: WorkforceActionInput,
  ts = nowMs(),
): WorkforceActionResult {
  const seatId = input.seatId;
  const source = input.source ?? "workforce";
  const actor = (input.actor ?? "workforce").trim() || "workforce";
  const action = input.action.trim();
  const payload = input.payload;
  const riskLevel = deriveRiskLevel(action);
  const policyEval = evaluatePolicy({
    seatId,
    action,
    payload,
    store,
    requireWritebackReceipt: Boolean(input.requireWritebackReceipt),
  });
  const queue = findQueue(store, seatId);
  const run: WorkforceRunEnvelope = {
    runId: randomUUID(),
    source,
    seatId,
    action,
    status:
      policyEval.decision === "allow"
        ? "ok"
        : policyEval.decision === "block"
          ? "blocked"
          : "escalated",
    startedAtMs: ts,
    endedAtMs: ts,
    summary: policyEval.reason,
    artifacts: [`seat:${seatId}`, `risk:${riskLevel}`],
  };
  store.runs.push(run);
  const seat = store.seats.find((entry) => entry.id === seatId);
  if (seat) {
    seat.lastRunAtMs = ts;
    seat.status = run.status === "ok" ? "idle" : "blocked";
  }

  appendReplay(store, {
    runId: run.runId,
    source,
    eventType: "run.created",
    stateDelta: `status=${run.status}`,
    payloadRef: action,
    ts,
  });

  let decisionCard: WorkforceDecisionCard | undefined;
  if (policyEval.decision === "escalate") {
    decisionCard = createDecisionCard(store, {
      runId: run.runId,
      seatId,
      title: `Approval required: ${action}`,
      summary: `Seat ${seatId} requires approval (${policyEval.reason}).`,
      riskLevel,
      createdAtMs: ts,
    });
    run.artifacts.push(`decision:${decisionCard.decisionId}`);
    appendReplay(store, {
      runId: run.runId,
      source,
      eventType: "decision.created",
      stateDelta: `decisionId=${decisionCard.decisionId}`,
      ts,
    });
    if (queue) {
      queue.pending += 1;
    }
  }

  const receipt = appendReceipt(store, {
    receiptId: randomUUID(),
    runId: run.runId,
    decisionId: decisionCard?.decisionId,
    actor,
    action,
    outcome: policyEval.decision,
    ts,
    artifacts: [],
  });

  if (policyEval.decision === "allow") {
    appendReplay(store, {
      runId: run.runId,
      source,
      eventType: "run.running",
      stateDelta: "status=running",
      ts,
    });
    appendReplay(store, {
      runId: run.runId,
      source,
      eventType: "run.completed",
      stateDelta: "status=ok",
      ts,
    });
  }

  if (policyEval.decision === "block") {
    appendReplay(store, {
      runId: run.runId,
      source,
      eventType: "run.blocked",
      stateDelta: `reason=${policyEval.reason}`,
      ts,
    });
  }

  if (policyEval.decision !== "escalate") {
    decrementQueuePending(queue);
  }

  return {
    policy: policyEval.decision,
    run,
    decision: decisionCard,
    receipt,
    nextSteps: collectNextSteps(store),
  };
}

function collectNextSteps(store: WorkforceStoreFile): WorkforceGuidanceStep[] {
  const steps: WorkforceGuidanceStep[] = [];
  const pendingDecision = store.decisions.find((entry) => entry.status === "pending");
  if (pendingDecision) {
    steps.push({
      id: "review-pending-decision",
      title: "Resolve pending decision card",
      detail: `${pendingDecision.title} (${pendingDecision.seatId})`,
      priority: "high",
      seatId: pendingDecision.seatId,
      action: "decision.resolve",
    });
  }

  const blockedRun = unresolvedBlockedRuns(store).toReversed()[0];
  if (blockedRun) {
    const needsWriteback = blockedRun.summary === "appfolio_writeback_receipt_required";
    steps.push({
      id: "clear-blocked-run",
      title: needsWriteback ? "Record writeback receipt" : "Replay blocked run",
      detail: needsWriteback
        ? "AppFolio actions require a writeback receipt before execution."
        : `${blockedRun.action} (${blockedRun.seatId}) is blocked and should be replayed or denied.`,
      priority: "high",
      seatId: blockedRun.seatId,
      action: blockedRun.action,
      requireWritebackReceipt: needsWriteback,
    });
  }

  const pressuredQueue = store.queues.find((queue) => queue.pending >= queue.concurrency * 2);
  if (pressuredQueue) {
    steps.push({
      id: "drain-pressure-queue",
      title: "Drain pressured queue",
      detail: `${pressuredQueue.name} has ${pressuredQueue.pending} pending items.`,
      priority: "medium",
      seatId: pressuredQueue.seatId,
      action: `queue.drain:${pressuredQueue.seatId}`,
    });
  }

  const now = nowMs();
  const dueSchedule = store.schedules.find(
    (schedule) =>
      schedule.enabled &&
      typeof schedule.nextRunAtMs === "number" &&
      schedule.nextRunAtMs <= now + 5 * 60 * 1000,
  );
  if (dueSchedule) {
    steps.push({
      id: "run-scheduler-tick",
      title: "Run scheduler tick",
      detail: `${dueSchedule.name} is due soon.`,
      priority: "medium",
      seatId: dueSchedule.seatId,
      action: dueSchedule.action,
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: "run-daily-standup",
      title: "Start workforce standup",
      detail: "No blockers detected. Keep momentum with a standup pass.",
      priority: "low",
      seatId: "ops-lead",
      action: "standup:start",
    });
  }
  return steps.slice(0, 6);
}

function unresolvedBlockedRuns(store: WorkforceStoreFile): WorkforceRunEnvelope[] {
  const latestOkByAction = new Map<string, number>();
  for (const run of store.runs) {
    if (run.status !== "ok") {
      continue;
    }
    const key = `${run.seatId}:${run.action}`;
    const prev = latestOkByAction.get(key) ?? 0;
    if (run.startedAtMs > prev) {
      latestOkByAction.set(key, run.startedAtMs);
    }
  }
  return store.runs.filter((run) => {
    if (run.status !== "blocked") {
      return false;
    }
    const key = `${run.seatId}:${run.action}`;
    const latestOkAt = latestOkByAction.get(key);
    return typeof latestOkAt !== "number" || latestOkAt <= run.startedAtMs;
  });
}

function buildStatus(store: WorkforceStoreFile): WorkforceStatus {
  const now = nowMs();
  const pendingDecisions = store.decisions.filter((entry) => entry.status === "pending").length;
  const running = store.runs.filter((entry) => entry.status === "running").length;
  const blocked = unresolvedBlockedRuns(store).length;
  const recentRuns24h = store.runs.filter((entry) => now - entry.startedAtMs <= DAY_MS).length;
  const autonomous = store.seats.filter((seat) => seat.autonomyMode === "autonomous").length;
  const supervised = store.seats.filter((seat) => seat.autonomyMode === "supervised").length;
  const manual = store.seats.filter((seat) => seat.autonomyMode === "manual").length;
  const queuesPressured = store.queues.filter(
    (queue) => queue.pending >= Math.max(1, queue.concurrency * 2),
  ).length;
  const readiness = blocked > 0 ? "degraded" : "ready";
  return {
    updatedAtMs: store.updatedAtMs,
    readiness,
    seats: store.seats,
    queues: store.queues,
    schedules: store.schedules,
    nextSteps: collectNextSteps(store),
    summary: {
      seats: store.seats.length,
      queues: store.queues.length,
      schedules: store.schedules.length,
      pendingDecisions,
      running,
      blocked,
      recentRuns24h,
      autonomy: {
        autonomous,
        supervised,
        manual,
      },
      queuesPressured,
    },
  };
}

async function ensureStore(options: EnsureOptions = {}): Promise<WorkforceStoreFile> {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const needsInit = options.force || !current;
    const next = needsInit ? createDefaultStore(ts) : sanitizeStore(current, ts);
    next.updatedAtMs = ts;
    return { store: next, result: next };
  });
}

export async function initializeWorkforceStore(options: EnsureOptions = {}) {
  const store = await ensureStore(options);
  return {
    ok: true as const,
    path: resolveWorkforceStorePath(options.storePath),
    status: buildStatus(store),
  };
}

export async function getWorkforceStatus(options: { storePath?: string } = {}) {
  const store = await ensureStore({ storePath: options.storePath });
  return buildStatus(store);
}

export async function listWorkforceRuns(options: WorkforceRunListOpts = {}) {
  const store = await ensureStore({ storePath: options.storePath });
  const limit = clampListLimit(options.limit, 100, 2000);
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const filtered = store.runs.filter((run) => {
    if (options.status && run.status !== options.status) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      run.runId.toLowerCase().includes(query) ||
      run.seatId.toLowerCase().includes(query) ||
      run.action.toLowerCase().includes(query) ||
      run.status.toLowerCase().includes(query)
    );
  });
  return {
    updatedAtMs: store.updatedAtMs,
    runs: filtered.slice(-limit).toReversed(),
  };
}

export async function listWorkforceLedger(options: WorkforceListOpts = {}) {
  const store = await ensureStore({ storePath: options.storePath });
  const limit = clampListLimit(options.limit, 200, 5000);
  return {
    updatedAtMs: store.updatedAtMs,
    receipts: store.receipts.slice(-limit).toReversed(),
    replayframes: store.replayframes.slice(-limit).toReversed(),
    decisions: store.decisions.slice(-limit).toReversed(),
  };
}

export async function listWorkforceDecisions(
  options: WorkforceListOpts & { status?: "pending" | "resolved" } = {},
) {
  const store = await ensureStore({ storePath: options.storePath });
  const limit = clampListLimit(options.limit, 100, 2000);
  const decisions = store.decisions.filter((entry) =>
    options.status ? entry.status === options.status : true,
  );
  return {
    updatedAtMs: store.updatedAtMs,
    decisions: decisions.slice(-limit).toReversed(),
  };
}

export async function listWorkforceSchedules(options: WorkforceListOpts = {}) {
  const store = await ensureStore({ storePath: options.storePath });
  const limit = clampListLimit(options.limit, 200, 5000);
  return {
    updatedAtMs: store.updatedAtMs,
    schedules: store.schedules.slice(-limit).toReversed(),
  };
}

export async function getWorkforceWorkspace(options: { storePath?: string } = {}) {
  const store = await ensureStore({ storePath: options.storePath });
  return {
    updatedAtMs: store.updatedAtMs,
    workspace: store.workspace,
  };
}

export async function executeWorkforceAction(options: ExecuteActionOpts) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const seatId = normalizeSeatId(options.input.seatId);
    if (!seatId) {
      throw new Error(`Unknown seat id: ${String(options.input.seatId)}`);
    }
    if (!options.input.action.trim()) {
      throw new Error("Action is required");
    }
    const result = executeActionInStore(store, { ...options.input, seatId }, ts);
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result };
  });
}

export async function resolveWorkforceDecision(options: ResolveDecisionOpts) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const decision = store.decisions.find((entry) => entry.decisionId === options.decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${options.decisionId}`);
    }
    if (decision.status !== "pending") {
      return { store, result: decision };
    }
    decision.status = "resolved";
    decision.resolution = options.resolution;
    decision.resolvedBy = options.actor ?? "operator";
    decision.resolvedAtMs = ts;

    const run = decision.runId
      ? store.runs.find((entry) => entry.runId === decision.runId)
      : undefined;
    const queue = findQueue(store, decision.seatId);
    if (run) {
      run.status = options.resolution === "allow" ? "ok" : "blocked";
      run.endedAtMs = ts;
      run.summary = `decision:${options.resolution}`;
      appendReplay(store, {
        runId: run.runId,
        source: run.source,
        eventType: "decision.resolved",
        stateDelta: `resolution=${options.resolution}`,
        ts,
      });
    }
    const seat = store.seats.find((entry) => entry.id === decision.seatId);
    if (seat) {
      seat.status = options.resolution === "allow" ? "idle" : "blocked";
      seat.lastRunAtMs = ts;
    }

    appendReceipt(store, {
      receiptId: randomUUID(),
      runId: decision.runId,
      decisionId: decision.decisionId,
      actor: decision.resolvedBy ?? "operator",
      action: "decision.resolve",
      outcome: options.resolution,
      ts,
      artifacts: [],
    });

    decrementQueuePending(queue);
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result: decision };
  });
}

export async function replayWorkforceRun(options: ReplayRunOpts) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const sourceRun = store.runs.find((entry) => entry.runId === options.runId);
    if (!sourceRun) {
      throw new Error(`Run not found: ${options.runId}`);
    }
    const result = executeActionInStore(
      store,
      {
        seatId: sourceRun.seatId,
        action: sourceRun.action,
        source: "workforce",
        actor: options.actor ?? "replay",
      },
      ts,
    );
    appendReplay(store, {
      runId: result.run.runId,
      source: result.run.source,
      eventType: "run.replayed",
      stateDelta: `from=${options.runId}`,
      payloadRef: options.runId,
      ts,
    });
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result };
  });
}

export async function recordAppfolioWritebackReceipt(options: RecordWritebackOpts = {}) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const receipt = appendReceipt(store, {
      receiptId: randomUUID(),
      actor: options.actor ?? "workspace",
      action: "appfolio.writeback",
      outcome: options.note?.trim() || "recorded",
      ts,
      artifacts: options.artifact ? [options.artifact] : [],
    });
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result: receipt };
  });
}

export async function addWorkforceSchedule(options: {
  storePath?: string;
  seatId: WorkforceSeatId;
  name: string;
  intervalMs: number;
  action: string;
}) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const seatId = normalizeSeatId(options.seatId);
    if (!seatId) {
      throw new Error(`Unknown seat id: ${options.seatId}`);
    }
    const intervalMs = Math.max(60_000, Math.floor(options.intervalMs));
    const schedule: WorkforceSchedule = {
      id: randomUUID(),
      seatId,
      name: options.name.trim() || `Schedule ${seatId}`,
      triggerType: "cron",
      spec: `every:${intervalMs}`,
      enabled: true,
      intervalMs,
      maxConcurrentRuns: 1,
      nextRunAtMs: ts + intervalMs,
      action: options.action.trim() || `scheduled:${seatId}`,
    };
    store.schedules.push(schedule);
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result: schedule };
  });
}

export async function tickWorkforceSchedules(options: { storePath?: string; actor?: string } = {}) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  return await updateWorkforceStore(storePath, async (current) => {
    const ts = nowMs();
    const store = sanitizeStore(current, ts);
    const triggered: WorkforceActionResult[] = [];
    for (const schedule of store.schedules) {
      if (!schedule.enabled || !schedule.intervalMs) {
        continue;
      }
      if (!schedule.nextRunAtMs || schedule.nextRunAtMs > ts) {
        continue;
      }
      const seatId = normalizeSeatId(schedule.seatId);
      if (!seatId) {
        continue;
      }
      const queue = findQueue(store, seatId);
      if (queue && queue.pending >= Math.max(1, schedule.maxConcurrentRuns)) {
        schedule.nextRunAtMs = ts + schedule.intervalMs;
        continue;
      }
      const actionResult = executeActionInStore(
        store,
        {
          seatId,
          action: schedule.action,
          source: "cron",
          actor: options.actor ?? "scheduler",
        },
        ts,
      );
      triggered.push(actionResult);
      schedule.lastRunAtMs = ts;
      schedule.nextRunAtMs = ts + schedule.intervalMs;
    }
    store.updatedAtMs = ts;
    trimStore(store);
    return { store, result: { triggered } };
  });
}

export async function workforceStoreExists(options: { storePath?: string } = {}) {
  const storePath = resolveWorkforceStorePath(options.storePath);
  const { exists } = await loadWorkforceStore(storePath);
  return exists;
}
