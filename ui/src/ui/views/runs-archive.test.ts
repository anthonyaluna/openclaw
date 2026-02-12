import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderRunsArchive } from "./runs-archive.ts";

describe("runs archive view", () => {
  it("replays selected run from archive", () => {
    const container = document.createElement("div");
    const onReplayRun = vi.fn();
    render(
      renderRunsArchive({
        onReplayRun,
        runs: [
          {
            runId: "run-1",
            source: "workforce",
            seatId: "ops-lead",
            action: "queue.assign",
            status: "ok",
            riskLevel: "low",
            policyProfile: "autonomous-ops",
            policyDecision: "allow",
            startedAtMs: Date.now(),
            artifacts: [],
          },
        ],
      }),
      container,
    );

    const replayButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Replay",
    );
    expect(replayButton).toBeDefined();
    replayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onReplayRun).toHaveBeenCalledWith("run-1");
  });
});
