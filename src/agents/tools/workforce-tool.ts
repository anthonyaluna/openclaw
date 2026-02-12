import { Type } from "@sinclair/typebox";
import {
  runAppfolioReport,
  runAppfolioReportNextPage,
  probeAppfolioReportsAccess,
} from "../../infra/appfolio-reports.js";
import {
  actionForWorkforceAppfolioReportPreset,
  listWorkforceAppfolioReportPresets,
  listWorkforceAppfolioWorkflows,
  resolveWorkforceAppfolioReportPresetShortcut,
  resolveWorkforceAppfolioWorkflowShortcut,
  type WorkforceAppfolioReportPreset,
  type WorkforceAppfolioReportPresetId,
  type WorkforceAppfolioReportShortcutResolution,
  type WorkforceAppfolioWorkflow,
  type WorkforceAppfolioWorkflowId,
  type WorkforceAppfolioWorkflowShortcutResolution,
} from "../../workforce/appfolio-reports.js";
import {
  addWorkforceSchedule,
  executeWorkforceAction,
  getWorkforceStatus,
  getWorkforceWorkspace,
  listWorkforceSchedules,
  recordAppfolioWritebackReceipt,
} from "../../workforce/service.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const WORKFORCE_TOOL_ACTIONS = [
  "status",
  "next_steps",
  "appfolio_probe",
  "appfolio_presets",
  "appfolio_workflows",
  "appfolio_report_route",
  "appfolio_report_run",
  "appfolio_report_run_raw",
  "appfolio_report_next_page",
  "appfolio_workflow_run",
  "appfolio_workflow_schedule_install",
  "appfolio_schedules_install",
  "appfolio_writeback",
  "appfolio_workspace",
] as const;

const WORKFORCE_SOURCES = ["chat", "subagent", "cron", "workforce"] as const;
const APPFOLIO_REPORT_METHODS = ["GET", "POST"] as const;
const WORKFORCE_TOOL_ACTION_SET = new Set<string>(WORKFORCE_TOOL_ACTIONS);
const WORKFORCE_SOURCE_SET = new Set<string>(WORKFORCE_SOURCES);
const APPFOLIO_REPORT_METHOD_SET = new Set<string>(APPFOLIO_REPORT_METHODS);

const WorkforceToolSchema = Type.Object({
  action: Type.String({ minLength: 1 }),
  source: Type.Optional(Type.String()),
  actor: Type.Optional(Type.String()),
  presetId: Type.Optional(Type.String()),
  presetIds: Type.Optional(Type.Array(Type.String())),
  workflowId: Type.Optional(Type.String()),
  shortcut: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  reportName: Type.Optional(Type.String()),
  reportFilters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  filtersByPreset: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown()))),
  pagination: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  intervalMs: Type.Optional(Type.Integer({ minimum: 60_000 })),
  // Keep the tool schema strict (no `anyOf`) to satisfy downstream schema consumers.
  // Runtime parsing below is still tolerant of older callers that may pass strings.
  includeRows: Type.Optional(Type.Boolean()),
  rowLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  method: Type.Optional(Type.String()),
  nextPageUrl: Type.Optional(Type.String()),
  requireWritebackReceipt: Type.Optional(Type.Boolean()),
  writebackReceiptId: Type.Optional(Type.String()),
  autoWriteback: Type.Optional(Type.Boolean()),
  note: Type.Optional(Type.String()),
  artifact: Type.Optional(Type.String()),
});

type WorkforceActionExecuteResult = {
  policy?: string;
  reason?: string;
  profile?: string;
  run?: {
    status?: string;
    summary?: string;
    artifacts?: string[];
    error?: string;
  };
  decision?: unknown;
};

type PresetExecutionOptions = {
  preset: WorkforceAppfolioReportPreset;
  source: "chat" | "subagent" | "cron" | "workforce";
  actor?: string;
  requiresWriteback: boolean;
  autoWriteback: boolean;
  writebackReceiptId?: string;
  reportFilters?: Record<string, unknown>;
  pagination?: Record<string, unknown>;
};

type PresetExecutionResult = {
  result: WorkforceActionExecuteResult;
  retriedWithWriteback: boolean;
  writebackReceiptId?: string;
  writebackReceiptCreated: boolean;
};

type ResolvedPresetSelection = {
  preset: WorkforceAppfolioReportPreset;
  route?: WorkforceAppfolioReportShortcutResolution;
};

type ResolvedWorkflowSelection = {
  workflow: WorkforceAppfolioWorkflow;
  route?: WorkforceAppfolioWorkflowShortcutResolution;
};

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

function normalizeWorkforceAction(raw: string): (typeof WORKFORCE_TOOL_ACTIONS)[number] {
  const candidate = normalizeIdentifier(raw.replace(/^action\s*[:=]\s*/i, ""));
  const aliasMap: Record<string, (typeof WORKFORCE_TOOL_ACTIONS)[number]> = {
    appfolio_workflow: "appfolio_workflow_run",
    appfolio_workflows: "appfolio_workflow_run",
    appfolio_workflow_runner: "appfolio_workflow_run",
    appfolio_report: "appfolio_report_run",
    appfolio_reports: "appfolio_report_run",
  };
  const canonical = aliasMap[candidate] ?? candidate;
  if (!WORKFORCE_TOOL_ACTION_SET.has(canonical)) {
    throw new Error(
      `Unknown action: ${raw}. Supported actions: ${WORKFORCE_TOOL_ACTIONS.join(", ")}`,
    );
  }
  return canonical as (typeof WORKFORCE_TOOL_ACTIONS)[number];
}

function normalizeWorkforceSource(raw: string | undefined):
  | "chat"
  | "subagent"
  | "cron"
  | "workforce" {
  if (!raw) {
    return "chat";
  }
  const candidate = normalizeIdentifier(raw);
  const source = candidate === "sub_agent" ? "subagent" : candidate;
  if (!WORKFORCE_SOURCE_SET.has(source)) {
    throw new Error(`Unknown source: ${raw}`);
  }
  return source as "chat" | "subagent" | "cron" | "workforce";
}

function resolveHttpMethod(params: Record<string, unknown>): "GET" | "POST" {
  const raw = readStringParam(params, "method");
  if (!raw) {
    return "POST";
  }
  const method = raw.trim().toUpperCase();
  if (!APPFOLIO_REPORT_METHOD_SET.has(method)) {
    throw new Error(`Unsupported method: ${raw}`);
  }
  return method as "GET" | "POST";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyWritebackGateBlock(result: WorkforceActionExecuteResult): boolean {
  return (
    result.policy === "block" &&
    result.run?.status === "blocked" &&
    result.run?.summary === "appfolio_action_requires_writeback_gate"
  );
}

function parsePresetId(value: string): WorkforceAppfolioReportPresetId | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const exists = listWorkforceAppfolioReportPresets().some((preset) => preset.id === normalized);
  return exists ? (normalized as WorkforceAppfolioReportPresetId) : null;
}

function parseWorkflowId(value: string): WorkforceAppfolioWorkflowId | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const exists = listWorkforceAppfolioWorkflows().some((workflow) => workflow.id === normalized);
  return exists ? (normalized as WorkforceAppfolioWorkflowId) : null;
}

function resolvePresetOrThrow(params: Record<string, unknown>): ResolvedPresetSelection {
  const presetId = readStringParam(params, "presetId");
  if (presetId) {
    const parsed = parsePresetId(presetId);
    if (!parsed) {
      throw new Error(`Unknown presetId: ${presetId}`);
    }
    const preset = listWorkforceAppfolioReportPresets().find((entry) => entry.id === parsed);
    if (!preset) {
      throw new Error(`Unknown presetId: ${presetId}`);
    }
    return { preset };
  }

  const shortcut =
    readStringParam(params, "shortcut") ??
    readStringParam(params, "query") ??
    readStringParam(params, "reportName");
  if (!shortcut) {
    throw new Error(
      "Missing preset selector. Provide presetId or shortcut/query (e.g. 'smart bill', 'work orders', 'vendor ledger details').",
    );
  }

  const workflowResolution = resolveWorkforceAppfolioWorkflowShortcut(shortcut);
  if (workflowResolution.ok) {
    throw new Error(
      `Query maps to workflow ${workflowResolution.workflowId} (confidence ${workflowResolution.confidence.toFixed(2)}). Use action=appfolio_workflow_run.`,
    );
  }

  const resolution = resolveWorkforceAppfolioReportPresetShortcut(shortcut);
  if (!resolution.ok) {
    if (resolution.reason === "ambiguous") {
      const prompt =
        resolution.clarificationPrompt ??
        `Ambiguous report shortcut: ${shortcut}. Candidates: ${(resolution.candidates ?? []).join(", ")}`;
      throw new Error(prompt);
    }
    throw new Error(`Unknown report shortcut: ${shortcut}`);
  }

  const preset = listWorkforceAppfolioReportPresets().find(
    (entry) => entry.id === resolution.presetId,
  );
  if (!preset) {
    throw new Error(`Unknown presetId: ${resolution.presetId}`);
  }
  return { preset, route: resolution };
}

function resolveWorkflowOrThrow(params: Record<string, unknown>): ResolvedWorkflowSelection {
  const workflowId = readStringParam(params, "workflowId");
  if (workflowId) {
    const parsed = parseWorkflowId(workflowId);
    if (!parsed) {
      throw new Error(`Unknown workflowId: ${workflowId}`);
    }
    const workflow = listWorkforceAppfolioWorkflows().find((entry) => entry.id === parsed);
    if (!workflow) {
      throw new Error(`Unknown workflowId: ${workflowId}`);
    }
    return { workflow };
  }

  const shortcut =
    readStringParam(params, "shortcut") ??
    readStringParam(params, "query") ??
    readStringParam(params, "reportName");
  if (!shortcut) {
    throw new Error(
      "Missing workflow selector. Provide workflowId or shortcut/query (e.g. 'smart bill triage').",
    );
  }
  const resolution = resolveWorkforceAppfolioWorkflowShortcut(shortcut);
  if (!resolution.ok) {
    if (resolution.reason === "ambiguous") {
      throw new Error(
        resolution.clarificationPrompt ??
          `Ambiguous workflow shortcut: ${shortcut}. Candidates: ${(resolution.candidates ?? []).join(", ")}`,
      );
    }
    throw new Error(`Unknown workflow shortcut: ${shortcut}`);
  }
  const workflow = listWorkforceAppfolioWorkflows().find(
    (entry) => entry.id === resolution.workflowId,
  );
  if (!workflow) {
    throw new Error(`Unknown workflowId: ${resolution.workflowId}`);
  }
  return { workflow, route: resolution };
}

function resolvePresetIds(params: Record<string, unknown>): WorkforceAppfolioReportPresetId[] {
  const allPresets = listWorkforceAppfolioReportPresets();
  const rawPresetIds = params.presetIds;
  if (!Array.isArray(rawPresetIds) || rawPresetIds.length === 0) {
    return allPresets.map((preset) => preset.id);
  }
  const selected: WorkforceAppfolioReportPresetId[] = [];
  for (const value of rawPresetIds) {
    if (typeof value !== "string") {
      continue;
    }
    const parsed = parsePresetId(value);
    if (!parsed) {
      throw new Error(`Unknown preset id: ${value}`);
    }
    if (!selected.includes(parsed)) {
      selected.push(parsed);
    }
  }
  return selected;
}

function resolveReportFilters(params: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(params.reportFilters) ? params.reportFilters : undefined;
}

function resolvePagination(params: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(params.pagination) ? params.pagination : undefined;
}

function resolveRowLimit(params: Record<string, unknown>): number {
  const raw = params.rowLimit;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(value)) {
    return 200;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return 1;
  }
  return Math.min(normalized, 5000);
}

function resolveIncludeRows(params: Record<string, unknown>, defaultValue: boolean): boolean {
  const raw = params.includeRows;
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    return raw !== 0;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function resolveIntervalMs(params: Record<string, unknown>, fallback: number): number {
  const raw = params.intervalMs;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 60_000) {
    return 60_000;
  }
  return Math.min(normalized, 30 * 24 * 60 * 60 * 1000);
}

function resolveFiltersByPreset(
  params: Record<string, unknown>,
): Partial<Record<WorkforceAppfolioReportPresetId, Record<string, unknown>>> {
  const raw = params.filtersByPreset;
  if (!isRecord(raw)) {
    return {};
  }
  const output: Partial<Record<WorkforceAppfolioReportPresetId, Record<string, unknown>>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const presetId = parsePresetId(key);
    if (!presetId || !isRecord(value)) {
      continue;
    }
    output[presetId] = value;
  }
  return output;
}

async function maybeCreateWritebackReceipt(params: {
  actor?: string;
  note?: string;
  artifact?: string;
}): Promise<string | undefined> {
  const receipt = await recordAppfolioWritebackReceipt({
    actor: params.actor,
    note: params.note,
    artifact: params.artifact,
  });
  return receipt.receiptId;
}

async function executePresetWithWriteback(
  options: PresetExecutionOptions,
): Promise<PresetExecutionResult> {
  let writebackReceiptId = options.writebackReceiptId;
  let writebackReceiptCreated = false;

  if (options.requiresWriteback && !writebackReceiptId && options.autoWriteback) {
    writebackReceiptId = await maybeCreateWritebackReceipt({
      actor: options.actor,
      note: `Auto writeback for report job: ${options.preset.id}`,
    });
    writebackReceiptCreated = Boolean(writebackReceiptId);
  }

  const initialPayload = {
    ...(options.reportFilters ? { reportFilters: options.reportFilters } : {}),
    ...(options.pagination ? { pagination: options.pagination } : {}),
    ...(writebackReceiptId ? { writebackReceiptId } : {}),
  };

  let result = (await executeWorkforceAction({
    input: {
      seatId: options.preset.seatId,
      action: actionForWorkforceAppfolioReportPreset(options.preset.id),
      actor: options.actor,
      source: options.source,
      requireWritebackReceipt: options.requiresWriteback,
      payload: Object.keys(initialPayload).length > 0 ? initialPayload : undefined,
    },
  })) as WorkforceActionExecuteResult;

  let retriedWithWriteback = false;
  if (isLegacyWritebackGateBlock(result)) {
    if (!writebackReceiptId) {
      writebackReceiptId = await maybeCreateWritebackReceipt({
        actor: options.actor,
        note: `Compat writeback for report job: ${options.preset.id}`,
      });
      writebackReceiptCreated = Boolean(writebackReceiptId);
    }
    if (writebackReceiptId) {
      const retryPayload = {
        ...(options.reportFilters ? { reportFilters: options.reportFilters } : {}),
        ...(options.pagination ? { pagination: options.pagination } : {}),
        writebackReceiptId,
      };
      result = (await executeWorkforceAction({
        input: {
          seatId: options.preset.seatId,
          action: actionForWorkforceAppfolioReportPreset(options.preset.id),
          actor: options.actor,
          source: options.source,
          requireWritebackReceipt: true,
          payload: retryPayload,
        },
      })) as WorkforceActionExecuteResult;
      retriedWithWriteback = true;
    }
  }

  return {
    result,
    retriedWithWriteback,
    writebackReceiptId,
    writebackReceiptCreated,
  };
}

export function createWorkforceTool(): AnyAgentTool {
  return {
    label: "Workforce",
    name: "workforce",
    description:
      "Operate workforce and AppFolio reports from chat: status, probes, route intents, preset/workflow execution, pagination, schedules, writeback receipts, and workspace state.",
    parameters: WorkforceToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const actionRaw = readStringParam(params, "action", { required: true });
      const action = normalizeWorkforceAction(actionRaw);
      const actor = readStringParam(params, "actor");
      const source = normalizeWorkforceSource(readStringParam(params, "source"));

      if (action === "status") {
        return jsonResult(await getWorkforceStatus());
      }
      if (action === "next_steps") {
        const status = await getWorkforceStatus();
        return jsonResult({
          updatedAtMs: status.updatedAtMs,
          readiness: status.readiness,
          nextSteps: status.nextSteps,
        });
      }
      if (action === "appfolio_probe") {
        return jsonResult(await probeAppfolioReportsAccess());
      }
      if (action === "appfolio_presets") {
        return jsonResult(listWorkforceAppfolioReportPresets());
      }
      if (action === "appfolio_workflows") {
        return jsonResult(listWorkforceAppfolioWorkflows());
      }
      if (action === "appfolio_report_route") {
        const routeInput =
          readStringParam(params, "shortcut") ??
          readStringParam(params, "query") ??
          readStringParam(params, "reportName");
        if (!routeInput) {
          throw new Error("Missing route input. Provide shortcut, query, or reportName.");
        }
        const workflow = resolveWorkforceAppfolioWorkflowShortcut(routeInput);
        const report = resolveWorkforceAppfolioReportPresetShortcut(routeInput);
        let recommendation:
          | { kind: "workflow"; id: WorkforceAppfolioWorkflowId; confidence: number }
          | { kind: "preset"; id: WorkforceAppfolioReportPresetId; confidence: number }
          | null = null;
        if (workflow.ok && (!report.ok || workflow.confidence >= report.confidence)) {
          recommendation = {
            kind: "workflow",
            id: workflow.workflowId,
            confidence: workflow.confidence,
          };
        } else if (report.ok) {
          recommendation = {
            kind: "preset",
            id: report.presetId,
            confidence: report.confidence,
          };
        }
        return jsonResult({
          input: routeInput,
          workflow,
          report,
          recommendation,
        });
      }
      if (action === "appfolio_workspace") {
        return jsonResult(await getWorkforceWorkspace());
      }
      if (action === "appfolio_writeback") {
        const note = readStringParam(params, "note");
        const artifact = readStringParam(params, "artifact");
        const receipt = await recordAppfolioWritebackReceipt({
          actor,
          note,
          artifact,
        });
        return jsonResult({ receipt });
      }
      if (action === "appfolio_report_run_raw") {
        const reportName = readStringParam(params, "reportName", { required: true });
        const reportFilters = resolveReportFilters(params);
        const method = resolveHttpMethod(params);
        const includeRows = resolveIncludeRows(params, true);
        const maxRows = resolveRowLimit(params);
        const result = await runAppfolioReport({
          reportName,
          body: reportFilters,
          method,
          includeRows,
          maxRows,
        });
        return jsonResult(result);
      }
      if (action === "appfolio_report_next_page") {
        const nextPageUrl = readStringParam(params, "nextPageUrl", { required: true });
        const includeRows = resolveIncludeRows(params, true);
        const maxRows = resolveRowLimit(params);
        const result = await runAppfolioReportNextPage({ nextPageUrl, includeRows, maxRows });
        return jsonResult(result);
      }
      if (action === "appfolio_report_run") {
        const { preset, route } = resolvePresetOrThrow(params);
        const requiresWriteback = Boolean(params.requireWritebackReceipt);
        const autoWriteback = params.autoWriteback !== false;
        const reportFilters = resolveReportFilters(params);
        const pagination = resolvePagination(params);
        const writebackReceiptId = readStringParam(params, "writebackReceiptId");

        const execution = await executePresetWithWriteback({
          preset,
          source,
          actor,
          requiresWriteback,
          autoWriteback,
          writebackReceiptId,
          reportFilters,
          pagination,
        });

        return jsonResult({
          preset,
          route,
          writebackReceiptId: execution.writebackReceiptId,
          writebackReceiptCreated: execution.writebackReceiptCreated,
          retriedWithWriteback: execution.retriedWithWriteback,
          result: execution.result,
        });
      }
      if (action === "appfolio_workflow_run") {
        const { workflow, route } = resolveWorkflowOrThrow(params);
        const requiresWriteback = Boolean(params.requireWritebackReceipt);
        const autoWriteback = params.autoWriteback !== false;
        const globalFilters = resolveReportFilters(params) ?? {};
        const filtersByPreset = resolveFiltersByPreset(params);
        const pagination = resolvePagination(params) ?? {};
        const includeRows = resolveIncludeRows(params, true);
        const rowLimit = resolveRowLimit(params);
        let writebackReceiptId = readStringParam(params, "writebackReceiptId");
        let writebackReceiptCreated = false;

        if (requiresWriteback && !writebackReceiptId && autoWriteback) {
          writebackReceiptId = await maybeCreateWritebackReceipt({
            actor,
            note: `Auto writeback for workflow: ${workflow.id}`,
          });
          writebackReceiptCreated = Boolean(writebackReceiptId);
        }

        const actionName = `appfolio.workflow.run:${workflow.id}`;
        const payload: Record<string, unknown> = {
          ...(Object.keys(globalFilters).length > 0 ? { reportFilters: globalFilters } : {}),
          ...(Object.keys(filtersByPreset).length ? { filtersByPreset } : {}),
          ...(Object.keys(pagination).length > 0 ? { pagination } : {}),
          includeRows,
          rowLimit,
          ...(writebackReceiptId ? { writebackReceiptId } : {}),
        };

        let result = (await executeWorkforceAction({
          input: {
            seatId: "queue-manager",
            action: actionName,
            actor,
            source,
            requireWritebackReceipt: requiresWriteback,
            payload,
          },
        })) as WorkforceActionExecuteResult;

        if (isLegacyWritebackGateBlock(result) && requiresWriteback && !writebackReceiptId && autoWriteback) {
          writebackReceiptId = await maybeCreateWritebackReceipt({
            actor,
            note: `Compat writeback for workflow: ${workflow.id}`,
          });
          writebackReceiptCreated = writebackReceiptCreated || Boolean(writebackReceiptId);
          if (writebackReceiptId) {
            result = (await executeWorkforceAction({
              input: {
                seatId: "queue-manager",
                action: actionName,
                actor,
                source,
                requireWritebackReceipt: true,
                payload: { ...payload, writebackReceiptId },
              },
            })) as WorkforceActionExecuteResult;
          }
        }

        return jsonResult({
          ok: true,
          workflow,
          route,
          action: actionName,
          entrySeatId: "queue-manager",
          includeRows,
          rowLimit,
          writebackReceiptId: writebackReceiptId ?? null,
          writebackReceiptCreated,
          result,
        });
      }
      if (action === "appfolio_workflow_schedule_install") {
        const { workflow, route } = resolveWorkflowOrThrow(params);
        const schedules = await listWorkforceSchedules({ limit: 5000 });
        const existingActions = new Set((schedules.schedules ?? []).map((entry) => entry.action));
        const actionName = `appfolio.workflow.run:${workflow.id}`;
        if (existingActions.has(actionName)) {
          return jsonResult({ ok: true, workflow, route, installed: false, reason: "already_installed" });
        }

        const defaultIntervalMs =
          workflow.id === "smart_bill_triage" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const intervalMs = resolveIntervalMs(params, defaultIntervalMs);
        const schedule = await addWorkforceSchedule({
          seatId: "queue-manager",
          name: `AppFolio Workflow: ${workflow.label}`,
          intervalMs,
          action: actionName,
        });

        return jsonResult({ ok: true, workflow, route, installed: true, schedule });
      }
      if (action === "appfolio_schedules_install") {
        const selectedPresetIds = resolvePresetIds(params);
        const selectedPresets = listWorkforceAppfolioReportPresets().filter((preset) =>
          selectedPresetIds.includes(preset.id),
        );
        const schedules = await listWorkforceSchedules({ limit: 5000 });
        const existingActions = new Set((schedules.schedules ?? []).map((entry) => entry.action));
        const installed: Array<{ presetId: string; scheduleId: string }> = [];
        const skipped: Array<{ presetId: string; reason: string }> = [];

        for (const preset of selectedPresets) {
          const actionName = actionForWorkforceAppfolioReportPreset(preset.id);
          if (existingActions.has(actionName)) {
            skipped.push({ presetId: preset.id, reason: "already_installed" });
            continue;
          }
          const schedule = await addWorkforceSchedule({
            seatId: preset.seatId,
            name: `AppFolio ${preset.label}`,
            intervalMs: preset.defaultIntervalMs,
            action: actionName,
          });
          installed.push({ presetId: preset.id, scheduleId: schedule.id });
          existingActions.add(actionName);
        }

        return jsonResult({ installed, skipped });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
