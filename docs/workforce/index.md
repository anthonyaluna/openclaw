---
summary: "Workforce operating model in Control UI and gateway"
read_when:
  - You are operating Workforce tabs in Control UI
  - You need Workforce CLI and gateway method references
title: "Workforce"
status: active
---

# Workforce

Workforce is a first class operating surface in OpenClaw. It builds on existing multi-agent, session, cron, and approval primitives and exposes them through dedicated UI pages, gateway methods, and CLI commands.

The current implementation includes:

- autonomy-aware policy decisions (`allow`, `block`, `escalate`)
- decision cards with resolution flow
- receipts and replay frames
- schedule ticking and run archival
- guidance-oriented `nextSteps` surfaced in Mission Control and Workforce

## Available pages

- Workforce
- Mission Control
- Flight Control
- Runs
- AppFolio Workspace

## Where to access

- Control UI routes:
  - `/workforce`
  - `/mission-control`
  - `/flight-control`
  - `/runs`
  - `/appfolio-workspace`
- CLI:
  - `openclaw workforce status`
  - `openclaw workforce runs`
  - `openclaw workforce decisions`
  - `openclaw workforce action <seatId> <action>`

## Behavior boundaries

- Mission Control is metrics only.
- Flight Control is read-only.
- Runs is read-only archive and replay initiation.
- AppFolio Workspace is policy-gated and enforces writeback receipt context for configured actions.

## Rollout checklist

Before production rollout:

1. Ensure gateway runtime paths are aligned for CLI and service installs.
2. Verify `openclaw gateway status` reports the expected binary and config path.
3. Set required integration env vars such as `OPENCLAW_M365_WEBHOOK_BASE_URL` when M365 webhook sync is enabled.
4. Verify Workforce paths and commands:
   - `/workforce`
   - `/mission-control`
   - `/flight-control`
   - `/runs`
   - `/appfolio-workspace`
   - `openclaw workforce status`
   - `openclaw workforce next-steps`

## Related pages

- [Navigation map](/workforce/nav-map)
- [Mission Control](/workforce/mission-control)
- [Flight Control](/workforce/flight-control)
- [Runs](/workforce/runs)
- [AppFolio Workspace](/workforce/workspace)
- [Architecture decisions](/workforce/architecture)
