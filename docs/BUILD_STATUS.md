# Workforce Build Status

## Current state

- ✅ Workforce-first navigation now exists in Control UI with dedicated pages:
  - Workforce
  - Mission Control
  - Flight Control
  - Runs
  - AppFolio Workspace
- ✅ Workforce page has the required interaction shell:
  - Office Canvas (left)
  - Live Activity feed (right)
  - Workbench (bottom/openable)
- ✅ Workbench tabs are present:
  - Seat Chat, Team Chat, Internal Chats, Conversations, Decisions, Replay, Memory, Engineering
- ✅ Command palette is wired to Cmd/Ctrl+K and supports key actions.
- ✅ Inline Decision Cards are visible in Workforce Workbench using existing exec approval queue.
- ✅ New roster source-of-truth added at `src/workforce/roster.ts` and wired into Workforce seat rendering.

## Enforcement and separation status

- ✅ Mission Control is metrics-only in current UI implementation.
- ✅ Flight Control is read-only audit-style ledger view.
- ✅ Runs page is archive/read-only event history surface.
- ✅ AppFolio Workspace page exists as controlled execution bay entry surface.
- ⚠️ Deep runtime policy engine, autonomous queues/schedules, replay receipts, and AppFolio writeback enforcement are not fully implemented yet in this PR; this PR establishes page separation + primary UX shell.

## What shipped in this change

1. Workforce nav and route model updates (`ui/src/ui/navigation.ts`).
2. Workforce page and subpages:
   - `ui/src/ui/views/workforce.ts`
   - `ui/src/ui/views/mission-control.ts`
   - `ui/src/ui/views/flight-control.ts`
   - `ui/src/ui/views/runs-archive.ts`
   - `ui/src/ui/views/appfolio-workspace.ts`
3. Workforce rendering integration in `ui/src/ui/app-render.ts`.
4. Workforce UI state additions in:
   - `ui/src/ui/app-view-state.ts`
   - `ui/src/ui/app.ts`
5. Workforce styling in `ui/src/styles/components.css`.
6. Workforce icon support in `ui/src/ui/icons.ts`.
7. Navigation tests updated for new tabs in `ui/src/ui/navigation.test.ts`.
8. Roster source-of-truth in `src/workforce/roster.ts`.

## Next PR

- Implement runtime workforce core:
  - strict autonomy engine (`FullAutonomy`, `RequestApproval`, `Observe`)
  - persistent seat queues + schedules + patrol/retro runners
  - policy engine (`Allow`/`Block`/`Escalate`) with hard boundaries
  - receipts + replayframes emission and one-click replay
  - AppFolio writeback enforcement for comms
