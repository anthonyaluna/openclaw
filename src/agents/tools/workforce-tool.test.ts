import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addWorkforceSchedule: vi.fn(),
  executeWorkforceAction: vi.fn(),
  getWorkforceStatus: vi.fn(),
  getWorkforceWorkspace: vi.fn(),
  listWorkforceSchedules: vi.fn(),
  recordAppfolioWritebackReceipt: vi.fn(),
  runAppfolioReport: vi.fn(),
  runAppfolioReportNextPage: vi.fn(),
  probeAppfolioReportsAccess: vi.fn(),
}));

vi.mock("../../workforce/service.js", () => ({
  addWorkforceSchedule: mocks.addWorkforceSchedule,
  executeWorkforceAction: mocks.executeWorkforceAction,
  getWorkforceStatus: mocks.getWorkforceStatus,
  getWorkforceWorkspace: mocks.getWorkforceWorkspace,
  listWorkforceSchedules: mocks.listWorkforceSchedules,
  recordAppfolioWritebackReceipt: mocks.recordAppfolioWritebackReceipt,
}));

vi.mock("../../infra/appfolio-reports.js", () => ({
  runAppfolioReport: mocks.runAppfolioReport,
  runAppfolioReportNextPage: mocks.runAppfolioReportNextPage,
  probeAppfolioReportsAccess: mocks.probeAppfolioReportsAccess,
}));

import { createWorkforceTool } from "./workforce-tool.js";

describe("workforce tool", () => {
  beforeEach(() => {
    mocks.addWorkforceSchedule.mockReset();
    mocks.executeWorkforceAction.mockReset();
    mocks.getWorkforceStatus.mockReset();
    mocks.getWorkforceWorkspace.mockReset();
    mocks.listWorkforceSchedules.mockReset();
    mocks.recordAppfolioWritebackReceipt.mockReset();
    mocks.runAppfolioReport.mockReset();
    mocks.runAppfolioReportNextPage.mockReset();
    mocks.probeAppfolioReportsAccess.mockReset();
  });

  it("returns workforce status", async () => {
    mocks.getWorkforceStatus.mockResolvedValue({
      readiness: "ready",
      nextSteps: [],
      summary: { seats: 8 },
    });
    const tool = createWorkforceTool();
    const result = await tool.execute("call-1", { action: "status" });
    expect(result.details).toMatchObject({
      readiness: "ready",
      summary: { seats: 8 },
    });
    expect(mocks.getWorkforceStatus).toHaveBeenCalledTimes(1);
  });

  it("retries preset report run with writeback receipt when legacy gate blocks", async () => {
    mocks.recordAppfolioWritebackReceipt.mockResolvedValue({ receiptId: "wr-1" });
    mocks.executeWorkforceAction
      .mockResolvedValueOnce({
        policy: "block",
        run: { status: "blocked", summary: "appfolio_action_requires_writeback_gate" },
      })
      .mockResolvedValueOnce({
        policy: "allow",
        run: { status: "ok", summary: "appfolio_report:rent_roll:rows=123" },
      });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-2", {
      action: "appfolio_report_run",
      presetId: "rent_roll",
      source: "chat",
    });

    expect(mocks.executeWorkforceAction).toHaveBeenCalledTimes(2);
    expect(mocks.executeWorkforceAction.mock.calls[1]?.[0]).toMatchObject({
      input: {
        requireWritebackReceipt: true,
        payload: {
          writebackReceiptId: "wr-1",
        },
      },
    });
    expect(result.details).toMatchObject({
      retriedWithWriteback: true,
      writebackReceiptId: "wr-1",
    });
  });

  it("runs raw AppFolio reports and next page fetches", async () => {
    mocks.runAppfolioReport.mockResolvedValue({
      ok: true,
      reportName: "rent_roll.json",
      count: 9,
      rows: [{ id: 1 }],
    });
    mocks.runAppfolioReportNextPage.mockResolvedValue({
      ok: true,
      reportName: "next_page",
      count: 4,
      nextPageUrl: null,
      rows: [{ id: 2 }],
    });

    const tool = createWorkforceTool();

    const raw = await tool.execute("call-3", {
      action: "appfolio_report_run_raw",
      reportName: "rent_roll.json",
      reportFilters: { as_of_to: "2026-02-11" },
      method: "POST",
    });
    expect(raw.details).toMatchObject({ ok: true, count: 9 });
    expect(mocks.runAppfolioReport).toHaveBeenCalledWith({
      reportName: "rent_roll.json",
      body: { as_of_to: "2026-02-11" },
      method: "POST",
      includeRows: true,
      maxRows: 200,
    });

    const next = await tool.execute("call-4", {
      action: "appfolio_report_next_page",
      nextPageUrl: "https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json?offset=1",
    });
    expect(next.details).toMatchObject({ ok: true, count: 4 });
    expect(mocks.runAppfolioReportNextPage).toHaveBeenCalledWith({
      nextPageUrl: "https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json?offset=1",
      includeRows: true,
      maxRows: 200,
    });
  });

  it("installs only missing AppFolio schedules", async () => {
    mocks.listWorkforceSchedules.mockResolvedValue({
      schedules: [{ action: "appfolio.report.run:rent_roll" }],
    });
    mocks.addWorkforceSchedule.mockResolvedValue({ id: "sched-1" });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-5", {
      action: "appfolio_schedules_install",
    });

    expect(mocks.addWorkforceSchedule.mock.calls.length).toBeGreaterThan(0);
    expect(result.details).toMatchObject({
      skipped: [{ presetId: "rent_roll", reason: "already_installed" }],
    });
  });

  it("installs missing AppFolio workflow schedules", async () => {
    mocks.listWorkforceSchedules.mockResolvedValue({ schedules: [] });
    mocks.addWorkforceSchedule.mockResolvedValue({ id: "sched-workflow-1" });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-workflow-schedule", {
      action: "appfolio_workflow_schedule_install",
      workflowId: "smart_bill_daily",
      intervalMs: 90 * 60 * 1000,
    });

    expect(mocks.addWorkforceSchedule).toHaveBeenCalledWith({
      seatId: "queue-manager",
      name: "AppFolio Workflow: Smart Bill Daily Ops",
      intervalMs: 90 * 60 * 1000,
      action: "appfolio.workflow.run:smart_bill_daily",
    });
    expect(result.details).toMatchObject({
      ok: true,
      installed: true,
      workflow: { id: "smart_bill_daily" },
    });
  });

  it("resolves report shortcuts for appfolio_report_run", async () => {
    mocks.executeWorkforceAction.mockResolvedValue({
      policy: "allow",
      run: { status: "ok", summary: "appfolio_report:bill_detail:rows=42" },
    });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-6", {
      action: "appfolio_report_run",
      shortcut: "smart bill invoices",
      source: "chat",
    });

    expect(mocks.executeWorkforceAction).toHaveBeenCalledWith({
      input: expect.objectContaining({
        seatId: "queue-manager",
        action: "appfolio.report.run:bill_detail",
        source: "chat",
      }),
    });
    expect(result.details).toMatchObject({
      preset: { id: "bill_detail" },
      route: {
        ok: true,
      },
    });
  });

  it("returns routing recommendation for ambiguous or multi-report prompts", async () => {
    const tool = createWorkforceTool();
    const result = await tool.execute("call-route", {
      action: "appfolio_report_route",
      query: "work orders and invoice data",
    });

    expect(result.details).toMatchObject({
      recommendation: {
        kind: "workflow",
        id: "smart_bill_triage",
      },
    });
  });

  it("runs smart bill workflow and executes each preset step", async () => {
    mocks.executeWorkforceAction.mockResolvedValue({
      policy: "allow",
      run: { status: "ok", summary: "ok" },
    });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-workflow", {
      action: "appfolio_workflow_run",
      workflowId: "smart_bill_triage",
      source: "chat",
    });

    expect(mocks.executeWorkforceAction).toHaveBeenCalledTimes(1);
    expect(mocks.executeWorkforceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          seatId: "queue-manager",
          action: "appfolio.workflow.run:smart_bill_triage",
          source: "chat",
        }),
      }),
    );
    expect(result.details).toMatchObject({
      ok: true,
      workflow: { id: "smart_bill_triage" },
      action: "appfolio.workflow.run:smart_bill_triage",
      entrySeatId: "queue-manager",
    });
  });

  it("accepts action aliases and string row/include values for workflow runs", async () => {
    mocks.executeWorkforceAction.mockResolvedValue({
      policy: "allow",
      run: { status: "ok", summary: "ok" },
    });

    const tool = createWorkforceTool();
    const result = await tool.execute("call-workflow-alias", {
      action: "appfolio workflow run",
      workflowId: "smart_bill_triage",
      source: "sub-agent",
      includeRows: "true",
      rowLimit: "5000",
    });

    expect(mocks.executeWorkforceAction).toHaveBeenCalledTimes(1);
    expect(mocks.executeWorkforceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          seatId: "queue-manager",
          action: "appfolio.workflow.run:smart_bill_triage",
          source: "subagent",
          payload: expect.objectContaining({
            includeRows: true,
            rowLimit: 5000,
          }),
        }),
      }),
    );
    expect(result.details).toMatchObject({
      ok: true,
      workflow: { id: "smart_bill_triage" },
      action: "appfolio.workflow.run:smart_bill_triage",
    });
  });

  it("rejects unknown report shortcuts", async () => {
    const tool = createWorkforceTool();
    await expect(
      tool.execute("call-7", {
        action: "appfolio_report_run",
        shortcut: "totally unknown report",
      }),
    ).rejects.toThrow("Unknown report shortcut");
  });
});
