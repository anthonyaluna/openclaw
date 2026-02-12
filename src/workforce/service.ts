import { createHash, randomUUID } from "node:crypto";
import { runAppfolioReport, runAppfolioReportNextPage } from "../infra/appfolio-reports.js";
import {
  buildWorkforceAppfolioReportPayload,
  getWorkforceAppfolioReportPreset,
  getWorkforceAppfolioWorkflow,
  normalizeWorkforceAppfolioPaginationOptions,
  parseWorkforceAppfolioReportPresetId,
  parseWorkforceAppfolioWorkflowId,
  validateWorkforceAppfolioReportPayload,
} from "./appfolio-reports.js";
import { AUTONOMY_MODES, WORKFORCE_ROSTER, type WorkforceSeatId } from "./roster.js";
import { loadWorkforceStore, resolveWorkforceStorePath, updateWorkforceStore } from "./store.js";
import {
  type WorkforceActionInput,
  type WorkforceActionResult,
  type WorkforceAppfolioReportJobResult,
  type WorkforceDecisionCard,
  type WorkforceGuidanceStep,
  type WorkforcePolicyDecision,
  type WorkforcePolicyProfileId,
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
const POLICY_PROFILE_IDS = new Set<WorkforcePolicyProfileId>([
  "balanced",
  "strict-change-control",
  "autonomous-ops",
]);

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

function isPolicyProfileId(value: unknown): value is WorkforcePolicyProfileId {
  return typeof value === "string" && POLICY_PROFILE_IDS.has(value as WorkforcePolicyProfileId);
}

function normalizePolicyDecisionFromRun(
  status: WorkforceRunEnvelope["status"],
): WorkforcePolicyDecision {
  if (status === "blocked") {
    return "block";
  }
  if (status === "escalated") {
    return "escalate";
  }
  return "allow";
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
      // Keep patrol schedules visible but disabled by default; we only want to run
      // explicit operator-installed schedules (AppFolio reports/workflows, etc.).
      enabled: false,
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
      policyProfile: "balanced",
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
  const runs = (Array.isArray(input.runs) ? input.runs : []).map((run) => {
    const riskLevel =
      run.riskLevel === "low" || run.riskLevel === "medium" || run.riskLevel === "high"
        ? run.riskLevel
        : deriveRiskLevel(String(run.action ?? ""));
    const policyProfile = isPolicyProfileId(run.policyProfile) ? run.policyProfile : "balanced";
    const policyDecision =
      run.policyDecision === "allow" ||
      run.policyDecision === "block" ||
      run.policyDecision === "escalate"
        ? run.policyDecision
        : normalizePolicyDecisionFromRun(run.status ?? "ok");
    return {
      ...run,
      riskLevel,
      policyProfile,
      policyDecision,
    };
  });
  const workspace = input.workspace ?? createDefaultStore(ts).workspace;
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
    workspace: {
      ...workspace,
      policyProfile: isPolicyProfileId(workspace.policyProfile)
        ? workspace.policyProfile
        : "balanced",
    },
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

function resolvePolicyProfile(
  action: string,
  payload: Record<string, unknown> | undefined,
  workspaceProfile: WorkforcePolicyProfileId,
): WorkforcePolicyProfileId {
  if (isPolicyProfileId(payload?.policyProfileId)) {
    return payload.policyProfileId;
  }
  const normalized = action.trim().toLowerCase();
  if (
    normalized.startsWith("deploy.") ||
    normalized.includes("incident") ||
    normalized.startsWith("security.")
  ) {
    return "strict-change-control";
  }
  if (
    normalized.startsWith("queue.") ||
    normalized.startsWith("scheduler.") ||
    normalized.startsWith("patrol:")
  ) {
    return "autonomous-ops";
  }
  return workspaceProfile;
}

function evaluatePolicy(input: {
  seatId: WorkforceSeatId;
  action: string;
  requireWritebackReceipt: boolean;
  payload?: Record<string, unknown>;
  store: WorkforceStoreFile;
}): { decision: WorkforcePolicyDecision; reason: string; profile: WorkforcePolicyProfileId } {
  const seat = WORKFORCE_ROSTER.find((entry) => entry.id === input.seatId);
  const action = input.action.trim().toLowerCase();
  const profile = resolvePolicyProfile(action, input.payload, input.store.workspace.policyProfile);
  const riskLevel = deriveRiskLevel(action);
  if (!seat) {
    return { decision: "block", reason: `unknown seat: ${input.seatId}`, profile };
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
        profile,
      };
    }
  }
  const queue = findQueue(input.store, input.seatId);
  if (queue && queue.backpressurePolicy === "block" && queue.pending >= queue.concurrency * 4) {
    return { decision: "block", reason: "queue_backpressure_block", profile };
  }
  if (action.startsWith("appfolio.comms.") && !input.requireWritebackReceipt) {
    return {
      decision: "block",
      reason: "appfolio_action_requires_writeback_gate",
      profile,
    };
  }

  if (profile === "strict-change-control") {
    if (riskLevel === "high") {
      return { decision: "escalate", reason: "strict_profile_high_risk", profile };
    }
    if (seat.autonomyMode === "autonomous" && riskLevel !== "low") {
      return { decision: "escalate", reason: "strict_profile_autonomous_guard", profile };
    }
  }

  if (profile === "autonomous-ops") {
    const isOpsAction =
      action.startsWith("queue.") ||
      action.startsWith("scheduler.") ||
      action.startsWith("patrol:");
    if (isOpsAction && seat.autonomyMode === "supervised" && riskLevel !== "high") {
      return { decision: "allow", reason: "autonomous_ops_supervised_allow", profile };
    }
  }

  if (action.includes("deploy.prod")) {
    return { decision: "escalate", reason: "prod_deploy_requires_approval", profile };
  }
  if (!AUTONOMY_MODES.includes(seat.autonomyMode)) {
    return { decision: "block", reason: "invalid_autonomy_mode", profile };
  }
  if (seat.autonomyMode === "autonomous") {
    return { decision: "allow", reason: "autonomy_allow", profile };
  }
  if (seat.autonomyMode === "supervised") {
    return { decision: "escalate", reason: "autonomy_supervised", profile };
  }
  return { decision: "escalate", reason: "autonomy_manual", profile };
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
    riskLevel,
    policyProfile: policyEval.profile,
    policyDecision: policyEval.decision,
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
    artifacts: [`profile:${policyEval.profile}`, `risk:${riskLevel}`],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePayload(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key];
    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergePayload(existing, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

async function maybeRunAppfolioReportJob(options: {
  store: WorkforceStoreFile;
  actionResult: WorkforceActionResult;
  action: string;
  payload?: Record<string, unknown>;
  actor: string;
  source: WorkforceRunSource;
  ts: number;
}): Promise<WorkforceAppfolioReportJobResult | null> {
  const presetId = parseWorkforceAppfolioReportPresetId(options.action);
  if (!presetId) {
    return null;
  }

  const preset = getWorkforceAppfolioReportPreset(presetId);
  const defaultPayload = buildWorkforceAppfolioReportPayload(presetId, options.ts);
  const overridePayload = isRecord(options.payload?.reportFilters)
    ? options.payload.reportFilters
    : null;
  const requestPayload = overridePayload
    ? mergePayload(defaultPayload, overridePayload)
    : defaultPayload;
  const pagination = normalizeWorkforceAppfolioPaginationOptions(options.payload?.pagination);
  const validation = validateWorkforceAppfolioReportPayload(presetId, requestPayload);

  if (options.actionResult.policy !== "allow") {
    const blockedResult: WorkforceAppfolioReportJobResult = {
      presetId,
      reportName: preset.reportName,
      ok: false,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      error: "appfolio_report_policy_not_allow",
    };
    options.actionResult.appfolioReport = blockedResult;
    options.actionResult.run.artifacts.push(`appfolio_report:${presetId}`);
    return blockedResult;
  }

  if (!validation.ok) {
    const invalidResult: WorkforceAppfolioReportJobResult = {
      presetId,
      reportName: preset.reportName,
      ok: false,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      warnings: [...validation.warnings],
      error: "appfolio_report_validation_failed",
    };
    options.actionResult.appfolioReport = invalidResult;
    options.actionResult.run.status = "error";
    options.actionResult.run.summary = `appfolio_report_validation_failed:${presetId}`;
    options.actionResult.run.error = "appfolio_report_validation_failed";
    appendReplay(options.store, {
      runId: options.actionResult.run.runId,
      source: options.source,
      eventType: "appfolio.report.failed",
      stateDelta: `preset=${presetId};error=validation`,
      payloadRef: preset.reportName,
      ts: options.ts,
    });
    appendReceipt(options.store, {
      receiptId: randomUUID(),
      runId: options.actionResult.run.runId,
      actor: options.actor,
      action: `appfolio.report.run:${presetId}`,
      outcome: "error",
      ts: options.ts,
      artifacts: [`report:${preset.reportName}`, `preset:${presetId}`, "validation:failed"],
    });
    options.actionResult.run.artifacts.push(`appfolio_report:${presetId}`);
    options.actionResult.run.artifacts.push(`appfolio_report_name:${preset.reportName}`);
    options.actionResult.run.artifacts.push(`appfolio_validation_errors:${validation.errors.length}`);
    return invalidResult;
  }

  const report = await runAppfolioReport({
    reportName: preset.reportName,
    body: requestPayload,
  });

  let pagesFetched = report.ok ? 1 : 0;
  let nextPageUrl = report.nextPageUrl ?? null;
  let knownRows = typeof report.count === "number" ? report.count : 0;
  let hasUnknownCount = typeof report.count !== "number";
  let truncated = false;
  const warnings: string[] = [...validation.warnings];

  if (report.ok && pagination.autoPaginate) {
    while (nextPageUrl) {
      if (pagesFetched >= pagination.maxPages) {
        warnings.push("pagination_max_pages_reached");
        truncated = true;
        break;
      }
      if (!hasUnknownCount && knownRows >= pagination.maxRows) {
        warnings.push("pagination_max_rows_reached");
        truncated = true;
        break;
      }
      const page = await runAppfolioReportNextPage({ nextPageUrl });
      if (!page.ok) {
        warnings.push(`pagination_next_page_failed:${page.error ?? "unknown"}`);
        truncated = true;
        break;
      }
      pagesFetched += 1;
      if (typeof page.count === "number") {
        knownRows += page.count;
      } else {
        hasUnknownCount = true;
      }
      nextPageUrl = page.nextPageUrl ?? null;
    }
    if (nextPageUrl) {
      truncated = true;
    }
  } else if (report.ok && nextPageUrl) {
    warnings.push("pagination_available_next_page");
  }

  const reportResult: WorkforceAppfolioReportJobResult = {
    presetId,
    reportName: preset.reportName,
    ok: report.ok,
    status: report.status,
    count: report.ok ? (hasUnknownCount ? null : knownRows) : report.count,
    pagesFetched,
    endpoint: report.endpoint,
    nextPageUrl,
    truncated,
    warnings: warnings.length > 0 ? warnings : undefined,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    error: report.error,
  };
  options.actionResult.appfolioReport = reportResult;

  options.actionResult.run.artifacts.push(`appfolio_report:${presetId}`);
  options.actionResult.run.artifacts.push(`appfolio_report_name:${preset.reportName}`);
  if (report.endpoint) {
    options.actionResult.run.artifacts.push(`appfolio_endpoint:${report.endpoint}`);
  }
  if (nextPageUrl) {
    options.actionResult.run.artifacts.push(`appfolio_next_page:${nextPageUrl}`);
  }
  if (truncated) {
    options.actionResult.run.artifacts.push("appfolio_pagination:truncated");
  }
  options.actionResult.run.artifacts.push(`appfolio_pages_fetched:${pagesFetched}`);

  if (report.ok) {
    options.actionResult.run.summary = `appfolio_report:${presetId}:rows=${reportResult.count ?? 0}:pages=${pagesFetched}`;
    appendReplay(options.store, {
      runId: options.actionResult.run.runId,
      source: options.source,
      eventType: "appfolio.report.completed",
      stateDelta: `preset=${presetId};rows=${reportResult.count ?? 0};pages=${pagesFetched}`,
      payloadRef: preset.reportName,
      ts: options.ts,
    });
  } else {
    options.actionResult.run.status = "error";
    options.actionResult.run.summary = report.error ?? "appfolio_report_failed";
    options.actionResult.run.error = report.error ?? "appfolio_report_failed";
    appendReplay(options.store, {
      runId: options.actionResult.run.runId,
      source: options.source,
      eventType: "appfolio.report.failed",
      stateDelta: `preset=${presetId};error=${report.error ?? "unknown"}`,
      payloadRef: preset.reportName,
      ts: options.ts,
    });
  }

  appendReceipt(options.store, {
    receiptId: randomUUID(),
    runId: options.actionResult.run.runId,
    actor: options.actor,
    action: `appfolio.report.run:${presetId}`,
    outcome: report.ok ? "ok" : "error",
    ts: options.ts,
    artifacts: [`report:${preset.reportName}`, `preset:${presetId}`],
  });

  return reportResult;
}

function normalizeRowString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function normalizeRowAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    const cleaned = raw.replaceAll(/[^0-9.\-]/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
  }
  return "";
}

function readRowField(row: unknown, keys: string[]): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      const value = record[key];
      if (value !== null && value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

type SmartBillReviewSummary = {
  rows: number;
  duplicates: number;
  missingVendor: number;
  missingProperty: number;
  missingAmount: number;
  sampleDuplicateKeys: string[];
};

function summarizeSmartBillBillDetailRows(rows: unknown[]): SmartBillReviewSummary {
  const vendorKeys = ["payee_name", "vendor_name", "vendor", "payee", "payer"];
  const propertyKeys = ["property_name", "property", "property_address", "property_id"];
  const amountKeys = ["amount", "invoice_amount", "payment_amount", "bill_amount"];
  const dateKeys = ["bill_date", "occurred_date", "occurred_on", "date", "post_date"];
  const refKeys = ["reference_number", "reference", "invoice_number", "invoice_no", "ref"];

  let missingVendor = 0;
  let missingProperty = 0;
  let missingAmount = 0;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const vendor = normalizeRowString(readRowField(row, vendorKeys));
    const property = normalizeRowString(readRowField(row, propertyKeys));
    const amount = normalizeRowAmount(readRowField(row, amountKeys));
    const date = normalizeRowString(readRowField(row, dateKeys));
    const reference = normalizeRowString(readRowField(row, refKeys));

    if (!vendor) {
      missingVendor += 1;
    }
    if (!property) {
      missingProperty += 1;
    }
    if (!amount) {
      missingAmount += 1;
    }

    // Use a conservative duplicate key: vendor + amount + date + reference.
    // If reference is missing, we still key on vendor/amount/date to surface potential dupes.
    const key = [
      vendor || "unknown_vendor",
      amount || "unknown_amount",
      date || "unknown_date",
      reference || "unknown_reference",
    ].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const dupKeys = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const duplicates = dupKeys.length;
  return {
    rows: rows.length,
    duplicates,
    missingVendor,
    missingProperty,
    missingAmount,
    sampleDuplicateKeys: dupKeys.slice(0, 5),
  };
}

async function collectAppfolioReportRows(options: {
  reportName: string;
  body: Record<string, unknown>;
  maxRows: number;
}): Promise<{
  ok: boolean;
  endpoint?: string;
  status?: number;
  error?: string;
  rows: unknown[];
  truncated: boolean;
}> {
  const maxRows = Math.max(1, Math.floor(options.maxRows));
  const first = await runAppfolioReport({
    reportName: options.reportName,
    body: options.body,
    includeRows: true,
    maxRows,
  });
  if (!first.ok) {
    return {
      ok: false,
      endpoint: first.endpoint,
      status: first.status,
      error: first.error,
      rows: [],
      truncated: false,
    };
  }

  const rows: unknown[] = [...(first.rows ?? [])];
  let next = first.nextPageUrl ?? null;
  let truncated = Boolean(first.rowsTruncated);

  while (!truncated && next && rows.length < maxRows) {
    const page = await runAppfolioReportNextPage({
      nextPageUrl: next,
      includeRows: true,
      maxRows: maxRows - rows.length,
    });
    if (!page.ok) {
      truncated = true;
      break;
    }
    rows.push(...(page.rows ?? []));
    next = page.nextPageUrl ?? null;
    if (page.rowsTruncated) {
      truncated = true;
      break;
    }
  }

  if (next) {
    truncated = true;
  }

  return {
    ok: true,
    endpoint: first.endpoint,
    status: first.status,
    rows,
    truncated,
  };
}

async function maybeRunAppfolioWorkflowJob(options: {
  store: WorkforceStoreFile;
  actionResult: WorkforceActionResult;
  action: string;
  payload?: Record<string, unknown>;
  actor: string;
  source: WorkforceRunSource;
  ts: number;
}): Promise<boolean> {
  const workflowId = parseWorkforceAppfolioWorkflowId(options.action);
  if (!workflowId) {
    return false;
  }

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const readBoolean = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
    }
    return fallback;
  };
  const readNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const clampRows = (value: unknown, fallback: number): number => {
    const parsed = readNumber(value);
    const candidate = parsed == null ? fallback : parsed;
    if (!Number.isFinite(candidate)) {
      return fallback;
    }
    const normalized = Math.floor(candidate);
    if (normalized <= 0) {
      return 1;
    }
    return Math.min(normalized, 50_000);
  };

  const payload = options.payload ?? {};
  const globalFilters = isRecord(payload.reportFilters) ? payload.reportFilters : undefined;
  const rawFiltersByPreset = isRecord(payload.filtersByPreset) ? payload.filtersByPreset : undefined;
  const filtersForPreset = (presetId: string): Record<string, unknown> | undefined => {
    if (!rawFiltersByPreset) {
      return undefined;
    }
    const candidate = rawFiltersByPreset[presetId];
    return isRecord(candidate) ? candidate : undefined;
  };
  const includeRows = readBoolean(payload.includeRows, true);
  const payloadPagination = isRecord(payload.pagination) ? payload.pagination : undefined;
  const maxRows = clampRows(
    payload.rowLimit ?? payloadPagination?.maxRows ?? payloadPagination?.rowLimit,
    5000,
  );

  const workflow = getWorkforceAppfolioWorkflow(workflowId);
  options.actionResult.run.artifacts.push(`appfolio_workflow:${workflow.id}`);

  if (options.actionResult.policy !== "allow") {
    options.actionResult.run.summary = `appfolio_workflow_policy_not_allow:${workflow.id}`;
    return true;
  }

  // Execute each preset step in the workflow (counts + endpoints), and do an opinionated
  // "Smart Bill review" summary using bill_detail rows (bounded).
  const stepResults: Array<{ presetId: string; ok: boolean; count?: number | null; status?: number }> = [];
  let smartBillSummary: SmartBillReviewSummary | null = null;

  for (const presetId of workflow.presetIds) {
    const preset = getWorkforceAppfolioReportPreset(presetId);
    const body = {
      ...buildWorkforceAppfolioReportPayload(presetId, options.ts),
      ...(globalFilters ?? {}),
      ...(filtersForPreset(presetId) ?? {}),
    };

    if (presetId === "bill_detail") {
      if (includeRows) {
        const rowsRes = await collectAppfolioReportRows({
          reportName: preset.reportName,
          body,
          maxRows,
        });
        if (rowsRes.ok) {
          smartBillSummary = summarizeSmartBillBillDetailRows(rowsRes.rows);
          options.actionResult.run.artifacts.push(
            `appfolio_bill_detail_rows:${smartBillSummary.rows}`,
          );
          options.actionResult.run.artifacts.push(
            `smart_bill_duplicates:${smartBillSummary.duplicates}`,
          );
          if (rowsRes.endpoint) {
            options.actionResult.run.artifacts.push(`appfolio_endpoint:${rowsRes.endpoint}`);
          }
          if (rowsRes.truncated) {
            options.actionResult.run.artifacts.push("appfolio_rows:truncated");
          }
          stepResults.push({
            presetId,
            ok: true,
            count: smartBillSummary.rows,
            status: rowsRes.status,
          });

          appendReplay(options.store, {
            runId: options.actionResult.run.runId,
            source: options.source,
            eventType: "appfolio.workflow.step.completed",
            stateDelta: `preset=${presetId};rows=${smartBillSummary.rows};truncated=${rowsRes.truncated}`,
            payloadRef: preset.reportName,
            ts: options.ts,
          });
          appendReceipt(options.store, {
            receiptId: randomUUID(),
            runId: options.actionResult.run.runId,
            actor: options.actor,
            action: `appfolio.workflow.step:${workflow.id}:${presetId}`,
            outcome: "ok",
            ts: options.ts,
            artifacts: [
              `workflow:${workflow.id}`,
              `preset:${presetId}`,
              `rows:${smartBillSummary.rows}`,
            ],
          });
        } else {
          stepResults.push({ presetId, ok: false, status: rowsRes.status });
          appendReplay(options.store, {
            runId: options.actionResult.run.runId,
            source: options.source,
            eventType: "appfolio.workflow.step.failed",
            stateDelta: `preset=${presetId};error=${rowsRes.error ?? "unknown"}`,
            payloadRef: preset.reportName,
            ts: options.ts,
          });
          appendReceipt(options.store, {
            receiptId: randomUUID(),
            runId: options.actionResult.run.runId,
            actor: options.actor,
            action: `appfolio.workflow.step:${workflow.id}:${presetId}`,
            outcome: "error",
            ts: options.ts,
            artifacts: [`workflow:${workflow.id}`, `preset:${presetId}`],
          });
        }
      } else {
        const report = await runAppfolioReport({ reportName: preset.reportName, body });
        stepResults.push({ presetId, ok: report.ok, count: report.count, status: report.status });
        if (report.endpoint) {
          options.actionResult.run.artifacts.push(`appfolio_endpoint:${report.endpoint}`);
        }
      }
      continue;
    }

    const report = await runAppfolioReport({ reportName: preset.reportName, body });
    stepResults.push({ presetId, ok: report.ok, count: report.count, status: report.status });
    options.actionResult.run.artifacts.push(`appfolio_step:${presetId}:ok=${report.ok}`);
    if (typeof report.count === "number") {
      options.actionResult.run.artifacts.push(`appfolio_step:${presetId}:rows=${report.count}`);
    }
    if (report.endpoint) {
      options.actionResult.run.artifacts.push(`appfolio_endpoint:${report.endpoint}`);
    }

    appendReplay(options.store, {
      runId: options.actionResult.run.runId,
      source: options.source,
      eventType: report.ok ? "appfolio.workflow.step.completed" : "appfolio.workflow.step.failed",
      stateDelta: `preset=${presetId};ok=${report.ok};rows=${typeof report.count === "number" ? report.count : "unknown"}`,
      payloadRef: preset.reportName,
      ts: options.ts,
    });
    appendReceipt(options.store, {
      receiptId: randomUUID(),
      runId: options.actionResult.run.runId,
      actor: options.actor,
      action: `appfolio.workflow.step:${workflow.id}:${presetId}`,
      outcome: report.ok ? "ok" : "error",
      ts: options.ts,
      artifacts: [`workflow:${workflow.id}`, `preset:${presetId}`, `report:${preset.reportName}`],
    });
  }

  const okSteps = stepResults.filter((step) => step.ok).length;
  const failedSteps = stepResults.length - okSteps;
  const dup = smartBillSummary?.duplicates ?? 0;
  options.actionResult.run.summary = `appfolio_workflow:${workflow.id}:ok=${okSteps};failed=${failedSteps};duplicates=${dup}`;

  if (smartBillSummary && (smartBillSummary.duplicates > 0 || smartBillSummary.missingVendor > 0)) {
    const summaryParts = [
      `bill_detail rows=${smartBillSummary.rows}`,
      `duplicates=${smartBillSummary.duplicates}`,
      `missingVendor=${smartBillSummary.missingVendor}`,
      `missingProperty=${smartBillSummary.missingProperty}`,
      `missingAmount=${smartBillSummary.missingAmount}`,
    ];
    const decision = createDecisionCard(options.store, {
      runId: options.actionResult.run.runId,
      seatId: "ui-operator",
      title: `Smart Bill review findings: ${workflow.id}`,
      summary: summaryParts.join(", "),
      riskLevel: "medium",
      createdAtMs: options.ts,
    });
    options.actionResult.run.artifacts.push(`decision:${decision.decisionId}`);
    appendReplay(options.store, {
      runId: options.actionResult.run.runId,
      source: options.source,
      eventType: "decision.created",
      stateDelta: `decisionId=${decision.decisionId}`,
      ts: options.ts,
    });
  }

  return true;
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
  const laggingSchedule = store.schedules.find((schedule) => {
    if (!schedule.enabled || typeof schedule.nextRunAtMs !== "number") {
      return false;
    }
    const threshold = Math.max(5 * 60 * 1000, schedule.intervalMs ?? 60 * 1000);
    return schedule.nextRunAtMs < now - threshold;
  });
  if (laggingSchedule) {
    steps.push({
      id: "recover-lagging-schedule",
      title: "Recover lagging schedule",
      detail: `${laggingSchedule.name} is behind schedule and needs a tick.`,
      priority: "high",
      seatId: laggingSchedule.seatId,
      action: laggingSchedule.action,
    });
  }

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

  const reportSchedules = store.schedules.filter((schedule) =>
    Boolean(parseWorkforceAppfolioReportPresetId(schedule.action)),
  );
  if (reportSchedules.length === 0) {
    steps.push({
      id: "install-appfolio-report-schedules",
      title: "Install AppFolio report schedules",
      detail: "Enable recurring rent roll, delinquency, and work order report jobs.",
      priority: "medium",
    });
  }

  const hasSmartBillDailyWorkflow = store.schedules.some(
    (schedule) => parseWorkforceAppfolioWorkflowId(schedule.action) === "smart_bill_daily",
  );
  if (!hasSmartBillDailyWorkflow) {
    steps.push({
      id: "install-smart-bill-daily",
      title: "Install Smart Bill daily workflow schedule",
      detail:
        "Adds a recurring API-only Smart Bill workflow (bill detail + vendor ledger + work orders) and surfaces findings as decision cards.",
      priority: "medium",
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
  const recentRuns = store.runs.filter((entry) => now - entry.startedAtMs <= DAY_MS);
  const recentRuns24h = recentRuns.length;
  const autonomous = store.seats.filter((seat) => seat.autonomyMode === "autonomous").length;
  const supervised = store.seats.filter((seat) => seat.autonomyMode === "supervised").length;
  const manual = store.seats.filter((seat) => seat.autonomyMode === "manual").length;
  const queuesPressured = store.queues.filter(
    (queue) => queue.pending >= Math.max(1, queue.concurrency * 2),
  ).length;
  const schedulesLagging = store.schedules.filter((schedule) => {
    if (!schedule.enabled || typeof schedule.nextRunAtMs !== "number") {
      return false;
    }
    const threshold = Math.max(5 * 60 * 1000, schedule.intervalMs ?? 60 * 1000);
    return schedule.nextRunAtMs < now - threshold;
  }).length;
  const policyDecisions = recentRuns.reduce(
    (acc, run) => {
      if (run.policyDecision === "block") {
        acc.block += 1;
      } else if (run.policyDecision === "escalate") {
        acc.escalate += 1;
      } else {
        acc.allow += 1;
      }
      return acc;
    },
    { allow: 0, block: 0, escalate: 0 },
  );
  const riskLevels = recentRuns.reduce(
    (acc, run) => {
      if (run.riskLevel === "high") {
        acc.high += 1;
      } else if (run.riskLevel === "medium") {
        acc.medium += 1;
      } else {
        acc.low += 1;
      }
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );
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
      schedulesLagging,
      policyDecisions,
      riskLevels,
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
    await maybeRunAppfolioReportJob({
      store,
      actionResult: result,
      action: options.input.action,
      payload: options.input.payload,
      actor: options.input.actor ?? "workforce",
      source: options.input.source ?? "workforce",
      ts,
    });
    await maybeRunAppfolioWorkflowJob({
      store,
      actionResult: result,
      action: options.input.action,
      payload: options.input.payload,
      actor: options.input.actor ?? "workforce",
      source: options.input.source ?? "workforce",
      ts,
    });
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
      await maybeRunAppfolioReportJob({
        store,
        actionResult,
        action: schedule.action,
        actor: options.actor ?? "scheduler",
        source: "cron",
        ts,
      });
      await maybeRunAppfolioWorkflowJob({
        store,
        actionResult,
        action: schedule.action,
        actor: options.actor ?? "scheduler",
        source: "cron",
        ts,
      });
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
