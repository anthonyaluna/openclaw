import { html } from "lit";
import type { WorkforceRun } from "../types.js";

export function renderRunsArchive(props: {
  runs: WorkforceRun[];
  onReplayRun: (runId: string) => void;
}) {
  const entries = props.runs.slice(0, 200);
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  const escalated = entries.filter((entry) => entry.status === "escalated").length;
  return html`
    <section class="card">
      <div class="card-title">Runs archive</div>
      <div class="card-sub">Unified run envelope across workforce actions and scheduled operations.</div>
      <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
        <span class="pill">total: ${entries.length}</span>
        <span class="pill warn">blocked: ${blocked}</span>
        <span class="pill">escalated: ${escalated}</span>
      </div>
      <div class="workforce-activity-list">
        ${
          entries.length === 0
            ? html`
                <div class="muted">No archived run events available.</div>
              `
            : entries.map(
                (entry) => html`
                  <div class="workforce-activity-item">
                    <span>${entry.action}  ${entry.status}</span>
                    <span class="mono">${new Date(entry.startedAtMs).toLocaleString()}</span>
                    <button class="btn btn-subtle" @click=${() => props.onReplayRun(entry.runId)}>Replay</button>
                  </div>
                `,
              )
        }
      </div>
    </section>
  `;
}
