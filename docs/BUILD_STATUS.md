# Workforce Build Status

## Current state

- Workforce first navigation exists in Control UI with dedicated pages: Workforce, Mission Control, Flight Control, Runs, AppFolio Workspace.
- Workforce page includes Office Canvas, Live Activity, and Workbench panels.
- Workbench tabs are present: Seat Chat, Team Chat, Internal Chats, Conversations, Decisions, Replay, Memory, Engineering.
- Command palette is wired to Cmd/Ctrl+K.
- Inline decision cards are visible in Workforce Workbench.

## Runtime and policy status

- Mission Control is metrics only.
- Flight Control is a read-only ledger surface.
- Runs is a read-only archive with replay action support.
- AppFolio Workspace enforces writeback receipt context for gated actions.
- Workforce runtime includes policy decisions, decision cards, receipts, replay frames, schedules, and periodic scheduler ticks.
- Workforce status now includes autonomy summary, queue pressure metrics, and actionable next-step guidance.

## Shipped implementation

1. Workforce navigation and routing:
   - `ui/src/ui/navigation.ts`
2. Workforce views:
   - `ui/src/ui/views/workforce.ts`
   - `ui/src/ui/views/mission-control.ts`
   - `ui/src/ui/views/flight-control.ts`
   - `ui/src/ui/views/runs-archive.ts`
   - `ui/src/ui/views/appfolio-workspace.ts`
3. Workforce render integration:
   - `ui/src/ui/app-render.ts`
4. Workforce UI state:
   - `ui/src/ui/app-view-state.ts`
   - `ui/src/ui/app.ts`
5. Workforce runtime service and store:
   - `src/workforce/types.ts`
   - `src/workforce/store.ts`
   - `src/workforce/service.ts`
6. Gateway protocol and handlers:
   - `src/gateway/protocol/schema/workforce.ts`
   - `src/gateway/server-methods/workforce.ts`
7. Workforce CLI command family:
   - `src/cli/workforce-cli.ts`
8. Roster source of truth:
   - `src/workforce/roster.ts`
