import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  });
});
