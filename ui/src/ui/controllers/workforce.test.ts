import { describe, expect, it, vi } from "vitest";
import {
  executeWorkforceAction,
  probeWorkforceAppfolioReports,
  recordWorkforceWriteback,
  refreshWorkforceAll,
  resolveWorkforceDecision,
  type WorkforceState,
} from "./workforce.ts";

function createState() {
  const request = vi.fn(async (method: string) => {
    if (method === "workforce.status") {
      return {
        readiness: "ready",
        updatedAtMs: Date.now(),
        seats: [],
        queues: [],
        schedules: [],
        nextSteps: [],
        summary: {
          seats: 0,
          queues: 0,
          schedules: 0,
          pendingDecisions: 0,
          running: 0,
          blocked: 0,
          recentRuns24h: 0,
          autonomy: { autonomous: 0, supervised: 0, manual: 0 },
          queuesPressured: 0,
          schedulesLagging: 0,
          policyDecisions: { allow: 0, block: 0, escalate: 0 },
          riskLevels: { low: 0, medium: 0, high: 0 },
        },
      };
    }
    if (method === "workforce.runs") {
      return {
        runs: [
          {
            runId: "run-1",
            source: "workforce",
            seatId: "ops-lead",
            action: "queue.assign",
            status: "ok",
            riskLevel: "low",
            policyProfile: "autonomous-ops",
            policyDecision: "allow",
            startedAtMs: Date.now(),
            artifacts: [],
          },
        ],
      };
    }
    if (method === "workforce.decisions") {
      return { decisions: [] };
    }
    if (method === "workforce.ledger") {
      return { receipts: [], replayframes: [] };
    }
    if (method === "workforce.workspace") {
      return {
        workspace: {
          appfolioWritebackEnforced: true,
          defaultChannel: "appfolio",
          commsRules: [],
          policyProfile: "balanced",
        },
      };
    }
    if (method === "workforce.action.execute") {
      return {
        policy: "allow",
        run: { runId: "run-1" },
        receipt: { receiptId: "receipt-1" },
      };
    }
    if (method === "workforce.appfolio.writeback") {
      return {
        receipt: {
          receiptId: "writeback-1",
          actor: "control-ui",
          action: "appfolio.writeback",
          outcome: "recorded",
          ts: Date.now(),
          artifacts: [],
        },
      };
    }
    if (method === "workforce.appfolio.reports.probe") {
      return {
        ok: true,
        configured: {
          clientId: true,
          clientSecret: true,
          refreshToken: false,
          accessToken: false,
          tokenUrl: true,
          apiBaseUrl: true,
        },
        token: {
          acquired: true,
          source: "client_credentials",
        },
        reports: {
          ok: true,
          endpoint: "https://api.appfolio.com/reports",
          status: 200,
          count: 4,
        },
        warnings: [],
      };
    }
    if (method === "workforce.decision.resolve") {
      return { decisionId: "decision-1", status: "resolved" };
    }
    return {};
  });

  const state: WorkforceState = {
    client: { request } as unknown as WorkforceState["client"],
    connected: true,
    workforceLoading: false,
    workforceError: null,
    workforceStatus: null,
    workforceRuns: [],
    workforceDecisions: [],
    workforceReceipts: [],
    workforceReplayframes: [],
    workforceWorkspace: null,
    workforceAppfolioProbeLoading: false,
    workforceAppfolioProbeResult: null,
  };

  return { state, request };
}

describe("workforce controller", () => {
  it("loads all workforce surfaces", async () => {
    const { state, request } = createState();
    await refreshWorkforceAll(state);

    expect(state.workforceStatus?.readiness).toBe("ready");
    expect(state.workforceRuns.length).toBe(1);
    expect(state.workforceWorkspace?.policyProfile).toBe("balanced");
    expect(request).toHaveBeenCalledWith("workforce.status", {});
    expect(request).toHaveBeenCalledWith("workforce.runs", expect.any(Object));
    expect(request).toHaveBeenCalledWith("workforce.decisions", expect.any(Object));
    expect(request).toHaveBeenCalledWith("workforce.ledger", { limit: 500 });
    expect(request).toHaveBeenCalledWith("workforce.workspace", {});
  });

  it("executes action and refreshes state", async () => {
    const { state, request } = createState();
    const result = await executeWorkforceAction(state, {
      seatId: "ops-lead",
      action: "queue.assign",
      source: "workforce",
    });

    expect(result).toEqual(expect.objectContaining({ policy: "allow" }));
    expect(state.workforceRuns.length).toBe(1);
    expect(request).toHaveBeenCalledWith(
      "workforce.action.execute",
      expect.objectContaining({
        seatId: "ops-lead",
        action: "queue.assign",
      }),
    );
  });

  it("records writeback receipt and resolves decisions", async () => {
    const { state, request } = createState();
    const receipt = await recordWorkforceWriteback(state, { note: "sync complete" });
    expect(receipt?.receiptId).toBe("writeback-1");

    const decision = await resolveWorkforceDecision(state, "decision-1", "allow");
    expect(decision).toEqual(expect.objectContaining({ decisionId: "decision-1" }));
    expect(request).toHaveBeenCalledWith(
      "workforce.decision.resolve",
      expect.objectContaining({
        decisionId: "decision-1",
        resolution: "allow",
      }),
    );
  });

  it("probes appfolio reports and stores probe result", async () => {
    const { state, request } = createState();
    const result = await probeWorkforceAppfolioReports(state);
    expect(result?.ok).toBe(true);
    expect(state.workforceAppfolioProbeResult?.reports.count).toBe(4);
    expect(request).toHaveBeenCalledWith("workforce.appfolio.reports.probe", {});
  });
});
