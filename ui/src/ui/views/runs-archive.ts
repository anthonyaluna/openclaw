import { html } from "lit";
import type { EventLogEntry } from "../app-events.js";

export function renderRunsArchive(props: { eventLog: EventLogEntry[] }) {
  const entries = props.eventLog.slice(-100).toReversed();
  return html`
    <section class="card">
      <div class="card-title">Runs archive</div>
      <div class="card-sub">Forensic search surface (read-only).</div>
      <div class="workforce-activity-list">
        ${
          entries.length === 0
            ? html`
                <div class="muted">No archived run events available.</div>
              `
            : entries.map(
                (entry) => html`
                <div class="workforce-activity-item">
                  <span>${entry.event}</span>
                  <span class="mono">${new Date(entry.ts).toLocaleString()}</span>
                </div>
              `,
              )
        }
      </div>
    </section>
  `;
}
