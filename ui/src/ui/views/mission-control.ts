import { html } from "lit";
import type { WorkforceStatus } from "../types.js";

export type MissionControlProps = {
  connected: boolean;
  status: WorkforceStatus | null;
};

export function renderMissionControl(props: MissionControlProps) {
  const summary = props.status?.summary;
  const seats = props.status?.seats ?? [];
  const autonomous =
    summary?.autonomy?.autonomous ??
    seats.filter((seat) => seat.autonomyMode === "autonomous").length;
  const supervised =
    summary?.autonomy?.supervised ??
    seats.filter((seat) => seat.autonomyMode === "supervised").length;
  const manual =
    summary?.autonomy?.manual ?? seats.filter((seat) => seat.autonomyMode === "manual").length;

  return html`
    <section class="grid grid-cols-3">
      <article class="stat-card stat">
        <div class="stat-label">Gateway</div>
        <div class="stat-value ${props.connected ? "ok" : "warn"}">${props.connected ? "Online" : "Offline"}</div>
      </article>
      <article class="stat-card stat">
        <div class="stat-label">Workforce readiness</div>
        <div class="stat-value ${props.status?.readiness === "degraded" ? "warn" : "ok"}">${props.status?.readiness ?? "unknown"}</div>
      </article>
      <article class="stat-card stat">
        <div class="stat-label">Pending decisions</div>
        <div class="stat-value">${summary?.pendingDecisions ?? 0}</div>
      </article>
      <article class="stat-card stat">
        <div class="stat-label">Pressured queues</div>
        <div class="stat-value">${summary?.queuesPressured ?? 0}</div>
      </article>
      <article class="card">
        <div class="card-title">Autonomy distribution</div>
        <div class="status-list">
          <div><span>autonomous</span><span class="mono">${autonomous}</span></div>
          <div><span>supervised</span><span class="mono">${supervised}</span></div>
          <div><span>manual</span><span class="mono">${manual}</span></div>
        </div>
      </article>
      <article class="card">
        <div class="card-title">Topology</div>
        <div class="status-list">
          <div><span>Seats</span><span class="mono">${summary?.seats ?? 0}</span></div>
          <div><span>Queues</span><span class="mono">${summary?.queues ?? 0}</span></div>
          <div><span>Schedules</span><span class="mono">${summary?.schedules ?? 0}</span></div>
          <div><span>Runs (24h)</span><span class="mono">${summary?.recentRuns24h ?? 0}</span></div>
        </div>
      </article>
      <article class="card" style="grid-column: span 2;">
        <div class="card-title">Next steps</div>
        <div class="card-sub">Mission Control is metrics-only by design. Execute actions in Workforce.</div>
        <div class="status-list">
          ${(props.status?.nextSteps ?? [])
            .slice(0, 4)
            .map(
              (step) =>
                html`<div><span>${step.title}</span><span class="mono">${step.priority}</span></div>`,
            )}
        </div>
      </article>
    </section>
  `;
}
