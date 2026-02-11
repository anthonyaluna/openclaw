import { html } from "lit";
import type { WorkforceDecision, WorkforceReceipt } from "../types.js";

export function renderFlightControl(props: {
  receipts: WorkforceReceipt[];
  decisions: WorkforceDecision[];
}) {
  const items = props.receipts.slice(0, 80);
  const decisions = props.decisions.slice(0, 40);
  return html`
    <section class="grid grid-cols-2">
      <article class="card">
        <div class="card-title">Decision Ledger</div>
        <div class="card-sub">Read-only decisions and overrides.</div>
        <div class="workforce-activity-list">
          ${
            decisions.length === 0
              ? html`
                  <div class="muted">No decision records yet.</div>
                `
              : decisions.map(
                  (decision) => html`
                    <div class="workforce-activity-item">
                      <span>${decision.title}</span>
                      <span class="mono">${decision.status}</span>
                    </div>
                  `,
                )
          }
        </div>
      </article>
      <article class="card">
        <div class="card-title">Receipt Ledger</div>
        <div class="card-sub">Immutable execution and policy receipts.</div>
        <div class="workforce-activity-list">
          ${
            items.length === 0
              ? html`
                  <div class="muted">No receipts yet.</div>
                `
              : items.map(
                  (item) => html`
                    <div class="workforce-activity-item">
                      <span>${item.action} ${item.outcome}</span>
                      <span class="mono">${new Date(item.ts).toLocaleString()}</span>
                    </div>
                  `,
                )
          }
        </div>
      </article>
    </section>
  `;
}
