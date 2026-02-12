import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWorkforceSchedule,
  executeWorkforceAction,
  getWorkforceStatus,
  initializeWorkforceStore,
  listWorkforceDecisions,
  recordAppfolioWritebackReceipt,
  resolveWorkforceDecision,
  tickWorkforceSchedules,
} from "./service.js";

const testRoots: string[] = [];
const APPFOLIO_ENV_KEYS = [
  "OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE",
  "OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID",
  "OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET",
  "OPENCLAW_APPFOLIO_REPORTS_DATABASE",
] as const;
const originalAppfolioEnv = Object.fromEntries(
  APPFOLIO_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof APPFOLIO_ENV_KEYS)[number], string | undefined>;

function makeStorePath() {
  const root = path.join(
    os.tmpdir(),
    "openclaw-workforce-tests",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  testRoots.push(root);
  return path.join(root, "state.json");
}

afterEach(async () => {
  await Promise.all(
    testRoots.splice(0).map(async (root) => {
      try {
        await fs.rm(root, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }),
  );
  for (const key of APPFOLIO_ENV_KEYS) {
    if (typeof originalAppfolioEnv[key] === "undefined") {
      delete process.env[key];
      continue;
    }
    process.env[key] = originalAppfolioEnv[key];
  }
  vi.unstubAllGlobals();
});

describe("workforce service", () => {
  it("initializes default workforce state", async () => {
    const storePath = makeStorePath();
    const init = await initializeWorkforceStore({ storePath, force: true });
    expect(init.ok).toBe(true);

    const status = await getWorkforceStatus({ storePath });
    expect(status.summary.seats).toBeGreaterThan(0);
    expect(status.summary.queues).toBe(status.summary.seats);
    expect(status.summary.schedules).toBe(status.summary.seats);
    expect(status.summary.autonomy.autonomous).toBeGreaterThan(0);
    expect(status.nextSteps.length).toBeGreaterThan(0);
  });

  it("escalates manual seat actions into decision cards", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });

    const action = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "ui-operator",
        action: "review.ui",
        actor: "test",
      },
    });
    expect(action.policy).toBe("escalate");
    expect(action.decision?.status).toBe("pending");

    const decisions = await listWorkforceDecisions({ storePath, status: "pending" });
    expect(decisions.decisions.length).toBeGreaterThan(0);
  });

  it("enforces writeback receipt policy for appfolio actions", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });

    const blocked = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.comms.broadcast",
        requireWritebackReceipt: true,
        payload: {},
      },
    });
    expect(blocked.policy).toBe("block");
    expect(blocked.run.status).toBe("blocked");

    const receipt = await recordAppfolioWritebackReceipt({
      storePath,
      actor: "test",
      note: "writeback complete",
    });
    const allowed = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.comms.broadcast",
        requireWritebackReceipt: true,
        payload: { writebackReceiptId: receipt.receiptId },
      },
    });
    expect(allowed.policy).toBe("allow");
    expect(allowed.run.status).toBe("ok");
  });

  it("blocks appfolio actions when writeback gating is not enabled in the request", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    const blocked = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.comms.broadcast",
      },
    });
    expect(blocked.policy).toBe("block");
    expect(blocked.run.summary).toBe("appfolio_action_requires_writeback_gate");
    const status = await getWorkforceStatus({ storePath });
    expect(status.nextSteps.some((step) => step.id === "clear-blocked-run")).toBe(true);
  });

  it("clears blocked status after the same action succeeds later", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });

    const blocked = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.comms.broadcast.owner-update",
        requireWritebackReceipt: true,
        payload: {},
      },
    });
    expect(blocked.policy).toBe("block");

    const writeback = await recordAppfolioWritebackReceipt({
      storePath,
      actor: "test",
      note: "writeback complete",
    });

    const allowed = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.comms.broadcast.owner-update",
        requireWritebackReceipt: true,
        payload: { writebackReceiptId: writeback.receiptId },
      },
    });
    expect(allowed.policy).toBe("allow");

    const status = await getWorkforceStatus({ storePath });
    expect(status.summary.blocked).toBe(0);
    expect(status.nextSteps.some((step) => step.id === "clear-blocked-run")).toBe(false);
  });

  it("applies strict change control profile for security and deploy actions", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });

    const result = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "security.block.ip",
      },
    });

    expect(result.policy).toBe("escalate");
    expect(result.run.policyProfile).toBe("strict-change-control");
    expect(result.run.policyDecision).toBe("escalate");
  });

  it("applies autonomous ops profile to supervised queue actions", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });

    const result = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "ops-lead",
        action: "queue.assign",
      },
    });

    expect(result.policy).toBe("allow");
    expect(result.run.policyProfile).toBe("autonomous-ops");
  });

  it("resolves decisions and updates run outcome", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    const escalated = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "ops-lead",
        action: "retro.start",
      },
    });
    const decisionId = escalated.decision?.decisionId;
    expect(decisionId).toBeTruthy();
    if (!decisionId) {
      return;
    }

    const resolved = await resolveWorkforceDecision({
      storePath,
      decisionId,
      resolution: "allow",
      actor: "tester",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toBe("allow");
  });

  it("decrements queue pending for the resolved decision seat only", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    await executeWorkforceAction({
      storePath,
      input: {
        seatId: "ui-operator",
        action: "ui.review.board",
      },
    });
    await executeWorkforceAction({
      storePath,
      input: {
        seatId: "incident-commander",
        action: "incident.review",
      },
    });
    const pending = await listWorkforceDecisions({ storePath, status: "pending" });
    const uiDecision = pending.decisions.find((entry) => entry.seatId === "ui-operator");
    expect(uiDecision?.decisionId).toBeTruthy();
    if (!uiDecision?.decisionId) {
      return;
    }
    await resolveWorkforceDecision({
      storePath,
      decisionId: uiDecision.decisionId,
      resolution: "allow",
      actor: "tester",
    });
    const status = await getWorkforceStatus({ storePath });
    const uiQueue = status.queues.find((queue) => queue.seatId === "ui-operator");
    const incidentQueue = status.queues.find((queue) => queue.seatId === "incident-commander");
    expect(uiQueue?.pending).toBe(0);
    expect(incidentQueue?.pending).toBe(1);
  });

  it("ticks schedules and triggers runs", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    await addWorkforceSchedule({
      storePath,
      seatId: "queue-manager",
      name: "fast schedule",
      intervalMs: 60_000,
      action: "queue.patrol.fast",
    });

    const tick = await tickWorkforceSchedules({ storePath, actor: "tester" });
    expect(Array.isArray(tick.triggered)).toBe(true);
    const status = await getWorkforceStatus({ storePath });
    expect(status.summary.policyDecisions.allow).toBeGreaterThanOrEqual(0);
    expect(status.summary.riskLevels.low).toBeGreaterThanOrEqual(0);
    expect(status.summary.schedulesLagging).toBeGreaterThanOrEqual(0);
  });

  it("runs built-in appfolio report presets through workforce actions", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    process.env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE = "basic";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID = "client-id";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET = "client-secret";
    process.env.OPENCLAW_APPFOLIO_REPORTS_DATABASE = "coastlineequity";

    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [{ id: "row-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);

    const result = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.report.run:rent_roll",
        actor: "test",
      },
    });

    expect(result.policy).toBe("allow");
    expect(result.run.status).toBe("ok");
    expect(result.appfolioReport?.ok).toBe(true);
    expect(result.appfolioReport?.presetId).toBe("rent_roll");
    expect(result.appfolioReport?.count).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("executes scheduled appfolio report jobs when due", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    process.env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE = "basic";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID = "client-id";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET = "client-secret";
    process.env.OPENCLAW_APPFOLIO_REPORTS_DATABASE = "coastlineequity";

    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [{ id: "row-1" }, { id: "row-2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);

    await addWorkforceSchedule({
      storePath,
      seatId: "scheduler",
      name: "work order reports",
      intervalMs: 60_000,
      action: "appfolio.report.run:work_order",
    });

    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      schedules: Array<{ action: string; nextRunAtMs?: number }>;
    };
    const target = parsed.schedules.find(
      (schedule) => schedule.action === "appfolio.report.run:work_order",
    );
    expect(target).toBeTruthy();
    if (!target) {
      return;
    }
    target.nextRunAtMs = Date.now() - 1;
    await fs.writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");

    const tick = await tickWorkforceSchedules({ storePath, actor: "scheduler-test" });
    const reportRun = tick.triggered.find((run) => run.appfolioReport?.presetId === "work_order");

    expect(reportRun).toBeTruthy();
    expect(reportRun?.appfolioReport?.ok).toBe(true);
    expect(reportRun?.run.status).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("executes scheduled appfolio workflow jobs when due", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    process.env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE = "basic";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID = "client-id";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET = "client-secret";
    process.env.OPENCLAW_APPFOLIO_REPORTS_DATABASE = "coastlineequity";

    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/api/v2/reports/bill_detail.json")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                payee_name: "Vendor A",
                property_name: "Property 1",
                bill_date: "2026-02-10",
                amount: "100.00",
                reference_number: "INV-1",
              },
              {
                payee_name: "Vendor A",
                property_name: "Property 1",
                bill_date: "2026-02-10",
                amount: "100.00",
                reference_number: "INV-1",
              },
              {
                payee_name: "",
                property_name: "",
                bill_date: "2026-02-10",
                amount: "",
                reference_number: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v2/reports/vendor_ledger_enhanced.json")) {
        return new Response(JSON.stringify({ results: [{ id: "row-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v2/reports/work_order.json")) {
        return new Response(JSON.stringify({ results: [{ id: "wo-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);

    await addWorkforceSchedule({
      storePath,
      seatId: "queue-manager",
      name: "smart bill daily",
      intervalMs: 60_000,
      action: "appfolio.workflow.run:smart_bill_daily",
    });

    // Force the schedule to be due.
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      schedules: Array<{ action: string; nextRunAtMs?: number }>;
    };
    const target = parsed.schedules.find(
      (schedule) => schedule.action === "appfolio.workflow.run:smart_bill_daily",
    );
    expect(target).toBeTruthy();
    if (!target) {
      return;
    }
    target.nextRunAtMs = Date.now() - 1;
    await fs.writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");

    const tick = await tickWorkforceSchedules({ storePath, actor: "scheduler-test" });
    const workflowRun = tick.triggered.find(
      (run) => run.run.action === "appfolio.workflow.run:smart_bill_daily",
    );

    expect(workflowRun).toBeTruthy();
    expect(workflowRun?.policy).toBe("allow");
    expect(workflowRun?.run.status).toBe("ok");
    expect(workflowRun?.run.summary).toContain("appfolio_workflow:smart_bill_daily");

    const pending = await listWorkforceDecisions({ storePath, status: "pending" });
    expect(pending.decisions.some((entry) => entry.title.includes("Smart Bill review findings"))).toBe(
      true,
    );

    // bill_detail + vendor_ledger_enhanced + work_order
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("auto-paginates AppFolio report runs and aggregates row count", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    process.env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE = "basic";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID = "client-id";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET = "client-secret";
    process.env.OPENCLAW_APPFOLIO_REPORTS_DATABASE = "coastlineequity";

    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("offset=5000")) {
        return new Response(JSON.stringify({ results: [{ id: "row-2" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          results: [{ id: "row-1" }, { id: "row-1b" }],
          next_page_url:
            "https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json?offset=5000",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchFn);

    const result = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.report.run:rent_roll",
      },
    });

    expect(result.appfolioReport?.ok).toBe(true);
    expect(result.appfolioReport?.count).toBe(3);
    expect(result.appfolioReport?.pagesFetched).toBe(2);
    expect(result.appfolioReport?.truncated).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails fast on invalid report filters before hitting AppFolio", async () => {
    const storePath = makeStorePath();
    await initializeWorkforceStore({ storePath, force: true });
    process.env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE = "basic";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID = "client-id";
    process.env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET = "client-secret";
    process.env.OPENCLAW_APPFOLIO_REPORTS_DATABASE = "coastlineequity";

    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [{ id: "row-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);

    const result = await executeWorkforceAction({
      storePath,
      input: {
        seatId: "queue-manager",
        action: "appfolio.report.run:bill_detail",
        payload: {
          reportFilters: {
            occurred_on_from: "invalid-date",
            occurred_on_to: "2026-02-11",
          },
        },
      },
    });

    expect(result.run.status).toBe("error");
    expect(result.appfolioReport?.ok).toBe(false);
    expect(result.appfolioReport?.error).toBe("appfolio_report_validation_failed");
    expect(result.appfolioReport?.validationErrors).toContain("invalid_date_filter:occurred_on_from");
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });
});
