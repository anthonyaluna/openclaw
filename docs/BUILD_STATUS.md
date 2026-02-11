# Workforce Build Status

## Current state

- Requested Workforce pages are **not implemented as first-class pages** yet:
  - Mission Control: missing
  - Flight Control: missing
  - Runs: missing (only distributed run views/state)
  - AppFolio Workspace: missing
- Existing, relevant foundations are strong:
  - Chat surfaces: web + iOS/macOS + Android
  - Control UI tab architecture + controllers/views
  - Run-capable subsystems: chat, sub-agent, cron
  - Approval pipeline: exec approval request/resolve, UI + gateway handlers
  - Workspace and memory primitives already exist

## Mapped equivalents in repo

- Chat/Hub equivalent: `chat` tab (`ui/src/ui/views/chat.ts`) + `docs/web/webchat.md`
- Mission Control equivalent (partial): control tabs in `ui/src/ui/navigation.ts`
- Flight Control equivalent (partial): `cron`, `nodes`, `exec approvals`
- Runs equivalent (partial):
  - `src/gateway/server-chat.ts`
  - `src/agents/subagent-registry.ts`
  - `src/cron/run-log.ts`
- Workspace equivalent (partial):
  - `docs/concepts/agent-workspace.md`
  - `src/agents/workspace.ts`

## Hard blockers

1. No agreed page taxonomy/name mapping for requested labels.
2. No unified run envelope across chat/subagent/cron.
3. No `workforce.*` protocol namespace for consolidated fetches.
4. No first-class receipt/replayframe persistence layer.

## Missing dependencies / decisions

- Product naming decision for Mission Control / Flight Control / AppFolio Workspace.
- Decision on timeline visualization approach (existing lit components only vs adding a chart/timeline dependency).
- Decision on storage target for receipts/replayframes (reuse session transcript storage vs new store).

## Next PR (first PR only)

**PR-A: Workforce information architecture + docs baseline (docs-only)**

- Document the Workforce page taxonomy and explicit mapping to current surfaces.
- Define canonical data model names (seats, queues, schedules, decision cards, receipts, replayframes, memory layers).
- Add architecture decision note for unified run envelope and policy gates.
- Publish milestone roadmap and constraints.
- Keep scope strictly docs-only: no runtime changes.
