import { html } from "lit";
import type { AppfolioReportsProbeResult, WorkforceWorkspace } from "../types.js";

export function renderAppfolioWorkspace(props: {
  workspace: WorkforceWorkspace | null;
  lastWritebackReceiptId: string | null;
  probeLoading: boolean;
  probeResult: AppfolioReportsProbeResult | null;
  onOpenInWorkforce: () => void;
  onRecordWriteback: () => void;
  onProbeReportsApi: () => void;
  onExecuteCommsAction: (action: string) => void;
  onRunReportPreset: (presetId: "rent_roll" | "delinquency" | "work_order") => void;
  onInstallReportSchedules: () => void;
  onRunSmartBillDaily: () => void;
  onInstallSmartBillDailySchedule: () => void;
}) {
  const probe = props.probeResult;
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
        <div>
          <span>Policy profile</span>
          <span class="mono">${props.workspace?.policyProfile ?? "balanced"}</span>
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
        <button class="btn btn-subtle" @click=${props.onProbeReportsApi} ?disabled=${props.probeLoading}>
          ${props.probeLoading ? "Probing Reports API..." : "Probe Reports API"}
        </button>
        <button class="btn" @click=${props.onRunSmartBillDaily}>Run Smart Bill daily (API)</button>
        <button class="btn btn-subtle" @click=${props.onInstallSmartBillDailySchedule}>
          Install Smart Bill daily schedule
        </button>
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
        <button class="btn" @click=${() => props.onRunReportPreset("rent_roll")}>Run rent roll</button>
        <button class="btn" @click=${() => props.onRunReportPreset("delinquency")}>Run delinquency</button>
        <button class="btn" @click=${() => props.onRunReportPreset("work_order")}>Run work order</button>
        <button class="btn btn-subtle" @click=${props.onInstallReportSchedules}>
          Install report schedules
        </button>
        <button class="btn btn-subtle" @click=${props.onOpenInWorkforce}>Open context in Workforce</button>
      </div>
      ${
        probe
          ? html`
              <div class="status-list" style="margin-top: 12px;">
                <div>
                  <span>Reports API</span>
                  <span class="mono">${probe.ok ? "ok" : "not ready"}</span>
                </div>
                <div>
                  <span>Token</span>
                  <span class="mono">${probe.token.acquired ? `acquired (${probe.token.source})` : "not acquired"}</span>
                </div>
                <div>
                  <span>Reports endpoint</span>
                  <span class="mono">${probe.reports.endpoint ?? probe.reports.error ?? "unknown"}</span>
                </div>
                <div>
                  <span>Configured creds</span>
                  <span class="mono">${probe.configured.clientId && probe.configured.clientSecret ? "yes" : "no"}</span>
                </div>
              </div>
              ${
                probe.error
                  ? html`<div class="card-sub mono" style="margin-top:8px;">${probe.error}</div>`
                  : null
              }
              ${
                probe.warnings.length
                  ? html`<div class="card-sub" style="margin-top:8px;">${probe.warnings.join(" ")}</div>`
                  : null
              }
            `
          : html`
              <div class="card-sub" style="margin-top: 8px">
                Run "Probe Reports API" to verify credentials and endpoint access.
              </div>
            `
      }
    </section>
  `;
}
