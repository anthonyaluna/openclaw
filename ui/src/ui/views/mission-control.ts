import { html } from "lit";
import { WORKFORCE_ROSTER } from "../../../../src/workforce/roster.js";

export type MissionControlProps = {
  connected: boolean;
  pendingDecisions: number;
  eventsPerMinute: number;
};

export function renderMissionControl(props: MissionControlProps) {
  const fullAutonomy = WORKFORCE_ROSTER.filter(
    (seat) => seat.autonomyMode === "FullAutonomy",
  ).length;
  const requestApproval = WORKFORCE_ROSTER.filter(
    (seat) => seat.autonomyMode === "RequestApproval",
  ).length;
  const observe = WORKFORCE_ROSTER.filter((seat) => seat.autonomyMode === "Observe").length;

  return html`
    <section class="grid grid-cols-3">
      <article class="stat-card stat">
        <div class="stat-label">Gateway</div>
        <div class="stat-value ${props.connected ? "ok" : "warn"}">${props.connected ? "Online" : "Offline"}</div>
      </article>
      <article class="stat-card stat">
        <div class="stat-label">Pending decisions</div>
        <div class="stat-value">${props.pendingDecisions}</div>
      </article>
      <article class="stat-card stat">
        <div class="stat-label">Activity velocity</div>
        <div class="stat-value">${props.eventsPerMinute}/min</div>
      </article>
      <article class="card">
        <div class="card-title">Autonomy distribution</div>
        <div class="status-list">
          <div><span>FullAutonomy</span><span class="mono">${fullAutonomy}</span></div>
          <div><span>RequestApproval</span><span class="mono">${requestApproval}</span></div>
          <div><span>Observe</span><span class="mono">${observe}</span></div>
        </div>
      </article>
      <article class="card" style="grid-column: span 2;">
        <div class="card-title">Health only</div>
        <div class="card-sub">Mission Control is metrics-only by design. Operational actions stay in Workforce.</div>
      </article>
    </section>
  `;
}
