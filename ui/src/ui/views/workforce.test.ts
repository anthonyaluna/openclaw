import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderWorkforce, type WorkforceProps } from "./workforce.ts";

function createProps(overrides: Partial<WorkforceProps> = {}): WorkforceProps {
  return {
    status: {
      updatedAtMs: Date.now(),
      readiness: "ready",
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
    },
    runs: [],
    decisions: [],
    receipts: [],
    replayframes: [],
    workspace: {
      appfolioWritebackEnforced: true,
      defaultChannel: "appfolio",
      commsRules: [],
      policyProfile: "balanced",
    },
    selectedSeatId: "ops-lead",
    workbenchOpen: true,
    activeWorkbenchTab: "seat-chat",
    paletteOpen: false,
    error: null,
    lastWritebackReceiptId: null,
    onToggleWorkbench: () => undefined,
    onSelectSeat: () => undefined,
    onSelectWorkbenchTab: () => undefined,
    onTogglePalette: () => undefined,
    onPaletteAction: () => undefined,
    onDecisionResolve: () => undefined,
    onReplayRun: () => undefined,
    onExecuteAction: () => undefined,
    onTick: () => undefined,
    onRecordWriteback: () => undefined,
    onAddSchedule: () => undefined,
    ...overrides,
  };
}

describe("workforce view", () => {
  it("executes guided writeback action from next steps", () => {
    const container = document.createElement("div");
    const onExecuteAction = vi.fn();
    render(
      renderWorkforce(
        createProps({
          onExecuteAction,
          status: {
            ...createProps().status!,
            nextSteps: [
              {
                id: "clear-blocked-run",
                title: "Record writeback receipt",
                detail: "AppFolio action requires writeback.",
                priority: "high",
                seatId: "queue-manager",
                action: "appfolio.comms.broadcast.owner-update",
                requireWritebackReceipt: true,
              },
            ],
          },
        }),
      ),
      container,
    );

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Run (writeback)",
    );
    expect(runButton).toBeDefined();
    runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onExecuteAction).toHaveBeenCalledWith(
      "queue-manager",
      "appfolio.comms.broadcast.owner-update",
      expect.objectContaining({ requireWritebackReceipt: true }),
    );
  });

  it("resolves decision cards from the workbench", () => {
    const container = document.createElement("div");
    const onDecisionResolve = vi.fn();
    render(
      renderWorkforce(
        createProps({
          onDecisionResolve,
          activeWorkbenchTab: "decisions",
          decisions: [
            {
              decisionId: "decision-1",
              seatId: "ops-lead",
              title: "Approval required",
              summary: "Need explicit approval",
              recommended: "allow",
              riskLevel: "high",
              requiresApproval: true,
              status: "pending",
              createdAtMs: Date.now(),
              expiresAtMs: Date.now() + 60_000,
            },
          ],
        }),
      ),
      container,
    );

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Approve",
    );
    expect(approveButton).toBeDefined();
    approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDecisionResolve).toHaveBeenCalledWith("decision-1", "allow");
  });
});
