import { html } from "lit";
import type { EventLogEntry } from "../app-events.js";
import type { ExecApprovalRequest } from "../controllers/exec-approval.js";
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

export type WorkforceProps = {
  eventLog: EventLogEntry[];
  decisions: ExecApprovalRequest[];
  workbenchOpen: boolean;
  activeWorkbenchTab: WorkforceWorkbenchTab;
  paletteOpen: boolean;
  onToggleWorkbench: () => void;
  onSelectWorkbenchTab: (tab: WorkforceWorkbenchTab) => void;
  onTogglePalette: () => void;
  onPaletteAction: (action: "standup" | "retro" | "engineering" | "decisions") => void;
  onDecision: (decision: "allow-once" | "deny") => void;
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

export function renderWorkforce(props: WorkforceProps) {
  const activity = props.eventLog.slice(-12).toReversed();
  const seats = WORKFORCE_ROSTER;

  return html`
    <section class="workforce" @keydown=${(event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        props.onTogglePalette();
      }
      if (event.key === "Escape" && props.workbenchOpen) {
        event.preventDefault();
        props.onToggleWorkbench();
      }
    }} tabindex="0">
      <div class="workforce-grid">
        <section class="card workforce-canvas">
          <div class="card-title">Office Canvas</div>
          <div class="card-sub">Seat roster and autonomy posture. Click any seat to open Workbench.</div>
          <div class="workforce-seats">
            ${seats.map(
              (seat) => html`
                <button
                  class="workforce-seat"
                  @click=${() => {
                    if (!props.workbenchOpen) {
                      props.onToggleWorkbench();
                    }
                    props.onSelectWorkbenchTab("seat-chat");
                  }}
                  title=${seat.description}
                >
                  <div class="workforce-seat__name">${seat.displayName}</div>
                  <div class="workforce-seat__meta">${seat.department} · ${seat.roleTitle}</div>
                  <div class="workforce-seat__mode">${seat.autonomyMode}</div>
                </button>
              `,
            )}
          </div>
        </section>

        <section class="card workforce-activity">
          <div class="card-title">Live Activity</div>
          <div class="card-sub">Approvals and run events. Click to open details in Workbench.</div>
          <div class="workforce-activity-list">
            ${props.decisions.slice(0, 8).map(
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
                  <span>Decision required: ${item.request.command}</span>
                  <span class="mono">${item.request.host ?? "gateway"}</span>
                </button>
              `,
            )}
            ${activity.map(
              (evt) => html`
                <button
                  class="workforce-activity-item"
                  @click=${() => {
                    if (!props.workbenchOpen) {
                      props.onToggleWorkbench();
                    }
                    props.onSelectWorkbenchTab("replay");
                  }}
                >
                  <span>${evt.event}</span>
                  <span class="mono">${new Date(evt.ts).toLocaleTimeString()}</span>
                </button>
              `,
            )}
            ${
              props.decisions.length === 0 && activity.length === 0
                ? html`
                    <div class="muted">No activity yet. Start a run or schedule.</div>
                  `
                : null
            }
          </div>
        </section>
      </div>

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
              <div class="workbench-body">
                ${renderWorkbenchBody(props)}
              </div>
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

function renderWorkbenchBody(props: WorkforceProps) {
  if (props.activeWorkbenchTab === "decisions") {
    return html`
      <div class="workforce-decisions">
        ${
          props.decisions.length === 0
            ? html`
                <div class="muted">No pending approvals.</div>
              `
            : props.decisions.map(
                (item) => html`
                <article class="decision-card">
                  <div class="decision-card__title">Policy decision required</div>
                  <div class="decision-card__cmd mono">${item.request.command}</div>
                  <div class="decision-card__actions">
                    <button class="btn btn-danger" @click=${() => props.onDecision("deny")}>Deny</button>
                    <button class="btn" @click=${() => props.onDecision("allow-once")}>Approve once</button>
                  </div>
                </article>
              `,
              )
        }
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "memory") {
    return html`
      <div class="workforce-memory">
        <div class="card-sub">
          Memory layers are integrated here: episodic, semantic, procedural, canon.
        </div>
        <ul class="mono">
          <li>Observed → Proposed → Tested → Ratified → Enforced → Reviewed → Deprecated</li>
        </ul>
      </div>
    `;
  }

  if (props.activeWorkbenchTab === "engineering") {
    return html`
      <div class="workforce-engineering">
        <div class="card-sub">
          Engineering factory: Spec → Branch → Implement → Test → Review → Stage → Canary → Prod.
        </div>
      </div>
    `;
  }

  return html`<div class="muted">${props.activeWorkbenchTab} surface ready.</div>`;
}
