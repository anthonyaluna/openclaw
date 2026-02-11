import { html } from "lit";
import type {
  WorkforceDecision,
  WorkforceReplayFrame,
  WorkforceReceipt,
  WorkforceRun,
  WorkforceStatus,
  WorkforceWorkspace,
} from "../types.js";
import { WORKFORCE_ROSTER } from "../../../../src/workforce/roster.js";

export type WorkforceWorkbenchTab =
  | "seat-chat"
  | "team-chat"
  | "internal-chats"
  | "conversations"
  | "decisions"
  | "replay"
  | "memory"
  | "engineering";

type ExecuteActionOptions = {
  requireWritebackReceipt?: boolean;
};

export type WorkforceProps = {
  status: WorkforceStatus | null;
  runs: WorkforceRun[];
  decisions: WorkforceDecision[];
  receipts: WorkforceReceipt[];
  replayframes: WorkforceReplayFrame[];
  workspace: WorkforceWorkspace | null;
  selectedSeatId: string;
  workbenchOpen: boolean;
  activeWorkbenchTab: WorkforceWorkbenchTab;
  paletteOpen: boolean;
  error: string | null;
  lastWritebackReceiptId: string | null;
  onToggleWorkbench: () => void;
  onSelectSeat: (seatId: string) => void;
  onSelectWorkbenchTab: (tab: WorkforceWorkbenchTab) => void;
  onTogglePalette: () => void;
  onPaletteAction: (action: "standup" | "retro" | "engineering" | "decisions") => void;
  onDecisionResolve: (decisionId: string, resolution: "allow" | "deny") => void;
  onReplayRun: (runId: string) => void;
  onExecuteAction: (seatId: string, action: string, options?: ExecuteActionOptions) => void;
  onTick: () => void;
  onRecordWriteback: () => void;
  onAddSchedule: (seatId: string, name: string, intervalMs: number, action: string) => void;
};

const WORKBENCH_TABS: Array<{ id: WorkforceWorkbenchTab; label: string }> = [
  { id: "seat-chat", label: "Seat Chat" },
  { id: "team-chat", label: "Team Chat" },
  { id: "internal-chats", label: "Internal Chats" },
  { id: "conversations", label: "Conversations" },
  { id: "decisions", label: "Decisions" },
  { id: "replay", label: "Replay" },
  { id: "memory", label: "Memory" },
  { id: "engineering", label: "Engineering" },
];

function permissionToAction(permission: string) {
  return permission.replaceAll(":", ".");
}

function priorityClass(priority: "high" | "medium" | "low") {
  if (priority === "high") {
    return "pill warn";
  }
  if (priority === "low") {
    return "pill";
  }
  return "pill";
}

export function renderWorkforce(props: WorkforceProps) {
  const pendingDecisions = props.decisions
    .filter((entry) => entry.status === "pending")
    .slice(0, 8);
  const recentRuns = props.runs.slice(0, 12);
  const seatRuntime = new Map((props.status?.seats ?? []).map((seat) => [seat.id, seat]));
  const queueBySeat = new Map(
    (props.status?.queues ?? []).map((queue) => [
      queue.seatId,
      {
        pending: queue.pending,
        concurrency: queue.concurrency,
      },
    ]),
  );
  const summary = props.status?.summary;
  const selectedSeat =
    WORKFORCE_ROSTER.find((seat) => seat.id === props.selectedSeatId) ?? WORKFORCE_ROSTER[0];

  return html`
    <section
      class="workforce"
      @keydown=${(event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          props.onTogglePalette();
        }
        if (event.key === "Escape" && props.workbenchOpen) {
          event.preventDefault();
          props.onToggleWorkbench();
        }
      }}
      tabindex="0"
    >
      <section class="grid grid-cols-4">
        <article class="stat-card stat">
          <div class="stat-label">Readiness</div>
          <div class="stat-value ${props.status?.readiness === "degraded" ? "warn" : "ok"}">${props.status?.readiness ?? "unknown"}</div>
        </article>
        <article class="stat-card stat">
          <div class="stat-label">Pending Decisions</div>
          <div class="stat-value">${summary?.pendingDecisions ?? 0}</div>
        </article>
        <article class="stat-card stat">
          <div class="stat-label">Pressured Queues</div>
          <div class="stat-value">${summary?.queuesPressured ?? 0}</div>
        </article>
        <article class="stat-card stat">
          <div class="stat-label">Runs (24h)</div>
          <div class="stat-value">${summary?.recentRuns24h ?? 0}</div>
        </article>
      </section>

      <div class="workforce-grid">
        <section class="card workforce-canvas">
          <div class="card-title">Office Canvas</div>
          <div class="card-sub">Select a seat, dispatch actions, and inspect queue posture.</div>
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-subtle" @click=${props.onTick}>Run scheduler tick</button>
            <button class="btn btn-subtle" @click=${props.onRecordWriteback}>Record AppFolio writeback</button>
            <button
              class="btn btn-subtle"
              @click=${() =>
                props.onAddSchedule(
                  selectedSeat.id,
                  `${selectedSeat.label} hourly patrol`,
                  60 * 60 * 1000,
                  `patrol:${selectedSeat.id}`,
                )}
            >
              Add hourly patrol
            </button>
          </div>
          ${
            props.lastWritebackReceiptId
              ? html`<div class="card-sub mono" style="margin-top:6px;">Last writeback: ${props.lastWritebackReceiptId}</div>`
              : null
          }
          <div class="workforce-seats">
            ${WORKFORCE_ROSTER.map((seat) => {
              const runtime = seatRuntime.get(seat.id);
              const queue = queueBySeat.get(seat.id);
              return html`
                <button
                  class="workforce-seat ${props.selectedSeatId === seat.id ? "chip--active" : ""}"
                  @click=${() => {
                    props.onSelectSeat(seat.id);
                    if (!props.workbenchOpen) {
                      props.onToggleWorkbench();
                    }
                    props.onSelectWorkbenchTab("seat-chat");
                  }}
                  title=${`Systems: ${seat.systemsAccess.join(", ")}`}
                >
                  <div class="workforce-seat__name">${seat.label}</div>
                  <div class="workforce-seat__meta">${seat.id}</div>
                  <div class="workforce-seat__mode">${runtime?.autonomyMode ?? seat.autonomyMode}</div>
                  <div class="workforce-seat__mode">queue pending: ${queue?.pending ?? 0}</div>
                </button>
              `;
            })}
          </div>
        </section>

        <section class="card workforce-activity">
          <div class="card-title">Live Activity</div>
          <div class="card-sub">Policy decisions, recent runs, and prioritized next steps.</div>
          <div class="workforce-activity-list">
            ${(props.status?.nextSteps ?? []).map(
              (step) => {
                const requiresWriteback = Boolean(step.requireWritebackReceipt);
                return html`
                  <div class="workforce-activity-item workforce-activity-item--decision">
                    <span>
                      <span class="${priorityClass(step.priority)}">${step.priority}</span>
                      ${step.title}
                      <div class="card-sub">${step.detail}</div>
                    </span>
                    ${
                      step.seatId && step.action
                        ? html`
                            <button
                              class="btn btn-subtle"
                              title=${requiresWriteback
                                ? "This action requires a writeback receipt (auto recorded when missing)."
                                : "Execute action"}
                              @click=${() =>
                                props.onExecuteAction(step.seatId!, step.action!, {
                                  requireWritebackReceipt: requiresWriteback,
                                })}
                            >
                              ${requiresWriteback ? "Run (writeback)" : "Run"}
                            </button>
                          `
                        : null
                    }
                  </div>
                `;
              },
            )}
            ${pendingDecisions.map(
              (item) => html`
                <button
                  class="workforce-activity-item workforce-activity-item--decision"
                  @click=${() => {
                    if (!props.workbenchOpen) {
                      props.onToggleWorkbench();
                    }
                    props.onSelectWorkbenchTab("decisions");
                  }}
                >
                  <span>${item.title}</span>
                  <span class="mono">${item.seatId}</span>
                </button>
              `,
            )}
            ${recentRuns.map(
              (run) => html`
                <button
                  class="workforce-activity-item"
                  @click=${() => {
                    if (!props.workbenchOpen) {
                      props.onToggleWorkbench();
                    }
                    props.onSelectWorkbenchTab("replay");
                  }}
                >
                  <span>${run.action}</span>
                  <span class="mono">${run.status}</span>
                </button>
              `,
            )}
          </div>
        </section>
      </div>

      ${
        props.error
          ? html`<section class="card"><div class="pill danger">${props.error}</div></section>`
          : null
      }

      ${
        props.workbenchOpen
          ? html`
              <section class="card workforce-workbench">
                <div class="workbench-header">
                  <div>
                    <div class="card-title">Workbench</div>
                    <div class="card-sub">One-click details. Press Esc to close.</div>
                  </div>
                  <button class="btn btn-subtle" @click=${props.onToggleWorkbench}>Close</button>
                </div>
                <div class="workbench-tabs">
                  ${WORKBENCH_TABS.map(
                    (tab) => html`
                      <button
                        class="chip ${props.activeWorkbenchTab === tab.id ? "chip--active" : ""}"
                        @click=${() => props.onSelectWorkbenchTab(tab.id)}
                      >
                        ${tab.label}
                      </button>
                    `,
                  )}
                </div>
                <div class="workbench-body">${renderWorkbenchBody(props, selectedSeat, queueBySeat)}</div>
              </section>
            `
          : html`<button class="btn" @click=${props.onToggleWorkbench}>Open Workbench</button>`
      }

      ${
        props.paletteOpen
          ? html`
              <div class="workforce-palette-backdrop" @click=${props.onTogglePalette}></div>
              <div class="card workforce-palette" role="dialog" aria-label="Command palette">
                <div class="card-title">Command Palette</div>
                <div class="card-sub">Cmd/Ctrl + K</div>
                <div class="workforce-palette-actions">
                  <button class="btn" @click=${() => props.onPaletteAction("standup")}>Start daily standup</button>
                  <button class="btn" @click=${() => props.onPaletteAction("retro")}>Run weekly retro</button>
                  <button class="btn" @click=${() => props.onPaletteAction("engineering")}>Open engineering tab</button>
                  <button class="btn" @click=${() => props.onPaletteAction("decisions")}>Open decision cards</button>
                </div>
              </div>
            `
          : null
      }
    </section>
  `;
}

function renderWorkbenchBody(
  props: WorkforceProps,
  selectedSeat: (typeof WORKFORCE_ROSTER)[number],
  queueBySeat: Map<string, { pending: number; concurrency: number }>,
) {
  if (props.activeWorkbenchTab === "decisions") {
    const decisions = props.decisions.filter((entry) => entry.status === "pending");
    return html`
      <div class="workforce-decisions">
        ${
          decisions.length === 0
            ? html`
                <div class="muted">No pending approvals.</div>
              `
            : decisions.map(
                (item) => html`
                  <article class="decision-card">
                    <div class="decision-card__title">${item.title}</div>
                    <div class="card-sub">${item.summary}</div>
                    <div class="decision-card__cmd mono">${item.seatId}</div>
                    <div class="decision-card__actions">
                      <button class="btn btn-danger" @click=${() => props.onDecisionResolve(item.decisionId, "deny")}>Deny</button>
                      <button class="btn" @click=${() => props.onDecisionResolve(item.decisionId, "allow")}>Approve</button>
                    </div>
                  </article>
                `,
              )
        }
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "replay") {
    const frames = props.replayframes.slice(0, 60);
    return html`
      <div class="workforce-activity-list">
        ${
          frames.length === 0
            ? html`
                <div class="muted">No replay frames available.</div>
              `
            : frames.map(
                (frame) => html`
                  <div class="workforce-activity-item">
                    <span>${frame.eventType}</span>
                    <span class="mono">#${frame.seq} ${frame.runId}</span>
                    <button class="btn btn-subtle" @click=${() => props.onReplayRun(frame.runId)}>Replay</button>
                  </div>
                `,
              )
        }
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "memory") {
    const receipts = props.receipts.slice(0, 20);
    return html`
      <div class="card-sub">Policy memory and receipts are persisted and queryable.</div>
      <ul class="mono">
        <li>Receipts: ${props.workspace ? "enabled" : "unknown"}</li>
        <li>AppFolio writeback required: ${props.workspace?.appfolioWritebackEnforced ? "yes" : "no"}</li>
      </ul>
      <div class="workforce-activity-list">
        ${receipts.map(
          (receipt) => html`
            <div class="workforce-activity-item">
              <span>${receipt.action} ${receipt.outcome}</span>
              <span class="mono">${new Date(receipt.ts).toLocaleTimeString()}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "engineering") {
    return html`
      <div class="card-sub">Engineering pipeline actions execute through policy gates.</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
        <button class="btn" @click=${() => props.onExecuteAction("scheduler", "engineering.spec")}>Spec</button>
        <button class="btn" @click=${() => props.onExecuteAction("scheduler", "engineering.implement")}>Implement</button>
        <button class="btn" @click=${() => props.onExecuteAction("qa-reviewer", "engineering.test")}>Test</button>
        <button class="btn" @click=${() => props.onExecuteAction("ops-lead", "engineering.stage")}>Stage</button>
        <button
          class="btn"
          @click=${() =>
            props.onExecuteAction("ops-lead", "deploy.prod", {
              requireWritebackReceipt: false,
            })}
        >
          Prod deploy
        </button>
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "conversations") {
    const runs = props.runs.slice(0, 16);
    return html`
      <div class="workforce-activity-list">
        ${
          runs.length === 0
            ? html`
                <div class="muted">No conversations yet.</div>
              `
            : runs.map(
                (run) => html`
                  <div class="workforce-activity-item">
                    <span>${run.seatId}  ${run.action}</span>
                    <span class="mono">${run.status}</span>
                  </div>
                `,
              )
        }
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "seat-chat") {
    const actions = selectedSeat.permissions.map(permissionToAction);
    const queue = queueBySeat.get(selectedSeat.id);
    return html`
      <div class="card-sub">Selected seat: ${selectedSeat.label}</div>
      <ul class="mono">
        <li>autonomy: ${selectedSeat.autonomyMode}</li>
        <li>queue pending: ${queue?.pending ?? 0}</li>
        <li>systems: ${selectedSeat.systemsAccess.join(", ")}</li>
      </ul>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
        ${actions.map(
          (action) => html`
            <button
              class="btn btn-subtle"
              @click=${() =>
                props.onExecuteAction(selectedSeat.id, action, {
                  requireWritebackReceipt: action.startsWith("appfolio."),
                })}
            >
              ${action}
            </button>
          `,
        )}
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "team-chat") {
    const queues = props.status?.queues ?? [];
    return html`
      <div class="card-sub">Queue and dispatch posture across the workforce.</div>
      <div class="workforce-activity-list">
        ${queues.map(
          (queue) => html`
            <div class="workforce-activity-item">
              <span>${queue.name} pending=${queue.pending} concurrency=${queue.concurrency}</span>
              <button class="btn btn-subtle" @click=${() => props.onExecuteAction(queue.seatId, `queue.drain:${queue.seatId}`)}>Drain</button>
            </div>
          `,
        )}
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "internal-chats") {
    const recent = props.decisions.slice(0, 20);
    return html`
      <div class="card-sub">Decision chatter and escalations.</div>
      <div class="workforce-activity-list">
        ${
          recent.length === 0
            ? html`
                <div class="muted">No internal decision traffic.</div>
              `
            : recent.map(
                (decision) => html`
                  <div class="workforce-activity-item">
                    <span>${decision.title}</span>
                    <span class="mono">${decision.status}</span>
                  </div>
                `,
              )
        }
      </div>
    `;
  }

  return html`<div class="muted">${props.activeWorkbenchTab}</div>`;
}
