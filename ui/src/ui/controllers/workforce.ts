import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  WorkforceDecision,
  WorkforceReceipt,
  WorkforceReplayFrame,
  WorkforceRun,
  WorkforceStatus,
  WorkforceWorkspace,
} from "../types.ts";

export type WorkforceState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  workforceLoading: boolean;
  workforceError: string | null;
  workforceStatus: WorkforceStatus | null;
  workforceRuns: WorkforceRun[];
  workforceDecisions: WorkforceDecision[];
  workforceReceipts: WorkforceReceipt[];
  workforceReplayframes: WorkforceReplayFrame[];
  workforceWorkspace: WorkforceWorkspace | null;
};

export async function loadWorkforceStatus(state: WorkforceState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.workforceLoading = true;
  state.workforceError = null;
  try {
    const res = await state.client.request<WorkforceStatus>("workforce.status", {});
    state.workforceStatus = res;
  } catch (err) {
    state.workforceError = String(err);
  } finally {
    state.workforceLoading = false;
  }
}

export async function loadWorkforceRuns(
  state: WorkforceState,
  opts: { limit?: number; query?: string; status?: WorkforceRun["status"] } = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ runs?: WorkforceRun[] }>("workforce.runs", {
      limit: opts.limit ?? 200,
      query: opts.query,
      status: opts.status,
    });
    state.workforceRuns = Array.isArray(res.runs) ? res.runs : [];
  } catch (err) {
    state.workforceError = String(err);
  }
}

export async function loadWorkforceDecisions(
  state: WorkforceState,
  opts: { limit?: number; status?: WorkforceDecision["status"] } = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ decisions?: WorkforceDecision[] }>(
      "workforce.decisions",
      {
        limit: opts.limit ?? 200,
        status: opts.status,
      },
    );
    state.workforceDecisions = Array.isArray(res.decisions) ? res.decisions : [];
  } catch (err) {
    state.workforceError = String(err);
  }
}

export async function loadWorkforceLedger(state: WorkforceState, limit = 500) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{
      receipts?: WorkforceReceipt[];
      replayframes?: WorkforceReplayFrame[];
    }>("workforce.ledger", { limit });
    state.workforceReceipts = Array.isArray(res.receipts) ? res.receipts : [];
    state.workforceReplayframes = Array.isArray(res.replayframes) ? res.replayframes : [];
  } catch (err) {
    state.workforceError = String(err);
  }
}

export async function loadWorkforceWorkspace(state: WorkforceState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ workspace?: WorkforceWorkspace }>(
      "workforce.workspace",
      {},
    );
    state.workforceWorkspace = res.workspace ?? null;
  } catch (err) {
    state.workforceError = String(err);
  }
}

export async function refreshWorkforceAll(state: WorkforceState) {
  await Promise.all([
    loadWorkforceStatus(state),
    loadWorkforceRuns(state),
    loadWorkforceDecisions(state),
    loadWorkforceLedger(state),
    loadWorkforceWorkspace(state),
  ]);
}

export async function executeWorkforceAction(
  state: WorkforceState,
  input: {
    seatId: string;
    action: string;
    source?: WorkforceRun["source"];
    actor?: string;
    requireWritebackReceipt?: boolean;
    payload?: Record<string, unknown>;
  },
) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<{
      policy?: "allow" | "block" | "escalate";
      run?: WorkforceRun;
      decision?: WorkforceDecision;
      receipt?: WorkforceReceipt;
    }>("workforce.action.execute", input);
    await refreshWorkforceAll(state);
    return res;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}

export async function addWorkforceSchedule(
  state: WorkforceState,
  input: {
    seatId: string;
    name: string;
    intervalMs: number;
    action: string;
  },
) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request("workforce.schedule.add", input);
    await refreshWorkforceAll(state);
    return res;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}

export async function resolveWorkforceDecision(
  state: WorkforceState,
  decisionId: string,
  resolution: "allow" | "deny",
) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<WorkforceDecision>("workforce.decision.resolve", {
      decisionId,
      resolution,
      actor: "control-ui",
    });
    await refreshWorkforceAll(state);
    return res;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}

export async function replayWorkforceRun(state: WorkforceState, runId: string) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request("workforce.run.replay", {
      runId,
      actor: "control-ui",
    });
    await refreshWorkforceAll(state);
    return res;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}

export async function tickWorkforce(state: WorkforceState) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request("workforce.tick", {
      actor: "control-ui",
    });
    await refreshWorkforceAll(state);
    return res;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}

export async function recordWorkforceWriteback(
  state: WorkforceState,
  params: { note?: string; artifact?: string } = {},
) {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<{ receipt?: WorkforceReceipt }>(
      "workforce.appfolio.writeback",
      {
        actor: "control-ui",
        note: params.note,
        artifact: params.artifact,
      },
    );
    await refreshWorkforceAll(state);
    return res.receipt ?? null;
  } catch (err) {
    state.workforceError = String(err);
    return null;
  }
}
