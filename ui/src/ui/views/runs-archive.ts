import { html } from "lit";
import type { WorkforceRun } from "../types.js";

type TimelineBucket = {
  hourStartMs: number;
  total: number;
  blocked: number;
  escalated: number;
};

function buildRunTimeline(runs: WorkforceRun[], hours = 12): TimelineBucket[] {
  const now = Date.now();
  const currentHour = now - (now % (60 * 60 * 1000));
  const buckets = new Map<number, TimelineBucket>();
  for (let i = hours - 1; i >= 0; i -= 1) {
    const hourStartMs = currentHour - i * 60 * 60 * 1000;
    buckets.set(hourStartMs, { hourStartMs, total: 0, blocked: 0, escalated: 0 });
  }
  for (const run of runs) {
    const hourStartMs = run.startedAtMs - (run.startedAtMs % (60 * 60 * 1000));
    const bucket = buckets.get(hourStartMs);
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (run.status === "blocked") {
      bucket.blocked += 1;
    }
    if (run.status === "escalated") {
      bucket.escalated += 1;
    }
  }
  return [...buckets.values()];
}

export function renderRunsArchive(props: {
  runs: WorkforceRun[];
  onReplayRun: (runId: string) => void;
}) {
  const entries = props.runs.slice(0, 200);
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  const escalated = entries.filter((entry) => entry.status === "escalated").length;
  const timeline = buildRunTimeline(entries, 12);
  const timelineMax = Math.max(1, ...timeline.map((bucket) => bucket.total));
  return html`
    <section class="card">
      <div class="card-title">Runs archive</div>
      <div class="card-sub">Unified run envelope across workforce actions and scheduled operations.</div>
      <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
        <span class="pill">total: ${entries.length}</span>
        <span class="pill warn">blocked: ${blocked}</span>
        <span class="pill">escalated: ${escalated}</span>
      </div>
      <div class="workforce-timeline" style="margin-top:10px;">
        ${timeline.map((bucket) => {
          const width = Math.max(6, Math.round((bucket.total / timelineMax) * 100));
          const blockedWidth =
            bucket.total > 0 ? Math.max(2, Math.round((bucket.blocked / bucket.total) * width)) : 0;
          const escalatedWidth =
            bucket.total > 0
              ? Math.max(2, Math.round((bucket.escalated / bucket.total) * width))
              : 0;
          return html`
            <div class="workforce-timeline-row">
              <span class="mono workforce-timeline-label">${new Date(bucket.hourStartMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span class="workforce-timeline-track">
                <span class="workforce-timeline-fill" style=${`width:${width}%`}></span>
                ${
                  blockedWidth > 0
                    ? html`<span class="workforce-timeline-segment workforce-timeline-segment--blocked" style=${`width:${blockedWidth}%`}></span>`
                    : null
                }
                ${
                  escalatedWidth > 0
                    ? html`<span class="workforce-timeline-segment workforce-timeline-segment--escalated" style=${`width:${escalatedWidth}%`}></span>`
                    : null
                }
              </span>
              <span class="mono workforce-timeline-count">${bucket.total}</span>
            </div>
          `;
        })}
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
