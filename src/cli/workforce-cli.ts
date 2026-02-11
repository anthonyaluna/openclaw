import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
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
            writebackReceiptId?: string;
          },
        ) => {
          const payload = opts.writebackReceiptId
            ? { writebackReceiptId: opts.writebackReceiptId }
            : undefined;
          const result = await callGatewayFromCli("workforce.action.execute", opts, {
            seatId,
            action,
            actor: opts.actor,
            source: opts.source,
            requireWritebackReceipt: Boolean(opts.requireWritebackReceipt),
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
