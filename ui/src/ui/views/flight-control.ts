import { html } from "lit";
import type { WorkforceDecision, WorkforceReceipt } from "../types.js";

type DecisionTimelineBucket = {
  hourStartMs: number;
  decisions: number;
  resolved: number;
};

function buildDecisionTimeline(
  decisions: WorkforceDecision[],
  hours = 12,
): DecisionTimelineBucket[] {
  const now = Date.now();
  const currentHour = now - (now % (60 * 60 * 1000));
  const buckets = new Map<number, DecisionTimelineBucket>();
  for (let i = hours - 1; i >= 0; i -= 1) {
    const hourStartMs = currentHour - i * 60 * 60 * 1000;
    buckets.set(hourStartMs, { hourStartMs, decisions: 0, resolved: 0 });
  }
  for (const decision of decisions) {
    const hourStartMs = decision.createdAtMs - (decision.createdAtMs % (60 * 60 * 1000));
    const bucket = buckets.get(hourStartMs);
    if (!bucket) {
      continue;
    }
    bucket.decisions += 1;
    if (decision.status === "resolved") {
      bucket.resolved += 1;
    }
  }
  return [...buckets.values()];
}

export function renderFlightControl(props: {
  receipts: WorkforceReceipt[];
  decisions: WorkforceDecision[];
}) {
  const items = props.receipts.slice(0, 80);
  const decisions = props.decisions.slice(0, 40);
  const timeline = buildDecisionTimeline(decisions, 12);
  const timelineMax = Math.max(1, ...timeline.map((bucket) => bucket.decisions));
  return html`
    <section class="grid grid-cols-2">
      <article class="card">
        <div class="card-title">Decision Ledger</div>
        <div class="card-sub">Read-only decisions and overrides.</div>
        <div class="workforce-timeline" style="margin-top:10px;">
          ${timeline.map((bucket) => {
            const width = Math.max(6, Math.round((bucket.decisions / timelineMax) * 100));
            const resolvedWidth =
              bucket.decisions > 0
                ? Math.max(2, Math.round((bucket.resolved / bucket.decisions) * width))
                : 0;
            return html`
              <div class="workforce-timeline-row">
                <span class="mono workforce-timeline-label">${new Date(bucket.hourStartMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span class="workforce-timeline-track">
                  <span class="workforce-timeline-fill" style=${`width:${width}%`}></span>
                  ${
                    resolvedWidth > 0
                      ? html`<span class="workforce-timeline-segment workforce-timeline-segment--resolved" style=${`width:${resolvedWidth}%`}></span>`
                      : null
                  }
                </span>
                <span class="mono workforce-timeline-count">${bucket.decisions}</span>
              </div>
            `;
          })}
        </div>
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
