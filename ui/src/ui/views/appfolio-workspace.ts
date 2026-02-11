import { html } from "lit";

export function renderAppfolioWorkspace(props: { onOpenInWorkforce: () => void }) {
  return html`
    <section class="card">
      <div class="card-title">AppFolio Workspace</div>
      <div class="card-sub">
        Controlled execution bay. Tenant/vendor/owner comms require writeback receipts.
      </div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" @click=${props.onOpenInWorkforce}>Open context in Workforce</button>
        <button class="btn btn-subtle" disabled>Launch controlled browser (pending integration)</button>
      </div>
    </section>
  `;
}
