import type { WorkforceSeatId } from "./roster.js";

export type WorkforceAppfolioReportPresetId =
  | "rent_roll"
  | "delinquency"
  | "work_order"
  | "bill_detail"
  | "vendor_ledger"
  | "vendor_ledger_enhanced";

export type WorkforceAppfolioWorkflowId =
  | "smart_bill_triage"
  | "smart_bill_reconcile"
  | "smart_bill_daily";

export type WorkforceAppfolioReportPresetDefinition = {
  id: WorkforceAppfolioReportPresetId;
  label: string;
  description: string;
  reportName: string;
  seatId: WorkforceSeatId;
  defaultIntervalMs: number;
  buildPayload: (nowMs: number) => Record<string, unknown>;
};

export type WorkforceAppfolioReportPreset = Omit<
  WorkforceAppfolioReportPresetDefinition,
  "buildPayload"
> & {
  defaultPayload: Record<string, unknown>;
};

export type WorkforceAppfolioWorkflowDefinition = {
  id: WorkforceAppfolioWorkflowId;
  label: string;
  description: string;
  presetIds: readonly WorkforceAppfolioReportPresetId[];
};

export type WorkforceAppfolioWorkflow = WorkforceAppfolioWorkflowDefinition;

export type WorkforceAppfolioWorkflowShortcutResolution =
  | {
      ok: true;
      workflowId: WorkforceAppfolioWorkflowId;
      matchedBy: "workflow_id" | "shortcut";
      normalized: string;
      confidence: number;
      matchedPhrase?: string;
    }
  | {
      ok: false;
      reason: "no_match" | "ambiguous";
      normalized: string;
      confidence: number;
      candidates?: WorkforceAppfolioWorkflowId[];
      clarificationPrompt?: string;
    };

export type WorkforceAppfolioReportShortcutResolution =
  | {
      ok: true;
      presetId: WorkforceAppfolioReportPresetId;
      matchedBy: "preset_id" | "report_name" | "shortcut" | "keyword";
      normalized: string;
      confidence: number;
      matchedPhrase?: string;
      allMatches?: WorkforceAppfolioReportPresetId[];
    }
  | {
      ok: false;
      reason: "no_match" | "ambiguous";
      normalized: string;
      confidence: number;
      candidates?: WorkforceAppfolioReportPresetId[];
      clarificationPrompt?: string;
    };

export type WorkforceAppfolioReportPayloadValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type WorkforceAppfolioPaginationOptions = {
  autoPaginate: boolean;
  maxPages: number;
  maxRows: number;
};

export const DEFAULT_WORKFORCE_APPFOLIO_PAGINATION: WorkforceAppfolioPaginationOptions = {
  autoPaginate: true,
  maxPages: 3,
  maxRows: 15_000,
};

const MAX_WORKFORCE_APPFOLIO_PAGES = 20;
const MAX_WORKFORCE_APPFOLIO_ROWS = 200_000;

function formatYmd(input: Date): string {
  const year = input.getUTCFullYear();
  const month = `${input.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${input.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(nowMs: number, days: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  return formatYmd(new Date(nowMs - days * dayMs));
}

function propertiesFilter() {
  return {
    properties_ids: [],
    property_groups_ids: [],
    portfolios_ids: [],
    owners_ids: [],
  };
}

export const WORKFORCE_APPFOLIO_REPORT_PRESET_DEFINITIONS: readonly WorkforceAppfolioReportPresetDefinition[] =
  [
    {
      id: "rent_roll",
      label: "Rent Roll Snapshot",
      description: "Daily rent roll baseline for occupancy and receivables monitoring.",
      reportName: "rent_roll.json",
      seatId: "queue-manager",
      defaultIntervalMs: 24 * 60 * 60 * 1000,
      buildPayload: (nowMs) => ({
        properties: propertiesFilter(),
        unit_visibility: "active",
        as_of_to: dateDaysAgo(nowMs, 0),
        non_revenue_units: "0",
      }),
    },
    {
      id: "delinquency",
      label: "Delinquency Sweep",
      description: "Frequent delinquency sweep for collections and follow-up routing.",
      reportName: "delinquency.json",
      seatId: "queue-manager",
      defaultIntervalMs: 6 * 60 * 60 * 1000,
      buildPayload: (nowMs) => ({
        property_visibility: "active",
        properties: propertiesFilter(),
        delinquency_note_range: "this month",
        tenant_statuses: ["0", "4"],
        amount_owed_in_account: "all",
        include_future_dated_charges: "0",
        as_of_to: dateDaysAgo(nowMs, 0),
      }),
    },
    {
      id: "work_order",
      label: "Work Order Queue",
      description: "Operational queue health for new/assigned/scheduled work orders.",
      reportName: "work_order.json",
      seatId: "scheduler",
      defaultIntervalMs: 30 * 60 * 1000,
      buildPayload: (nowMs) => ({
        property_visibility: "active",
        properties: propertiesFilter(),
        work_order_statuses: ["0", "1", "2", "9", "11", "3"],
        status_date_range_from: dateDaysAgo(nowMs, 14),
        status_date_range_to: dateDaysAgo(nowMs, 0),
        status_date: "0",
      }),
    },
    {
      id: "bill_detail",
      label: "Bill Detail",
      description: "Accounts payable bill detail for Smart Bill and invoice workflows.",
      reportName: "bill_detail.json",
      seatId: "queue-manager",
      defaultIntervalMs: 6 * 60 * 60 * 1000,
      buildPayload: (nowMs) => ({
        property_visibility: "active",
        property_corporate_entity_combination: "properties_only",
        properties: propertiesFilter(),
        date_type: "Bill Date",
        occurred_on_from: dateDaysAgo(nowMs, 30),
        occurred_on_to: dateDaysAgo(nowMs, 0),
      }),
    },
    {
      id: "vendor_ledger",
      label: "Vendor Ledger",
      description: "Vendor payment and balance ledger for AP and reconciliation.",
      reportName: "vendor_ledger.json",
      seatId: "queue-manager",
      defaultIntervalMs: 6 * 60 * 60 * 1000,
      buildPayload: (nowMs) => ({
        property_visibility: "active",
        property_corporate_entity_combination: "properties_only",
        properties: propertiesFilter(),
        occurred_on_from: dateDaysAgo(nowMs, 30),
        occurred_on_to: dateDaysAgo(nowMs, 0),
      }),
    },
    {
      id: "vendor_ledger_enhanced",
      label: "Vendor Ledger (Enhanced)",
      description: "Enhanced vendor ledger detail for deep AP diagnostics.",
      reportName: "vendor_ledger_enhanced.json",
      seatId: "queue-manager",
      defaultIntervalMs: 24 * 60 * 60 * 1000,
      buildPayload: (nowMs) => ({
        property_visibility: "active",
        property_corporate_entity_combination: "properties_only",
        properties: propertiesFilter(),
        occurred_on_from: dateDaysAgo(nowMs, 30),
        occurred_on_to: dateDaysAgo(nowMs, 0),
      }),
    },
  ];

export const WORKFORCE_APPFOLIO_WORKFLOW_DEFINITIONS: readonly WorkforceAppfolioWorkflowDefinition[] =
  [
    {
      id: "smart_bill_triage",
      label: "Smart Bill Triage",
      description: "Fetch Smart Bill AP detail plus current work order queue context.",
      presetIds: ["bill_detail", "work_order"],
    },
    {
      id: "smart_bill_reconcile",
      label: "Smart Bill Reconcile",
      description: "Fetch bill detail with enhanced vendor ledger for AP reconciliation.",
      presetIds: ["bill_detail", "vendor_ledger_enhanced"],
    },
    {
      id: "smart_bill_daily",
      label: "Smart Bill Daily Ops",
      description:
        "Daily AP snapshot including bill detail, vendor ledger diagnostics, and work orders.",
      presetIds: ["bill_detail", "vendor_ledger_enhanced", "work_order"],
    },
  ];

const PRESET_BY_ID = new Map(
  WORKFORCE_APPFOLIO_REPORT_PRESET_DEFINITIONS.map((preset) => [preset.id, preset]),
);

const WORKFLOW_BY_ID = new Map(
  WORKFORCE_APPFOLIO_WORKFLOW_DEFINITIONS.map((workflow) => [workflow.id, workflow]),
);

const PRESET_SHORTCUTS: Record<WorkforceAppfolioReportPresetId, readonly string[]> = {
  rent_roll: [
    "rent roll",
    "rentroll",
    "occupancy report",
    "occupancy snapshot",
    "rent roll snapshot",
  ],
  delinquency: [
    "delinquency",
    "collections",
    "arrears",
    "past due tenants",
    "past due balances",
  ],
  work_order: [
    "work order",
    "work orders",
    "workorder",
    "workorders",
    "maintenance queue",
    "maintenance work orders",
    "maintenance backlog",
  ],
  bill_detail: [
    "bill detail",
    "bill details",
    "smart bill",
    "smart bill entry",
    "smart bill queue",
    "smart bills",
    "invoice detail",
    "invoice details",
    "invoices",
    "ap invoices",
    "accounts payable bills",
    "vendor bills",
  ],
  vendor_ledger: [
    "vendor ledger",
    "vendor payment ledger",
    "vendor balance ledger",
  ],
  vendor_ledger_enhanced: [
    "vendor ledger enhanced",
    "vendor ledger detail",
    "vendor ledger details",
    "vendor ledger diagnostics",
    "vendor ledger deep dive",
    "vendor detail ledger",
  ],
};

const WORKFLOW_SHORTCUTS: Record<WorkforceAppfolioWorkflowId, readonly string[]> = {
  smart_bill_triage: [
    "smart bill triage",
    "smart bill and work orders",
    "work orders and invoice data",
    "work order and bill detail",
    "smart bill ops triage",
  ],
  smart_bill_reconcile: [
    "smart bill reconcile",
    "bill detail and vendor ledger",
    "vendor ledger and bill detail",
    "invoice vendor reconciliation",
  ],
  smart_bill_daily: [
    "smart bill daily",
    "daily smart bill ops",
    "smart bill daily workflow",
    "smart bill review",
    "smart bill full review",
  ],
};

const KEYWORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "to",
  "all",
  "daily",
  "data",
  "report",
]);

function normalizeShortcutInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.json\b/g, "")
    .replace(/[_/\-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePresetIdCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type PhraseMatch = {
  presetId: WorkforceAppfolioReportPresetId;
  phrase: string;
};

type WorkflowPhraseMatch = {
  workflowId: WorkforceAppfolioWorkflowId;
  phrase: string;
};

const SHORTCUT_PHRASES: PhraseMatch[] = Object.entries(PRESET_SHORTCUTS)
  .flatMap(([presetId, phrases]) =>
    phrases.map((phrase) => ({
      presetId: presetId as WorkforceAppfolioReportPresetId,
      phrase: normalizeShortcutInput(phrase),
    })),
  )
  .sort((a, b) => b.phrase.length - a.phrase.length);

const WORKFLOW_SHORTCUT_PHRASES: WorkflowPhraseMatch[] = Object.entries(WORKFLOW_SHORTCUTS)
  .flatMap(([workflowId, phrases]) =>
    phrases.map((phrase) => ({
      workflowId: workflowId as WorkforceAppfolioWorkflowId,
      phrase: normalizeShortcutInput(phrase),
    })),
  )
  .sort((a, b) => b.phrase.length - a.phrase.length);

function hasWholePhrase(input: string, phrase: string): boolean {
  if (!input || !phrase) {
    return false;
  }
  const haystack = ` ${input} `;
  const needle = ` ${phrase} `;
  return haystack.includes(needle);
}

function tokenizeInput(value: string): string[] {
  return normalizeShortcutInput(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !KEYWORD_STOPWORDS.has(part));
}

const PRESET_KEYWORDS: Record<WorkforceAppfolioReportPresetId, Set<string>> = Object.fromEntries(
  Object.entries(PRESET_SHORTCUTS).map(([presetId, phrases]) => [
    presetId,
    new Set(phrases.flatMap((phrase) => tokenizeInput(phrase))),
  ]),
) as Record<WorkforceAppfolioReportPresetId, Set<string>>;

const REPORT_NAME_TO_PRESET_ID = new Map<string, WorkforceAppfolioReportPresetId>(
  WORKFORCE_APPFOLIO_REPORT_PRESET_DEFINITIONS.flatMap((preset) => {
    const normalizedWithExt = normalizeShortcutInput(preset.reportName);
    const normalizedWithoutExt = normalizeShortcutInput(preset.reportName.replace(/\.json$/i, ""));
    return [
      [normalizedWithExt, preset.id] as const,
      [normalizedWithoutExt, preset.id] as const,
    ];
  }),
);

function buildPresetClarificationPrompt(candidates: WorkforceAppfolioReportPresetId[]): string {
  const labels = candidates
    .map((candidate) => {
      const preset = PRESET_BY_ID.get(candidate);
      return preset ? `${candidate} (${preset.label})` : candidate;
    })
    .join(", ");
  return `Ambiguous report intent. Choose one presetId: ${labels}`;
}

function buildWorkflowClarificationPrompt(candidates: WorkforceAppfolioWorkflowId[]): string {
  const labels = candidates
    .map((candidate) => {
      const workflow = WORKFLOW_BY_ID.get(candidate);
      return workflow ? `${candidate} (${workflow.label})` : candidate;
    })
    .join(", ");
  return `Ambiguous workflow intent. Choose one workflowId: ${labels}`;
}

function resolveByKeywords(
  normalized: string,
): {
  presetId: WorkforceAppfolioReportPresetId;
  confidence: number;
  ambiguous?: WorkforceAppfolioReportPresetId[];
} | null {
  const tokens = tokenizeInput(normalized);
  if (tokens.length === 0) {
    return null;
  }
  const tokenSet = new Set(tokens);
  const scores = (Object.keys(PRESET_KEYWORDS) as WorkforceAppfolioReportPresetId[])
    .map((presetId) => {
      const keywords = PRESET_KEYWORDS[presetId];
      if (!keywords || keywords.size === 0) {
        return { presetId, score: 0 };
      }
      let matches = 0;
      for (const token of tokenSet) {
        if (keywords.has(token)) {
          matches += 1;
        }
      }
      return { presetId, score: matches / Math.max(1, keywords.size) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  if (!best || best.score < 0.2) {
    return null;
  }

  if (second && second.score > 0 && Math.abs(best.score - second.score) < 0.08) {
    return {
      presetId: best.presetId,
      confidence: 0.45,
      ambiguous: [best.presetId, second.presetId],
    };
  }

  const confidence = clampNumber(0.55 + best.score * 0.35, 0.55, 0.89);
  return {
    presetId: best.presetId,
    confidence,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseYmdDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const normalized = formatYmd(parsed);
  return normalized === raw ? parsed : null;
}

function ensureDateField(
  payload: Record<string, unknown>,
  key: string,
  errors: string[],
  warnings: string[],
  options?: { required?: boolean },
) {
  const value = payload[key];
  if (typeof value === "undefined" || value === null || value === "") {
    if (options?.required) {
      errors.push(`missing_required_filter:${key}`);
    }
    return;
  }
  if (!parseYmdDate(value)) {
    errors.push(`invalid_date_filter:${key}`);
    return;
  }
  if (typeof value === "string" && value < "2000-01-01") {
    warnings.push(`suspicious_date_filter:${key}`);
  }
}

function ensureDateRange(
  payload: Record<string, unknown>,
  fromKey: string,
  toKey: string,
  errors: string[],
  warnings: string[],
  options?: { required?: boolean },
) {
  ensureDateField(payload, fromKey, errors, warnings, options);
  ensureDateField(payload, toKey, errors, warnings, options);
  const fromDate = parseYmdDate(payload[fromKey]);
  const toDate = parseYmdDate(payload[toKey]);
  if (!fromDate || !toDate) {
    return;
  }
  if (fromDate.getTime() > toDate.getTime()) {
    errors.push(`invalid_date_range:${fromKey}>${toKey}`);
    return;
  }
  const spanMs = toDate.getTime() - fromDate.getTime();
  if (spanMs > 366 * 24 * 60 * 60 * 1000) {
    warnings.push(`wide_date_range:${fromKey},${toKey}`);
  }
}

function ensureObjectField(payload: Record<string, unknown>, key: string, warnings: string[]) {
  const value = payload[key];
  if (typeof value === "undefined") {
    warnings.push(`missing_recommended_filter:${key}`);
    return;
  }
  if (!asRecord(value)) {
    warnings.push(`invalid_filter_shape:${key}`);
  }
}

export function normalizeWorkforceAppfolioPaginationOptions(
  input: unknown,
): WorkforceAppfolioPaginationOptions {
  const record = asRecord(input);
  const autoPaginate =
    typeof record?.autoPaginate === "boolean"
      ? record.autoPaginate
      : DEFAULT_WORKFORCE_APPFOLIO_PAGINATION.autoPaginate;
  const maxPagesRaw =
    typeof record?.maxPages === "number"
      ? record.maxPages
      : DEFAULT_WORKFORCE_APPFOLIO_PAGINATION.maxPages;
  const maxRowsRaw =
    typeof record?.maxRows === "number"
      ? record.maxRows
      : DEFAULT_WORKFORCE_APPFOLIO_PAGINATION.maxRows;
  return {
    autoPaginate,
    maxPages: clampNumber(Math.floor(maxPagesRaw), 1, MAX_WORKFORCE_APPFOLIO_PAGES),
    maxRows: clampNumber(Math.floor(maxRowsRaw), 1, MAX_WORKFORCE_APPFOLIO_ROWS),
  };
}

export function validateWorkforceAppfolioReportPayload(
  presetId: WorkforceAppfolioReportPresetId,
  payload: Record<string, unknown>,
): WorkforceAppfolioReportPayloadValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (presetId) {
    case "rent_roll":
      ensureDateField(payload, "as_of_to", errors, warnings, { required: true });
      ensureObjectField(payload, "properties", warnings);
      break;
    case "delinquency":
      ensureDateField(payload, "as_of_to", errors, warnings);
      ensureObjectField(payload, "properties", warnings);
      break;
    case "work_order":
      ensureDateRange(payload, "status_date_range_from", "status_date_range_to", errors, warnings, {
        required: true,
      });
      ensureObjectField(payload, "properties", warnings);
      break;
    case "bill_detail":
      ensureDateRange(payload, "occurred_on_from", "occurred_on_to", errors, warnings, {
        required: true,
      });
      ensureObjectField(payload, "properties", warnings);
      break;
    case "vendor_ledger":
    case "vendor_ledger_enhanced":
      ensureDateRange(payload, "occurred_on_from", "occurred_on_to", errors, warnings, {
        required: true,
      });
      ensureObjectField(payload, "properties", warnings);
      break;
    default:
      break;
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function parseWorkforceAppfolioReportPresetId(
  action: string,
): WorkforceAppfolioReportPresetId | null {
  const normalized = action.trim().toLowerCase();
  const prefix = "appfolio.report.run:";
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const maybeId = normalized.slice(prefix.length);
  if (!maybeId) {
    return null;
  }
  return PRESET_BY_ID.has(maybeId as WorkforceAppfolioReportPresetId)
    ? (maybeId as WorkforceAppfolioReportPresetId)
    : null;
}

export function parseWorkforceAppfolioWorkflowId(action: string): WorkforceAppfolioWorkflowId | null {
  const normalized = action.trim().toLowerCase();
  const prefix = "appfolio.workflow.run:";
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const maybeId = normalized.slice(prefix.length);
  if (!maybeId) {
    return null;
  }
  return WORKFLOW_BY_ID.has(maybeId as WorkforceAppfolioWorkflowId)
    ? (maybeId as WorkforceAppfolioWorkflowId)
    : null;
}

export function resolveWorkforceAppfolioWorkflowShortcut(
  input: string,
): WorkforceAppfolioWorkflowShortcutResolution {
  const workflowCandidate = normalizePresetIdCandidate(input);
  if (WORKFLOW_BY_ID.has(workflowCandidate as WorkforceAppfolioWorkflowId)) {
    return {
      ok: true,
      workflowId: workflowCandidate as WorkforceAppfolioWorkflowId,
      matchedBy: "workflow_id",
      normalized: workflowCandidate,
      confidence: 1,
    };
  }

  const normalized = normalizeShortcutInput(input);
  if (!normalized) {
    return {
      ok: false,
      reason: "no_match",
      normalized,
      confidence: 0,
    };
  }

  const matches = WORKFLOW_SHORTCUT_PHRASES.filter((entry) => hasWholePhrase(normalized, entry.phrase));
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      normalized,
      confidence: 0,
    };
  }

  const longest = matches[0]?.phrase.length ?? 0;
  const strongest = matches.filter((entry) => entry.phrase.length === longest);
  const candidates = Array.from(new Set(strongest.map((entry) => entry.workflowId)));
  if (candidates.length !== 1) {
    return {
      ok: false,
      reason: "ambiguous",
      normalized,
      confidence: 0.45,
      candidates,
      clarificationPrompt: buildWorkflowClarificationPrompt(candidates),
    };
  }

  return {
    ok: true,
    workflowId: candidates[0]!,
    matchedBy: "shortcut",
    normalized,
    confidence: clampNumber(0.9 + longest / 100, 0.9, 0.98),
    matchedPhrase: strongest[0]?.phrase,
  };
}

export function resolveWorkforceAppfolioReportPresetShortcut(
  input: string,
): WorkforceAppfolioReportShortcutResolution {
  const presetCandidate = normalizePresetIdCandidate(input);
  if (presetCandidate && PRESET_BY_ID.has(presetCandidate as WorkforceAppfolioReportPresetId)) {
    return {
      ok: true,
      presetId: presetCandidate as WorkforceAppfolioReportPresetId,
      matchedBy: "preset_id",
      normalized: presetCandidate,
      confidence: 1,
      allMatches: [presetCandidate as WorkforceAppfolioReportPresetId],
    };
  }

  const normalized = normalizeShortcutInput(input);
  if (!normalized) {
    return {
      ok: false,
      reason: "no_match",
      normalized,
      confidence: 0,
    };
  }

  const reportNamePreset = REPORT_NAME_TO_PRESET_ID.get(normalized);
  if (reportNamePreset) {
    return {
      ok: true,
      presetId: reportNamePreset,
      matchedBy: "report_name",
      normalized,
      confidence: 0.99,
      allMatches: [reportNamePreset],
    };
  }

  const phraseMatches = SHORTCUT_PHRASES.filter((entry) => hasWholePhrase(normalized, entry.phrase));
  if (phraseMatches.length > 0) {
    const longest = phraseMatches[0]?.phrase.length ?? 0;
    const strongest = phraseMatches.filter((entry) => entry.phrase.length === longest);
    const candidates = Array.from(new Set(strongest.map((entry) => entry.presetId)));
    if (candidates.length !== 1) {
      return {
        ok: false,
        reason: "ambiguous",
        normalized,
        confidence: 0.45,
        candidates,
        clarificationPrompt: buildPresetClarificationPrompt(candidates),
      };
    }
    return {
      ok: true,
      presetId: candidates[0]!,
      matchedBy: "shortcut",
      normalized,
      confidence: clampNumber(0.9 + longest / 100, 0.9, 0.98),
      matchedPhrase: strongest[0]?.phrase,
      allMatches: candidates,
    };
  }

  const keywordMatch = resolveByKeywords(normalized);
  if (!keywordMatch) {
    return {
      ok: false,
      reason: "no_match",
      normalized,
      confidence: 0,
    };
  }
  if (keywordMatch.ambiguous && keywordMatch.ambiguous.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      normalized,
      confidence: keywordMatch.confidence,
      candidates: keywordMatch.ambiguous,
      clarificationPrompt: buildPresetClarificationPrompt(keywordMatch.ambiguous),
    };
  }
  return {
    ok: true,
    presetId: keywordMatch.presetId,
    matchedBy: "keyword",
    normalized,
    confidence: keywordMatch.confidence,
    allMatches: [keywordMatch.presetId],
  };
}

export function getWorkforceAppfolioReportPreset(
  presetId: WorkforceAppfolioReportPresetId,
): WorkforceAppfolioReportPresetDefinition {
  return PRESET_BY_ID.get(presetId)!;
}

export function listWorkforceAppfolioReportPresets(nowMs = Date.now()): WorkforceAppfolioReportPreset[] {
  return WORKFORCE_APPFOLIO_REPORT_PRESET_DEFINITIONS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    reportName: preset.reportName,
    seatId: preset.seatId,
    defaultIntervalMs: preset.defaultIntervalMs,
    defaultPayload: preset.buildPayload(nowMs),
  }));
}

export function getWorkforceAppfolioWorkflow(
  workflowId: WorkforceAppfolioWorkflowId,
): WorkforceAppfolioWorkflowDefinition {
  return WORKFLOW_BY_ID.get(workflowId)!;
}

export function listWorkforceAppfolioWorkflows(): WorkforceAppfolioWorkflow[] {
  return WORKFORCE_APPFOLIO_WORKFLOW_DEFINITIONS.map((workflow) => ({
    id: workflow.id,
    label: workflow.label,
    description: workflow.description,
    presetIds: workflow.presetIds,
  }));
}

export function actionForWorkforceAppfolioReportPreset(presetId: WorkforceAppfolioReportPresetId): string {
  return `appfolio.report.run:${presetId}`;
}

export function actionForWorkforceAppfolioWorkflow(workflowId: WorkforceAppfolioWorkflowId): string {
  return `appfolio.workflow.run:${workflowId}`;
}

export function buildWorkforceAppfolioReportPayload(
  presetId: WorkforceAppfolioReportPresetId,
  nowMs = Date.now(),
): Record<string, unknown> {
  return getWorkforceAppfolioReportPreset(presetId).buildPayload(nowMs);
}
