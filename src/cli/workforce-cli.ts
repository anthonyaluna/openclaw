import { readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import {
  actionForWorkforceAppfolioReportPreset,
  actionForWorkforceAppfolioWorkflow,
  listWorkforceAppfolioReportPresets,
  listWorkforceAppfolioWorkflows,
  type WorkforceAppfolioWorkflowId,
  type WorkforceAppfolioReportPresetId,
} from "../workforce/appfolio-reports.js";
import { addGatewayClientOptions, callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";

type WorkforceStatusResult = {
  readiness: "ready" | "degraded";
  nextSteps?: Array<{
    title?: string;
    detail?: string;
    priority?: "high" | "medium" | "low";
    seatId?: string;
    action?: string;
  }>;
  summary?: {
    seats?: number;
    queues?: number;
    schedules?: number;
    pendingDecisions?: number;
    blocked?: number;
    recentRuns24h?: number;
    queuesPressured?: number;
    autonomy?: {
      autonomous?: number;
      supervised?: number;
      manual?: number;
    };
  };
};

type WorkforceActionExecuteResult = {
  policy?: string;
  run?: {
    status?: string;
    summary?: string;
  };
  appfolioReport?: {
    ok?: boolean;
    presetId?: string;
    reportName?: string;
    count?: number | null;
    pagesFetched?: number;
    warnings?: string[];
    validationErrors?: string[];
    error?: string;
  };
};

function toNumber(input: unknown, fallback: number) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function printJsonIfRequested(opts: GatewayRpcOpts, payload: unknown): boolean {
  if (!opts.json) {
    return false;
  }
  defaultRuntime.log(JSON.stringify(payload, null, 2));
  return true;
}

function ensureJsonRecord(parsed: unknown, optionName: string): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON for ${optionName}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeJsonCandidate(raw: string): string {
  return raw
    .trim()
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'");
}

function stripMatchingOuterQuotes(raw: string): string {
  if (raw.length < 2) {
    return raw;
  }
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function normalizeLegacyObjectLiteral(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return raw;
  }

  const quotedKeys = trimmed.replaceAll(
    /([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g,
    '$1"$2"$3',
  );

  return quotedKeys.replaceAll(
    /:\s*([^,\]}]+)(\s*[,}])/g,
    (_match: string, tokenRaw: string, suffix: string) => {
      const token = tokenRaw.trim();
      if (!token) {
        return `: ${token}${suffix}`;
      }
      if (
        token.startsWith('"') ||
        token.startsWith("'") ||
        token.startsWith("{") ||
        token.startsWith("[")
      ) {
        return `: ${token}${suffix}`;
      }
      if (token === "true" || token === "false" || token === "null") {
        return `: ${token}${suffix}`;
      }
      if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
        return `: ${token}${suffix}`;
      }
      const escaped = token.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      return `: "${escaped}"${suffix}`;
    },
  );
}

export function parseWorkforceFiltersJson(
  raw: string,
  optionName = "--filters-json",
): Record<string, unknown> {
  const normalized = normalizeJsonCandidate(raw);
  const candidates = new Set<string>();
  const add = (candidate: string) => {
    const value = candidate.trim();
    if (value) {
      candidates.add(value);
    }
  };

  add(normalized);
  add(stripMatchingOuterQuotes(normalized));

  const unescapedDoubleQuotes = normalized.replaceAll('\\"', '"').replaceAll('""', '"');
  add(unescapedDoubleQuotes);
  add(stripMatchingOuterQuotes(unescapedDoubleQuotes));

  const unescapedSingleQuotes = normalized.replaceAll("\\'", "'");
  add(unescapedSingleQuotes);
  add(stripMatchingOuterQuotes(unescapedSingleQuotes));
  add(normalizeLegacyObjectLiteral(normalized));
  add(normalizeLegacyObjectLiteral(unescapedDoubleQuotes));
  add(normalizeLegacyObjectLiteral(unescapedSingleQuotes));

  let parseError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "string") {
        const nested = JSON.parse(parsed) as unknown;
        return ensureJsonRecord(nested, optionName);
      }
      return ensureJsonRecord(parsed, optionName);
    } catch (error) {
      parseError = error;
    }
  }

  throw new Error(
    `Invalid JSON for ${optionName}: ${String(parseError)}. Try --filters-json '{"key":"value"}' or --filters-json-file path/to/file.json`,
    { cause: parseError },
  );
}

export function parseWorkforceFiltersJsonFile(filePath: string): Record<string, unknown> {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    throw new Error(`Failed to read --filters-json-file: ${resolved}: ${String(error)}`, {
      cause: error,
    });
  }
  return parseWorkforceFiltersJson(raw, "--filters-json-file");
}

function ensureNestedJsonRecords(
  parsed: Record<string, unknown>,
  optionName: string,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Invalid JSON for ${optionName}: expected each key to map to a JSON object (${key})`,
      );
    }
    result[key] = value as Record<string, unknown>;
  }
  return result;
}

export function parseWorkforceFiltersByPresetJson(
  raw: string,
  optionName = "--filters-by-preset-json",
): Record<string, Record<string, unknown>> {
  const parsed = parseWorkforceFiltersJson(raw, optionName);
  return ensureNestedJsonRecords(parsed, optionName);
}

export function parseWorkforceFiltersByPresetJsonFile(
  filePath: string,
): Record<string, Record<string, unknown>> {
  const parsed = parseWorkforceFiltersJsonFile(filePath);
  return ensureNestedJsonRecords(parsed, "--filters-by-preset-file");
}

function resolvePresetIdsFromOption(
  option: string[] | undefined,
): WorkforceAppfolioReportPresetId[] {
  const presets = listWorkforceAppfolioReportPresets();
  const allowed = new Set(presets.map((preset) => preset.id));
  if (!option || option.length === 0) {
    return presets.map((preset) => preset.id);
  }
  const selected: WorkforceAppfolioReportPresetId[] = [];
  for (const raw of option) {
    const id = raw.trim() as WorkforceAppfolioReportPresetId;
    if (!allowed.has(id)) {
      throw new Error(`Unknown preset: ${raw}`);
    }
    if (!selected.includes(id)) {
      selected.push(id);
    }
  }
  return selected;
}

function resolveWorkflowId(raw: string): WorkforceAppfolioWorkflowId {
  const workflows = listWorkforceAppfolioWorkflows();
  const normalized = raw.trim().toLowerCase();
  const workflow = workflows.find((entry) => entry.id === normalized);
  if (!workflow) {
    throw new Error(`Unknown workflow: ${raw}`);
  }
  return workflow.id;
}

function isLegacyWritebackGateBlock(result: WorkforceActionExecuteResult): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }
  return (
    result.policy === "block" &&
    result.run?.status === "blocked" &&
    result.run?.summary === "appfolio_action_requires_writeback_gate"
  );
}

function renderWorkforceStatus(payload: WorkforceStatusResult) {
  const rich = isRich();
  const readinessColor = payload.readiness === "ready" ? theme.success : theme.warn;
  defaultRuntime.log(
    `${colorize(rich, theme.heading, "Workforce Status")} ${colorize(rich, readinessColor, payload.readiness.toUpperCase())}`,
  );
  const summary = payload.summary ?? {};
  defaultRuntime.log(`Seats: ${summary.seats ?? 0}`);
  defaultRuntime.log(`Queues: ${summary.queues ?? 0}`);
  defaultRuntime.log(`Schedules: ${summary.schedules ?? 0}`);
  defaultRuntime.log(`Pending decisions: ${summary.pendingDecisions ?? 0}`);
  defaultRuntime.log(`Blocked runs: ${summary.blocked ?? 0}`);
  defaultRuntime.log(`Recent runs (24h): ${summary.recentRuns24h ?? 0}`);
  defaultRuntime.log(`Pressured queues: ${summary.queuesPressured ?? 0}`);
  if (summary.autonomy) {
    defaultRuntime.log(
      `Autonomy: autonomous=${summary.autonomy.autonomous ?? 0}, supervised=${summary.autonomy.supervised ?? 0}, manual=${summary.autonomy.manual ?? 0}`,
    );
  }
  if (payload.nextSteps && payload.nextSteps.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(colorize(rich, theme.heading, "Next Steps"));
    for (const step of payload.nextSteps.slice(0, 5)) {
      defaultRuntime.log(`- [${step.priority ?? "medium"}] ${step.title ?? "Step"}`);
      if (step.detail) {
        defaultRuntime.log(`  ${step.detail}`);
      }
      if (step.seatId && step.action) {
        defaultRuntime.log(`  action: openclaw workforce action ${step.seatId} ${step.action}`);
      }
    }
  }
}

function renderNextStepsOnly(payload: WorkforceStatusResult) {
  const rich = isRich();
  const steps = payload.nextSteps ?? [];
  if (steps.length === 0) {
    defaultRuntime.log("No next steps available.");
    return;
  }
  defaultRuntime.log(colorize(rich, theme.heading, "Workforce Next Steps"));
  for (const step of steps) {
    defaultRuntime.log(`- [${step.priority ?? "medium"}] ${step.title ?? "Step"}`);
    if (step.detail) {
      defaultRuntime.log(`  ${step.detail}`);
    }
    if (step.seatId && step.action) {
      defaultRuntime.log(`  action: openclaw workforce action ${step.seatId} ${step.action}`);
    }
  }
}

export function registerWorkforceCli(program: Command) {
  const workforce = program
    .command("workforce")
    .description("Workforce orchestration (via Gateway)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/workforce", "docs.openclaw.ai/workforce")}\n`,
    );

  addGatewayClientOptions(
    workforce
      .command("status")
      .description("Show workforce readiness, queues, and schedules")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts) => {
        const result = (await callGatewayFromCli(
          "workforce.status",
          opts,
          {},
        )) as WorkforceStatusResult;
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        renderWorkforceStatus(result);
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("init")
      .description("Initialize or reinitialize workforce state")
      .option("--force", "Reinitialize even when state exists", false)
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { force?: boolean }) => {
        const result = await callGatewayFromCli("workforce.init", opts, {
          force: Boolean(opts.force),
        });
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log("Workforce initialized.");
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("next-steps")
      .description("Show actionable workforce next steps")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts) => {
        const result = (await callGatewayFromCli(
          "workforce.status",
          opts,
          {},
        )) as WorkforceStatusResult;
        if (printJsonIfRequested(opts, result.nextSteps ?? [])) {
          return;
        }
        renderNextStepsOnly(result);
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("runs")
      .description("List workforce runs")
      .option("--limit <n>", "Number of runs", "100")
      .option("--query <text>", "Search query")
      .option("--status <status>", "Filter status")
      .option("--json", "Output JSON", false)
      .action(
        async (opts: GatewayRpcOpts & { limit?: string; query?: string; status?: string }) => {
          const result = await callGatewayFromCli("workforce.runs", opts, {
            limit: toNumber(opts.limit, 100),
            query: opts.query,
            status: opts.status,
          });
          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(JSON.stringify(result, null, 2));
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("decisions")
      .description("List workforce decision cards")
      .option("--limit <n>", "Number of decisions", "100")
      .option("--status <status>", "pending|resolved")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { limit?: string; status?: string }) => {
        const result = await callGatewayFromCli("workforce.decisions", opts, {
          limit: toNumber(opts.limit, 100),
          status: opts.status,
        });
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("schedules")
      .description("List workforce schedules")
      .option("--limit <n>", "Number of schedules", "200")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { limit?: string }) => {
        const result = await callGatewayFromCli("workforce.schedules", opts, {
          limit: toNumber(opts.limit, 200),
        });
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("ledger")
      .description("List receipts, replay frames, and decisions")
      .option("--limit <n>", "Number of ledger entries", "200")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { limit?: string }) => {
        const result = await callGatewayFromCli("workforce.ledger", opts, {
          limit: toNumber(opts.limit, 200),
        });
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("workspace")
      .description("Show AppFolio workspace policy state")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts) => {
        const result = await callGatewayFromCli("workforce.workspace", opts, {});
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("resolve")
      .description("Resolve a workforce decision card")
      .argument("<decisionId>", "Decision ID")
      .option("--allow", "Resolve as allow")
      .option("--deny", "Resolve as deny")
      .option("--actor <actor>", "Actor name", "operator")
      .option("--json", "Output JSON", false)
      .action(
        async (
          decisionId: string,
          opts: GatewayRpcOpts & { allow?: boolean; deny?: boolean; actor?: string },
        ) => {
          const resolution = opts.deny ? "deny" : "allow";
          const result = await callGatewayFromCli("workforce.decision.resolve", opts, {
            decisionId,
            resolution,
            actor: opts.actor,
          });
          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(`Decision ${decisionId} resolved: ${resolution}`);
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("action")
      .description("Execute a workforce action through policy gates")
      .argument("<seatId>", "Seat ID")
      .argument("<action>", "Action label")
      .option("--actor <actor>", "Actor name", "operator")
      .option("--source <source>", "chat|subagent|cron|workforce", "workforce")
      .option("--require-writeback-receipt", "Require writeback receipt", false)
      .option(
        "--no-auto-writeback",
        "Disable auto-recording of a writeback receipt when one is required",
      )
      .option("--writeback-receipt-id <id>", "Receipt ID for AppFolio writeback")
      .option("--json", "Output JSON", false)
      .action(
        async (
          seatId: string,
          action: string,
          opts: GatewayRpcOpts & {
            actor?: string;
            source?: "chat" | "subagent" | "cron" | "workforce";
            requireWritebackReceipt?: boolean;
            autoWriteback?: boolean;
            writebackReceiptId?: string;
          },
        ) => {
          const requiresWriteback = Boolean(opts.requireWritebackReceipt);
          let writebackReceiptId = opts.writebackReceiptId?.trim() || undefined;
          if (requiresWriteback && !writebackReceiptId && opts.autoWriteback !== false) {
            const writeback = (await callGatewayFromCli("workforce.appfolio.writeback", opts, {
              actor: opts.actor,
              note: `Auto writeback for action: ${action}`,
            })) as { receipt?: { receiptId?: string } };
            writebackReceiptId = writeback.receipt?.receiptId?.trim() || undefined;
          }
          const payload = writebackReceiptId ? { writebackReceiptId } : undefined;
          const result = await callGatewayFromCli("workforce.action.execute", opts, {
            seatId,
            action,
            actor: opts.actor,
            source: opts.source,
            requireWritebackReceipt: requiresWriteback,
            payload,
          });
          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(JSON.stringify(result, null, 2));
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("schedule-add")
      .description("Add a workforce schedule")
      .argument("<seatId>", "Seat ID")
      .argument("<name>", "Schedule name")
      .argument("<intervalMs>", "Interval in milliseconds")
      .argument("<action>", "Action label")
      .option("--json", "Output JSON", false)
      .action(
        async (
          seatId: string,
          name: string,
          intervalMs: string,
          action: string,
          opts: GatewayRpcOpts,
        ) => {
          const result = await callGatewayFromCli("workforce.schedule.add", opts, {
            seatId,
            name,
            intervalMs: toNumber(intervalMs, 60_000),
            action,
          });
          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log("Schedule added.");
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("tick")
      .description("Run one scheduler tick immediately")
      .option("--actor <actor>", "Actor name", "operator")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { actor?: string }) => {
        const result = await callGatewayFromCli("workforce.tick", opts, { actor: opts.actor });
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-reports-probe")
      .description("Probe AppFolio Reports API credentials and endpoint access")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts) => {
        const result = await callGatewayFromCli("workforce.appfolio.reports.probe", opts, {});
        if (printJsonIfRequested(opts, result)) {
          return;
        }
        defaultRuntime.log(JSON.stringify(result, null, 2));
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-reports-presets")
      .description("List built-in AppFolio report jobs and default schedules")
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts) => {
        const presets = listWorkforceAppfolioReportPresets();
        if (printJsonIfRequested(opts, presets)) {
          return;
        }
        defaultRuntime.log("AppFolio report presets:");
        for (const preset of presets) {
          defaultRuntime.log(
            `- ${preset.id} (${preset.reportName}) seat=${preset.seatId} intervalMs=${preset.defaultIntervalMs}`,
          );
          defaultRuntime.log(`  ${preset.description}`);
        }
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-report-run")
      .description("Run a built-in AppFolio report job through Workforce actions")
      .argument(
        "<presetId>",
        listWorkforceAppfolioReportPresets()
          .map((preset) => preset.id)
          .join("|"),
      )
      .option("--actor <actor>", "Actor name", "operator")
      .option("--source <source>", "chat|subagent|cron|workforce", "workforce")
      .option("--filters-json <json>", "JSON object merged into default report filters")
      .option("--filters-json-file <path>", "Path to JSON file merged into default report filters")
      .option("--json", "Output JSON", false)
      .action(
        async (
          presetId: string,
          opts: GatewayRpcOpts & {
            actor?: string;
            source?: "chat" | "subagent" | "cron" | "workforce";
            filtersJson?: string;
            filtersJsonFile?: string;
          },
        ) => {
          const preset = listWorkforceAppfolioReportPresets().find(
            (entry) => entry.id === presetId,
          );
          if (!preset) {
            throw new Error(`Unknown preset: ${presetId}`);
          }
          const fileFilters = opts.filtersJsonFile
            ? parseWorkforceFiltersJsonFile(opts.filtersJsonFile)
            : undefined;
          const inlineFilters = opts.filtersJson
            ? opts.filtersJson.trim().startsWith("@")
              ? parseWorkforceFiltersJsonFile(opts.filtersJson.trim().slice(1))
              : parseWorkforceFiltersJson(opts.filtersJson)
            : undefined;
          const reportFilters =
            fileFilters || inlineFilters
              ? { ...(fileFilters ?? {}), ...(inlineFilters ?? {}) }
              : undefined;
          const action = actionForWorkforceAppfolioReportPreset(preset.id);
          let result = (await callGatewayFromCli("workforce.action.execute", opts, {
            seatId: preset.seatId,
            action,
            actor: opts.actor,
            source: opts.source,
            payload: reportFilters ? { reportFilters } : undefined,
          })) as WorkforceActionExecuteResult;

          // Compatibility path: older gateway policy builds may gate all appfolio.* actions
          // behind writeback receipts. Retry once with an auto-generated receipt.
          if (isLegacyWritebackGateBlock(result)) {
            const writeback = (await callGatewayFromCli("workforce.appfolio.writeback", opts, {
              actor: opts.actor,
              note: `Compat writeback for report job: ${preset.id}`,
            })) as { receipt?: { receiptId?: string } };
            const writebackReceiptId = writeback.receipt?.receiptId?.trim() || undefined;
            if (writebackReceiptId) {
              result = (await callGatewayFromCli("workforce.action.execute", opts, {
                seatId: preset.seatId,
                action,
                actor: opts.actor,
                source: opts.source,
                requireWritebackReceipt: true,
                payload: {
                  ...(reportFilters ? { reportFilters } : {}),
                  writebackReceiptId,
                },
              })) as WorkforceActionExecuteResult;
            }
          }

          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(JSON.stringify(result, null, 2));
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-workflow-run")
      .description("Run a built-in AppFolio workflow through Workforce actions")
      .argument(
        "<workflowId>",
        listWorkforceAppfolioWorkflows()
          .map((workflow) => workflow.id)
          .join("|"),
      )
      .option("--actor <actor>", "Actor name", "operator")
      .option("--source <source>", "chat|subagent|cron|workforce", "workforce")
      .option("--filters-json <json>", "Global JSON object merged into workflow report filters")
      .option("--filters-json-file <path>", "Path to global JSON filters for workflow reports")
      .option(
        "--filters-by-preset-json <json>",
        "JSON object keyed by preset ID with per-preset filter overrides",
      )
      .option(
        "--filters-by-preset-file <path>",
        "Path to JSON object keyed by preset ID with per-preset filter overrides",
      )
      .option("--row-limit <n>", "Maximum paginated rows per report step", "15000")
      .option(
        "--no-include-rows",
        "Disable fetching row payloads for workflows that support row-based summaries (default: include rows)",
      )
      .option("--require-writeback-receipt", "Require writeback receipt", false)
      .option(
        "--no-auto-writeback",
        "Disable auto-recording of a writeback receipt when one is required",
      )
      .option("--writeback-receipt-id <id>", "Receipt ID for AppFolio writeback")
      .option("--json", "Output JSON", false)
      .action(
        async (
          workflowIdRaw: string,
          opts: GatewayRpcOpts & {
            actor?: string;
            source?: "chat" | "subagent" | "cron" | "workforce";
            filtersJson?: string;
            filtersJsonFile?: string;
            filtersByPresetJson?: string;
            filtersByPresetFile?: string;
            rowLimit?: string;
            includeRows?: boolean;
            requireWritebackReceipt?: boolean;
            autoWriteback?: boolean;
            writebackReceiptId?: string;
          },
        ) => {
          const workflowId = resolveWorkflowId(workflowIdRaw);
          const workflow = listWorkforceAppfolioWorkflows().find(
            (entry) => entry.id === workflowId,
          );
          if (!workflow) {
            throw new Error(`Unknown workflow: ${workflowIdRaw}`);
          }

          const fileFilters = opts.filtersJsonFile
            ? parseWorkforceFiltersJsonFile(opts.filtersJsonFile)
            : undefined;
          const inlineFilters = opts.filtersJson
            ? opts.filtersJson.trim().startsWith("@")
              ? parseWorkforceFiltersJsonFile(opts.filtersJson.trim().slice(1))
              : parseWorkforceFiltersJson(opts.filtersJson)
            : undefined;
          const reportFilters =
            fileFilters || inlineFilters
              ? { ...(fileFilters ?? {}), ...(inlineFilters ?? {}) }
              : undefined;

          const fileFiltersByPreset = opts.filtersByPresetFile
            ? parseWorkforceFiltersByPresetJsonFile(opts.filtersByPresetFile)
            : undefined;
          const inlineFiltersByPreset = opts.filtersByPresetJson
            ? opts.filtersByPresetJson.trim().startsWith("@")
              ? parseWorkforceFiltersByPresetJsonFile(opts.filtersByPresetJson.trim().slice(1))
              : parseWorkforceFiltersByPresetJson(opts.filtersByPresetJson)
            : undefined;
          const filtersByPreset =
            fileFiltersByPreset || inlineFiltersByPreset
              ? { ...(fileFiltersByPreset ?? {}), ...(inlineFiltersByPreset ?? {}) }
              : undefined;

          const requiresWriteback = Boolean(opts.requireWritebackReceipt);
          let writebackReceiptId = opts.writebackReceiptId?.trim() || undefined;
          if (requiresWriteback && !writebackReceiptId && opts.autoWriteback !== false) {
            const writeback = (await callGatewayFromCli("workforce.appfolio.writeback", opts, {
              actor: opts.actor,
              note: `Auto writeback for workflow: ${workflow.id}`,
            })) as { receipt?: { receiptId?: string } };
            writebackReceiptId = writeback.receipt?.receiptId?.trim() || undefined;
          }

          const maxRows = Math.max(1, toNumber(opts.rowLimit, 15000));
          const action = actionForWorkforceAppfolioWorkflow(workflow.id);
          let actionResult = (await callGatewayFromCli("workforce.action.execute", opts, {
            seatId: "queue-manager",
            action,
            actor: opts.actor,
            source: opts.source,
            requireWritebackReceipt: requiresWriteback,
            payload: {
              ...(reportFilters ? { reportFilters } : {}),
              ...(filtersByPreset ? { filtersByPreset } : {}),
              includeRows: opts.includeRows !== false,
              rowLimit: maxRows,
              ...(writebackReceiptId ? { writebackReceiptId } : {}),
            },
          })) as WorkforceActionExecuteResult;

          if (
            isLegacyWritebackGateBlock(actionResult) &&
            requiresWriteback &&
            !writebackReceiptId &&
            opts.autoWriteback !== false
          ) {
            const writeback = (await callGatewayFromCli("workforce.appfolio.writeback", opts, {
              actor: opts.actor,
              note: `Compat writeback for workflow: ${workflow.id}`,
            })) as { receipt?: { receiptId?: string } };
            writebackReceiptId = writeback.receipt?.receiptId?.trim() || undefined;
            if (writebackReceiptId) {
              actionResult = (await callGatewayFromCli("workforce.action.execute", opts, {
                seatId: "queue-manager",
                action,
                actor: opts.actor,
                source: opts.source,
                requireWritebackReceipt: true,
                payload: {
                  ...(reportFilters ? { reportFilters } : {}),
                  ...(filtersByPreset ? { filtersByPreset } : {}),
                  includeRows: opts.includeRows !== false,
                  rowLimit: maxRows,
                  writebackReceiptId,
                },
              })) as WorkforceActionExecuteResult;
            }
          }

          const result = {
            workflow,
            entrySeatId: "queue-manager",
            action,
            writebackReceiptId: writebackReceiptId ?? null,
            result: actionResult,
          };

          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(JSON.stringify(result, null, 2));
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-schedules-install")
      .description("Install default recurring schedules for built-in AppFolio report jobs")
      .option(
        "--preset <id>",
        "Install only specified preset(s); can be used multiple times",
        (value: string, previous: string[]) => [...previous, value],
        [],
      )
      .option("--json", "Output JSON", false)
      .action(async (opts: GatewayRpcOpts & { preset?: string[] }) => {
        const selectedPresetIds = resolvePresetIdsFromOption(opts.preset);
        const selected = listWorkforceAppfolioReportPresets().filter((preset) =>
          selectedPresetIds.includes(preset.id),
        );
        const schedules = (await callGatewayFromCli("workforce.schedules", opts, {
          limit: 5000,
        })) as { schedules?: Array<{ id: string; action: string }> };
        const existingActions = new Set((schedules.schedules ?? []).map((entry) => entry.action));

        const installed: Array<{ presetId: string; scheduleId: string }> = [];
        const skipped: Array<{ presetId: string; reason: string }> = [];

        for (const preset of selected) {
          const action = actionForWorkforceAppfolioReportPreset(preset.id);
          if (existingActions.has(action)) {
            skipped.push({ presetId: preset.id, reason: "already_installed" });
            continue;
          }
          const schedule = (await callGatewayFromCli("workforce.schedule.add", opts, {
            seatId: preset.seatId,
            name: `AppFolio ${preset.label}`,
            intervalMs: preset.defaultIntervalMs,
            action,
          })) as { id?: string };
          installed.push({ presetId: preset.id, scheduleId: schedule.id ?? "unknown" });
          existingActions.add(action);
        }

        const payload = { installed, skipped };
        if (printJsonIfRequested(opts, payload)) {
          return;
        }
        defaultRuntime.log(`Installed schedules: ${installed.length}`);
        for (const item of installed) {
          defaultRuntime.log(`- ${item.presetId} (${item.scheduleId})`);
        }
        if (skipped.length > 0) {
          defaultRuntime.log(`Skipped: ${skipped.length}`);
          for (const item of skipped) {
            defaultRuntime.log(`- ${item.presetId}: ${item.reason}`);
          }
        }
      }),
  );

  addGatewayClientOptions(
    workforce
      .command("appfolio-workflow-schedule-install")
      .description("Install a recurring schedule for a built-in AppFolio workflow (runs via Workforce scheduler)")
      .argument("<workflowId>", "smart_bill_triage|smart_bill_reconcile|smart_bill_daily")
      .option("--every <duration>", "Interval (e.g. 30m, 6h, 1d)", "1d")
      .option("--seat <seatId>", "Seat to attribute the workflow run to", "queue-manager")
      .option("--json", "Output JSON", false)
      .action(
        async (
          workflowId: string,
          opts: GatewayRpcOpts & { every?: string; seat?: string; json?: boolean },
        ) => {
          const workflows = listWorkforceAppfolioWorkflows();
          const workflow = workflows.find((entry) => entry.id === workflowId);
          if (!workflow) {
            throw new Error(`Unknown workflow: ${workflowId}`);
          }

          const everyRaw = typeof opts.every === "string" ? opts.every.trim() : "";
          const match = everyRaw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
          if (!match) {
            throw new Error("--every must be a duration like 30m, 6h, 1d");
          }
          const n = Number.parseFloat(match[1] ?? "");
          if (!Number.isFinite(n) || n <= 0) {
            throw new Error("--every must be a positive duration");
          }
          const unit = (match[2] ?? "").toLowerCase();
          const factor =
            unit === "ms"
              ? 1
              : unit === "s"
                ? 1000
                : unit === "m"
                  ? 60_000
                  : unit === "h"
                    ? 3_600_000
                    : 86_400_000;
          const intervalMs = Math.max(60_000, Math.floor(n * factor));

          const seatId = typeof opts.seat === "string" && opts.seat.trim() ? opts.seat.trim() : "queue-manager";
          const action = `appfolio.workflow.run:${workflow.id}`;

          const result = await callGatewayFromCli("workforce.schedule.add", opts, {
            seatId,
            name: `AppFolio Workflow: ${workflow.label}`,
            intervalMs,
            action,
          });

          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log("Workflow schedule installed.");
        },
      ),
  );

  addGatewayClientOptions(
    workforce
      .command("writeback")
      .description("Record an AppFolio writeback receipt")
      .option("--actor <actor>", "Actor name", "workspace")
      .option("--note <note>", "Writeback note")
      .option("--artifact <artifact>", "Artifact reference")
      .option("--json", "Output JSON", false)
      .action(
        async (opts: GatewayRpcOpts & { actor?: string; note?: string; artifact?: string }) => {
          const result = await callGatewayFromCli("workforce.appfolio.writeback", opts, {
            actor: opts.actor,
            note: opts.note,
            artifact: opts.artifact,
          });
          if (printJsonIfRequested(opts, result)) {
            return;
          }
          defaultRuntime.log(JSON.stringify(result, null, 2));
        },
      ),
  );
}
