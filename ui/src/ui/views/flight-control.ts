import { html } from "lit";
import type { ExecApprovalRequest } from "../controllers/exec-approval.js";

export function renderFlightControl(props: { decisions: ExecApprovalRequest[] }) {
  return html`
    <section class="card">
      <div class="card-title">Audit ledger</div>
      <div class="card-sub">Read-only decisions and overrides.</div>
      <div class="workforce-activity-list">
        ${
          props.decisions.length === 0
            ? html`
                <div class="muted">No decision records yet.</div>
              `
            : props.decisions.map(
                (item) => html`
                <div class="workforce-activity-item">
                  <span>${item.request.command}</span>
                  <span class="mono">${item.request.host ?? "gateway"}</span>
                </div>
              `,
              )
        }
      </div>
    </section>
  `;
}
