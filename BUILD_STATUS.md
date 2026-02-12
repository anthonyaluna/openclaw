# Workforce Build Status

## Status Summary

- **Overall:** Completed baseline Workforce implementation (UI + gateway + CLI + store).
- **Date:** February 11, 2026
- **Confidence:** High for shipped scope including expanded analytics, timeline views, and policy profiles.

## Shipped Scope

1. **Dedicated Workforce pages in Control UI**
   - Tabs and routes: Workforce, Mission Control, Flight Control, Runs, AppFolio Workspace
   - Files: `ui/src/ui/navigation.ts`, `ui/src/ui/app-render.ts`, `ui/src/ui/views/*`
2. **Gateway `workforce.*` API namespace**
   - Added protocol schemas, validators, server handlers, method registry entries
   - Files: `src/gateway/protocol/schema/workforce.ts`, `src/gateway/server-methods/workforce.ts`, related protocol wiring files
3. **Persistent Workforce runtime**
   - Store-backed queues, schedules, runs, decisions, receipts, replay frames, workspace policy
   - Files: `src/workforce/store.ts`, `src/workforce/service.ts`, `src/workforce/types.ts`
4. **Workforce CLI**
   - `openclaw workforce ...` command family for status, runs, decisions, actions, schedules, replay, writeback
   - File: `src/cli/workforce-cli.ts`
5. **Scheduler integration**
   - Gateway background tick for workforce schedules with update broadcasts
   - File: `src/gateway/server.impl.ts`
6. **Roster source of truth**
   - Central typed roster + derived queue/scheduler/UI projections
   - File: `src/workforce/roster.ts`
7. **Tests**
   - Roster, service, and CLI registration coverage
   - Files: `src/workforce/roster.test.ts`, `src/workforce/service.test.ts`, `src/cli/program/register.subclis.test.ts`
8. **Autonomy guidance**
   - Workforce status now exposes queue pressure and actionable next-step guidance for operators and autonomous workflows
9. **Expanded analytics and policy profile layer**
   - Mission Control includes policy outcome and risk analytics plus lagging schedule signal
   - Flight Control and Runs include hourly timeline buckets
   - Runtime supports additional policy profiles (`balanced`, `strict-change-control`, `autonomous-ops`)

## Access Points

- **Control UI pages**
  - `http://127.0.0.1:18789/workforce`
  - `http://127.0.0.1:18789/mission-control`
  - `http://127.0.0.1:18789/flight-control`
  - `http://127.0.0.1:18789/runs`
  - `http://127.0.0.1:18789/appfolio-workspace`
- **CLI**
  - `openclaw workforce status`
  - `openclaw workforce runs --limit 50`
  - `openclaw workforce decisions`
  - `openclaw workforce action <seatId> <action>`
  - `openclaw workforce schedule-add <seatId> <name> <intervalMs> <action>`

## Non Blocking Runtime Notes

- `memory slot plugin not found or not marked as memory` indicates a config/plugin mismatch for the configured `memorySlot`, not a Workforce runtime failure.
- `m365_webhook_base_url_missing` indicates missing `OPENCLAW_M365_WEBHOOK_BASE_URL` in environments where M365 webhook subscription management is enabled.
