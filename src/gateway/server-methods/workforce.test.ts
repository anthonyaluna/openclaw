import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeWorkforceStore: vi.fn(),
  getWorkforceStatus: vi.fn(),
  listWorkforceRuns: vi.fn(),
  listWorkforceLedger: vi.fn(),
  listWorkforceDecisions: vi.fn(),
  getWorkforceWorkspace: vi.fn(),
  executeWorkforceAction: vi.fn(),
  resolveWorkforceDecision: vi.fn(),
  replayWorkforceRun: vi.fn(),
  addWorkforceSchedule: vi.fn(),
  listWorkforceSchedules: vi.fn(),
  tickWorkforceSchedules: vi.fn(),
  recordAppfolioWritebackReceipt: vi.fn(),
  probeAppfolioReportsAccess: vi.fn(),
}));

vi.mock("../../workforce/service.js", () => ({
  initializeWorkforceStore: mocks.initializeWorkforceStore,
  getWorkforceStatus: mocks.getWorkforceStatus,
  listWorkforceRuns: mocks.listWorkforceRuns,
  listWorkforceLedger: mocks.listWorkforceLedger,
  listWorkforceDecisions: mocks.listWorkforceDecisions,
  getWorkforceWorkspace: mocks.getWorkforceWorkspace,
  executeWorkforceAction: mocks.executeWorkforceAction,
  resolveWorkforceDecision: mocks.resolveWorkforceDecision,
  replayWorkforceRun: mocks.replayWorkforceRun,
  addWorkforceSchedule: mocks.addWorkforceSchedule,
  listWorkforceSchedules: mocks.listWorkforceSchedules,
  tickWorkforceSchedules: mocks.tickWorkforceSchedules,
  recordAppfolioWritebackReceipt: mocks.recordAppfolioWritebackReceipt,
}));

vi.mock("../../infra/appfolio-reports.js", () => ({
  probeAppfolioReportsAccess: mocks.probeAppfolioReportsAccess,
}));

import { workforceHandlers } from "./workforce.js";

const noop = () => false;

describe("workforce handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getWorkforceStatus.mockResolvedValue({
      readiness: "ready",
      summary: {},
      seats: [],
      queues: [],
      schedules: [],
      nextSteps: [],
      updatedAtMs: Date.now(),
    });
    mocks.executeWorkforceAction.mockResolvedValue({
      policy: "escalate",
      run: { runId: "run-1" },
      decision: { decisionId: "decision-1" },
      receipt: { receiptId: "receipt-1" },
      nextSteps: [],
    });
    mocks.resolveWorkforceDecision.mockResolvedValue({
      decisionId: "decision-1",
      status: "resolved",
      resolution: "allow",
    });
    mocks.probeAppfolioReportsAccess.mockResolvedValue({
      ok: true,
      configured: {
        clientId: true,
        clientSecret: true,
        refreshToken: true,
        accessToken: false,
        tokenUrl: true,
        apiBaseUrl: true,
      },
      token: {
        acquired: true,
        source: "refresh_token",
      },
      reports: {
        ok: true,
        endpoint: "https://example.test/reports",
      },
      warnings: [],
    });
  });

  it("returns validation error for invalid action params", async () => {
    const respond = vi.fn();
    await workforceHandlers["workforce.action.execute"]({
      params: {},
      respond,
      context: { broadcast: vi.fn() } as unknown as Parameters<
        (typeof workforceHandlers)["workforce.action.execute"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "workforce.action.execute" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
      }),
    );
    expect(mocks.executeWorkforceAction).not.toHaveBeenCalled();
  });

  it("broadcasts update and decision events for escalated action", async () => {
    const respond = vi.fn();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    await workforceHandlers["workforce.action.execute"]({
      params: {
        seatId: "ops-lead",
        action: "deploy.prod",
      },
      respond,
      context: {
        broadcast: (event: string, payload: unknown) => {
          broadcasts.push({ event, payload });
        },
      } as unknown as Parameters<
        (typeof workforceHandlers)["workforce.action.execute"]
      >[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "workforce.action.execute" },
      isWebchatConnect: noop,
    });

    expect(mocks.executeWorkforceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          seatId: "ops-lead",
          action: "deploy.prod",
        }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        run: expect.objectContaining({ runId: "run-1" }),
      }),
      undefined,
    );
    expect(broadcasts.some((entry) => entry.event === "workforce.updated")).toBe(true);
    expect(broadcasts.some((entry) => entry.event === "workforce.decision.requested")).toBe(true);
  });

  it("broadcasts decision resolved event", async () => {
    const respond = vi.fn();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    await workforceHandlers["workforce.decision.resolve"]({
      params: {
        decisionId: "decision-1",
        resolution: "allow",
      },
      respond,
      context: {
        broadcast: (event: string, payload: unknown) => {
          broadcasts.push({ event, payload });
        },
      } as unknown as Parameters<
        (typeof workforceHandlers)["workforce.decision.resolve"]
      >[0]["context"],
      client: null,
      req: { id: "req-3", type: "req", method: "workforce.decision.resolve" },
      isWebchatConnect: noop,
    });

    expect(mocks.resolveWorkforceDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: "decision-1",
        resolution: "allow",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ status: "resolved" }),
      undefined,
    );
    expect(broadcasts.some((entry) => entry.event === "workforce.decision.resolved")).toBe(true);
  });

  it("proxies workforce.status", async () => {
    const respond = vi.fn();
    await workforceHandlers["workforce.status"]({
      params: {},
      respond,
      context: { broadcast: vi.fn() } as unknown as Parameters<
        (typeof workforceHandlers)["workforce.status"]
      >[0]["context"],
      client: null,
      req: { id: "req-4", type: "req", method: "workforce.status" },
      isWebchatConnect: noop,
    });

    expect(mocks.getWorkforceStatus).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ readiness: "ready" }),
      undefined,
    );
  });

  it("proxies AppFolio reports probe", async () => {
    const respond = vi.fn();
    await workforceHandlers["workforce.appfolio.reports.probe"]({
      params: {},
      respond,
      context: { broadcast: vi.fn() } as unknown as Parameters<
        (typeof workforceHandlers)["workforce.appfolio.reports.probe"]
      >[0]["context"],
      client: null,
      req: { id: "req-5", type: "req", method: "workforce.appfolio.reports.probe" },
      isWebchatConnect: noop,
    });

    expect(mocks.probeAppfolioReportsAccess).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        reports: expect.objectContaining({ ok: true }),
      }),
      undefined,
    );
  });
});
