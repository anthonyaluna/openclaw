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
  const policy = summary?.policyDecisions ?? { allow: 0, block: 0, escalate: 0 };
  const risk = summary?.riskLevels ?? { low: 0, medium: 0, high: 0 };
  const totalPolicy = Math.max(1, policy.allow + policy.block + policy.escalate);
  const totalRisk = Math.max(1, risk.low + risk.medium + risk.high);
  const allowPct = Math.round((policy.allow / totalPolicy) * 100);
  const blockPct = Math.round((policy.block / totalPolicy) * 100);
  const escalatePct = Math.round((policy.escalate / totalPolicy) * 100);
  const lowPct = Math.round((risk.low / totalRisk) * 100);
  const mediumPct = Math.round((risk.medium / totalRisk) * 100);
  const highPct = Math.round((risk.high / totalRisk) * 100);

  return html`
    <section class="grid grid-cols-4">
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
      <article class="stat-card stat">
        <div class="stat-label">Lagging schedules</div>
        <div class="stat-value ${summary?.schedulesLagging ? "warn" : "ok"}">${summary?.schedulesLagging ?? 0}</div>
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
      <article class="card">
        <div class="card-title">Policy outcomes (24h)</div>
        <div class="status-list">
          <div><span>allow</span><span class="mono">${policy.allow} (${allowPct}%)</span></div>
          <div><span>block</span><span class="mono">${policy.block} (${blockPct}%)</span></div>
          <div><span>escalate</span><span class="mono">${policy.escalate} (${escalatePct}%)</span></div>
        </div>
      </article>
      <article class="card">
        <div class="card-title">Risk mix (24h)</div>
        <div class="status-list">
          <div><span>low</span><span class="mono">${risk.low} (${lowPct}%)</span></div>
          <div><span>medium</span><span class="mono">${risk.medium} (${mediumPct}%)</span></div>
          <div><span>high</span><span class="mono">${risk.high} (${highPct}%)</span></div>
        </div>
      </article>
      <article class="card" style="grid-column: span 4;">
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
