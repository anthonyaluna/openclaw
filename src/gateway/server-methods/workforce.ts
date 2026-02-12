import type { GatewayRequestHandlers } from "./types.js";
import { probeAppfolioReportsAccess } from "../../infra/appfolio-reports.js";
import {
  addWorkforceSchedule,
  executeWorkforceAction,
  getWorkforceStatus,
  getWorkforceWorkspace,
  initializeWorkforceStore,
  listWorkforceDecisions,
  listWorkforceLedger,
  listWorkforceRuns,
  listWorkforceSchedules,
  recordAppfolioWritebackReceipt,
  replayWorkforceRun,
  resolveWorkforceDecision,
  tickWorkforceSchedules,
} from "../../workforce/service.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkforceActionParams,
  validateWorkforceAppfolioReportsProbeParams,
  validateWorkforceAppfolioWritebackParams,
  validateWorkforceDecisionResolveParams,
  validateWorkforceDecisionsParams,
  validateWorkforceInitParams,
  validateWorkforceLedgerParams,
  validateWorkforceReplayParams,
  validateWorkforceRunsParams,
  validateWorkforceScheduleAddParams,
  validateWorkforceSchedulesParams,
  validateWorkforceStatusParams,
  validateWorkforceTickParams,
  validateWorkforceWorkspaceParams,
} from "../protocol/index.js";

export const workforceHandlers: GatewayRequestHandlers = {
  "workforce.init": async ({ params, respond, context }) => {
    if (!validateWorkforceInitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.init params: ${formatValidationErrors(validateWorkforceInitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { force?: boolean };
      const result = await initializeWorkforceStore({ force: Boolean(p.force) });
      context.broadcast(
        "workforce.updated",
        { kind: "init", ts: Date.now() },
        { dropIfSlow: true },
      );
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.status": async ({ params, respond }) => {
    if (!validateWorkforceStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.status params: ${formatValidationErrors(validateWorkforceStatusParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const result = await getWorkforceStatus();
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.runs": async ({ params, respond }) => {
    if (!validateWorkforceRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.runs params: ${formatValidationErrors(validateWorkforceRunsParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { limit?: number; query?: string; status?: string };
      const result = await listWorkforceRuns({
        limit: p.limit,
        query: p.query,
        status: p.status as
          | "queued"
          | "running"
          | "ok"
          | "error"
          | "blocked"
          | "escalated"
          | undefined,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.ledger": async ({ params, respond }) => {
    if (!validateWorkforceLedgerParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.ledger params: ${formatValidationErrors(validateWorkforceLedgerParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { limit?: number };
      const result = await listWorkforceLedger({ limit: p.limit });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.decisions": async ({ params, respond }) => {
    if (!validateWorkforceDecisionsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.decisions params: ${formatValidationErrors(validateWorkforceDecisionsParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { limit?: number; status?: "pending" | "resolved" };
      const result = await listWorkforceDecisions({ limit: p.limit, status: p.status });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.workspace": async ({ params, respond }) => {
    if (!validateWorkforceWorkspaceParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.workspace params: ${formatValidationErrors(validateWorkforceWorkspaceParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const result = await getWorkforceWorkspace();
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.action.execute": async ({ params, respond, context }) => {
    if (!validateWorkforceActionParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.action.execute params: ${formatValidationErrors(validateWorkforceActionParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as {
        seatId: string;
        action: string;
        source?: "chat" | "subagent" | "cron" | "workforce";
        actor?: string;
        requireWritebackReceipt?: boolean;
        payload?: Record<string, unknown>;
      };
      const result = await executeWorkforceAction({
        input: {
          seatId: p.seatId as Parameters<typeof executeWorkforceAction>[0]["input"]["seatId"],
          action: p.action,
          source: p.source,
          actor: p.actor,
          requireWritebackReceipt: p.requireWritebackReceipt,
          payload: p.payload,
        },
      });
      context.broadcast(
        "workforce.updated",
        { kind: "action", ts: Date.now(), runId: result.run.runId },
        { dropIfSlow: true },
      );
      if (result.decision) {
        context.broadcast("workforce.decision.requested", result.decision, { dropIfSlow: true });
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.decision.resolve": async ({ params, respond, context }) => {
    if (!validateWorkforceDecisionResolveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.decision.resolve params: ${formatValidationErrors(validateWorkforceDecisionResolveParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { decisionId: string; resolution: "allow" | "deny"; actor?: string };
      const result = await resolveWorkforceDecision({
        decisionId: p.decisionId,
        resolution: p.resolution,
        actor: p.actor,
      });
      context.broadcast(
        "workforce.updated",
        { kind: "decision.resolve", ts: Date.now(), decisionId: p.decisionId },
        { dropIfSlow: true },
      );
      context.broadcast("workforce.decision.resolved", result, { dropIfSlow: true });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.run.replay": async ({ params, respond, context }) => {
    if (!validateWorkforceReplayParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.run.replay params: ${formatValidationErrors(validateWorkforceReplayParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { runId: string; actor?: string };
      const result = await replayWorkforceRun({ runId: p.runId, actor: p.actor });
      context.broadcast(
        "workforce.updated",
        { kind: "run.replay", ts: Date.now(), runId: p.runId },
        { dropIfSlow: true },
      );
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.schedule.add": async ({ params, respond, context }) => {
    if (!validateWorkforceScheduleAddParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.schedule.add params: ${formatValidationErrors(validateWorkforceScheduleAddParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { seatId: string; name: string; intervalMs: number; action: string };
      const result = await addWorkforceSchedule({
        seatId: p.seatId as Parameters<typeof addWorkforceSchedule>[0]["seatId"],
        name: p.name,
        intervalMs: p.intervalMs,
        action: p.action,
      });
      context.broadcast(
        "workforce.updated",
        { kind: "schedule.add", ts: Date.now() },
        { dropIfSlow: true },
      );
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.schedules": async ({ params, respond }) => {
    if (!validateWorkforceSchedulesParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.schedules params: ${formatValidationErrors(validateWorkforceSchedulesParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { limit?: number };
      const result = await listWorkforceSchedules({ limit: p.limit });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.tick": async ({ params, respond, context }) => {
    if (!validateWorkforceTickParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.tick params: ${formatValidationErrors(validateWorkforceTickParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { actor?: string };
      const result = await tickWorkforceSchedules({ actor: p.actor });
      context.broadcast(
        "workforce.updated",
        { kind: "tick", ts: Date.now(), triggered: result.triggered.length },
        { dropIfSlow: true },
      );
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.appfolio.writeback": async ({ params, respond, context }) => {
    if (!validateWorkforceAppfolioWritebackParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.appfolio.writeback params: ${formatValidationErrors(validateWorkforceAppfolioWritebackParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { actor?: string; note?: string; artifact?: string };
      const receipt = await recordAppfolioWritebackReceipt({
        actor: p.actor,
        note: p.note,
        artifact: p.artifact,
      });
      context.broadcast(
        "workforce.updated",
        { kind: "appfolio.writeback", ts: Date.now(), receiptId: receipt.receiptId },
        { dropIfSlow: true },
      );
      respond(true, { receipt }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "workforce.appfolio.reports.probe": async ({ params, respond }) => {
    if (!validateWorkforceAppfolioReportsProbeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workforce.appfolio.reports.probe params: ${formatValidationErrors(validateWorkforceAppfolioReportsProbeParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const result = await probeAppfolioReportsAccess();
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
