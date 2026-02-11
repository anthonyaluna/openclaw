import { html } from "lit";
import type { WorkforceWorkspace } from "../types.js";

export function renderAppfolioWorkspace(props: {
  workspace: WorkforceWorkspace | null;
  lastWritebackReceiptId: string | null;
  onOpenInWorkforce: () => void;
  onRecordWriteback: () => void;
  onExecuteCommsAction: (action: string) => void;
}) {
  return html`
    <section class="card">
      <div class="card-title">AppFolio Workspace</div>
      <div class="card-sub">
        Controlled execution bay. Communications are policy-gated and can require writeback receipts.
      </div>
      <div class="status-list" style="margin-top:10px;">
        <div>
          <span>Writeback enforcement</span>
          <span class="mono">${props.workspace?.appfolioWritebackEnforced ? "enabled" : "disabled"}</span>
        </div>
        <div>
          <span>Default channel</span>
          <span class="mono">${props.workspace?.defaultChannel ?? "appfolio"}</span>
        </div>
      </div>
      ${
        props.lastWritebackReceiptId
          ? html`<div class="card-sub mono" style="margin-top:8px;">Latest receipt: ${props.lastWritebackReceiptId}</div>`
          : html`
              <div class="card-sub" style="margin-top: 8px">No writeback receipt recorded yet.</div>
            `
      }
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" @click=${props.onRecordWriteback}>Record writeback receipt</button>
        <button
          class="btn"
          @click=${() => props.onExecuteCommsAction("appfolio.comms.broadcast.owner-update")}
        >
          Owner update
        </button>
        <button
          class="btn"
          @click=${() => props.onExecuteCommsAction("appfolio.comms.broadcast.vendor-followup")}
        >
          Vendor follow-up
        </button>
        <button
          class="btn"
          @click=${() => props.onExecuteCommsAction("appfolio.comms.broadcast.tenant-notice")}
        >
          Tenant notice
        </button>
        <button class="btn btn-subtle" @click=${props.onOpenInWorkforce}>Open context in Workforce</button>
      </div>
    </section>
  `;
}
