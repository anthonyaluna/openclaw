# Workforce System Build Plan (Plan Mode)

## 0) Audit inventory: requested pages vs current repo

## Requested: Chat/Hub

- **Web Control UI chat tab exists**: `ui/src/ui/navigation.ts` (`chat` tab), `ui/src/ui/views/chat.ts`, `ui/src/ui/controllers/chat.ts`.
- **Webchat docs exist**: `docs/web/webchat.md`.
- **Native chat surfaces exist**:
  - iOS/macOS shared: `apps/shared/OpenClawKit/Sources/OpenClawChatUI/*`
  - Android: `apps/android/app/src/main/java/ai/openclaw/android/ui/chat/*`

## Requested: Mission Control

- **No page named "Mission Control" found.**
- Closest existing surface is **Control UI** with tabs:
  - `overview`, `channels`, `instances`, `sessions`, `usage`, `cron`
  - Source: `ui/src/ui/navigation.ts`, `ui/src/ui/app-render.ts`, `ui/src/ui/views/*`
- Docs: `docs/web/control-ui.md`, `docs/web/dashboard.md`.

## Requested: Flight Control

- **No page named "Flight Control" found.**
- Closest operational control surfaces:
  - Cron operations (`ui/src/ui/views/cron.ts`, `src/cron/*`, `src/gateway/server-methods/cron.ts`)
  - Node/device controls (`ui/src/ui/views/nodes.ts`, `src/gateway/server-methods/nodes.ts`)
  - Exec approvals (`ui/src/ui/controllers/exec-approvals.ts`, `src/gateway/server-methods/exec-approval.ts`)

## Requested: Runs

- **No dedicated top-level "Runs" page exists.**
- Run state is currently distributed:
  - Chat run state: `src/gateway/server-chat.ts`
  - Sub-agent run registry: `src/agents/subagent-registry.ts`
  - Cron run log: `src/cron/run-log.ts`, surfaced in `ui/src/ui/views/cron.ts`
  - Mobile pending run state:
    - `apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatViewModel.swift`
    - `apps/android/app/src/main/java/ai/openclaw/android/chat/ChatController.kt`

## Requested: AppFolio Workspace

- **No "AppFolio Workspace" module/page found in repo.**
- Closest existing concepts:
  - Agent Workspace docs: `docs/concepts/agent-workspace.md`
  - Workspace runtime helpers: `src/agents/workspace.ts`, `src/hooks/workspace.ts`
  - macOS workspace UI bits: `apps/macos/Sources/OpenClaw/AgentWorkspace.swift`

---

## 1) Current system map: state, events, runs, approvals, UI components

## State (client + server)

- **Web UI state container**: `ui/src/ui/app-view-state.ts` (single app state shape for tabs, chat, sessions, usage, approvals, config).
- **Gateway chat run state**: `src/gateway/server-chat.ts` (`createChatRunState`, run registry, buffers, aborted runs).
- **Sub-agent persistent registry**: `src/agents/subagent-registry.ts`.
- **Cron state/store**: `src/cron/store.ts`, `src/cron/service/state.ts`, `src/cron/run-log.ts`.
- **Session state + storage**: `src/config/sessions.ts`, `src/commands/agent/session-store.ts`.

## Events

- **Gateway event ingress**: `src/gateway/server-node-events.ts`.
- **Gateway event bus / agent events**: `src/infra/agent-events.ts`, `src/infra/system-events.ts`.
- **UI event log type**: `ui/src/ui/app-events.ts`.
- **TUI event handlers**: `src/tui/tui-event-handlers.ts`.

## Runs

- **Chat runs**: `src/gateway/server-chat.ts`, `src/gateway/chat-abort.ts`.
- **Sub-agent runs**: `src/agents/tools/sessions-spawn-tool.ts`, `src/agents/subagent-registry.ts`.
- **Cron runs**: `src/cron/run-log.ts`, `src/gateway/server-methods/cron.ts`, `ui/src/ui/controllers/cron.ts`.

## Approvals

- **Runtime approval flow**:
  - Manager: `src/gateway/exec-approval-manager.ts`
  - RPC handlers: `src/gateway/server-methods/exec-approval.ts`
  - Persisted policy/snapshot: `src/gateway/server-methods/exec-approvals.ts`
  - Infra policy: `src/infra/exec-approvals.ts`
  - UI controller: `ui/src/ui/controllers/exec-approvals.ts`

## UI components

- **Primary web shell**: `ui/src/ui/app-render.ts`, `ui/src/ui/navigation.ts`.
- **Tab views**: `ui/src/ui/views/*.ts`.
- **Controllers**: `ui/src/ui/controllers/*.ts`.
- **Native chat UI**:
  - Shared Swift package: `apps/shared/OpenClawKit/Sources/OpenClawChatUI/*`
  - Android compose UI: `apps/android/app/src/main/java/ai/openclaw/android/ui/chat/*`

---

## 2) Architecture decisions for Workforce (proposed)

1. **Use a dedicated Workforce namespace without breaking existing agents/routing schema**
   - Add `workforce.*` as an additive config layer that compiles into existing primitives (`agents.list`, `bindings`, subagent policies).
2. **Keep orchestration read-only first**
   - First runtime surface should be observability (`status/graph`) before any mutating workflows.
3. **Unify run identity across chat/subagent/cron**
   - Introduce a normalized run envelope to make Runs page feasible without rewriting each subsystem.
4. **Policy-first orchestration**
   - Workforce actions must route through existing approval and allowlist gates (exec approvals, subagent allowAgents, tool policies).
5. **Page-boundary architecture**
   - New pages (Mission Control/Flight Control/Runs/Workspace) should have isolated controllers/stores to avoid adding more global state coupling in `AppViewState`.

---

## 3) Proposed folder structure (additive)

```text
src/workforce/
  models.ts
  planner.ts
  queues.ts
  schedules.ts
  decisions.ts
  receipts.ts
  replayframes.ts
  memory-layers.ts
  policy-gates.ts
  adapters/
    agents.ts
    cron.ts
    sessions.ts
    approvals.ts

src/gateway/server-methods/workforce.ts
src/gateway/protocol/schema/workforce.ts

ui/src/ui/workforce/
  state.ts
  controllers/
    mission-control.ts
    flight-control.ts
    runs.ts
    workspace.ts
  views/
    mission-control.ts
    flight-control.ts
    runs.ts
    workspace.ts
  components/
    decision-card.ts
    receipt-timeline.ts
    replayframe-player.ts

ui/src/ui/views/workforce.* (or integrate as tabs via navigation.ts)

docs/workforce/
  index.md
  mission-control.md
  flight-control.md
  runs.md
  workspace.md
```

---

## 4) Workforce data models (proposed)

## seats

- Purpose: assign role capacity and ownership.
- Fields:
  - `seatId`, `agentId`, `role`, `capacity`, `status`, `owner`, `skills[]`, `policyProfileId`.

## queues

- Purpose: work intake + dispatch semantics.
- Fields:
  - `queueId`, `name`, `priority`, `concurrency`, `routingRules[]`, `backpressurePolicy`, `sla`.

## schedules

- Purpose: time/trigger execution (cron + event-driven).
- Fields:
  - `scheduleId`, `queueId`, `triggerType` (`cron`|`event`|`manual`), `spec`, `timezone`, `maxConcurrentRuns`, `enabled`.

## decision cards

- Purpose: human/AI decision units for approvals/escalations.
- Fields:
  - `decisionId`, `runId`, `title`, `summary`, `options[]`, `recommended`, `riskLevel`, `requiresApproval`, `expiresAt`.

## receipts

- Purpose: immutable audit trail.
- Fields:
  - `receiptId`, `runId`, `decisionId?`, `actor`, `action`, `outcome`, `ts`, `artifacts[]`, `signature?`.

## replayframes

- Purpose: deterministic replay/debug timeline.
- Fields:
  - `frameId`, `runId`, `seq`, `eventType`, `payloadRef`, `stateDelta`, `ts`, `source`.

## memory layers

- Purpose: isolate short/long/operational memory.
- Fields:
  - `layerId`, `kind` (`ephemeral`|`session`|`team`|`global`), `scope`, `retention`, `embeddingProfile`, `accessPolicy`.

---

## 5) Test strategy

## Page separation tests

- Add per-page unit tests for new controllers/views under `ui/src/ui/workforce/**`.
- Keep current tab tests intact; add navigation assertions for new tabs only.

## Policy gate tests

- Unit tests for `src/workforce/policy-gates.ts` covering:
  - subagent allowlist enforcement
  - exec approval required/waived paths
  - deny-path propagation to receipts and decision cards

## Run/event contract tests

- Protocol + handler tests for `workforce.*` gateway methods.
- Replayframe ordering tests (monotonic `seq`, no duplicate frame IDs per run).

## UI snapshot coverage

- Browser snapshots for Mission Control, Flight Control, Runs, Workspace states:
  - empty
  - loading
  - populated
  - approval-pending/error
- Reuse existing browser snapshot pattern in `ui/src/ui/__screenshots__/`.

---

## 6) PR-sized milestone sequencing

1. **PR-A (foundation docs + naming + IA)**
   - Define page taxonomy and nav map for Chat/Hub, Mission Control, Flight Control, Runs, Workspace.
   - No runtime changes.
2. **PR-B (data model + protocol stubs)**
   - Add `src/workforce/models.ts` and protocol schemas; read-only endpoints returning mock/static shape.
3. **PR-C (Mission Control + Runs read-only UI)**
   - Add controllers/views fed by read-only endpoints.
4. **PR-D (Flight Control approvals integration)**
   - Connect decision cards to existing exec approval flow.
5. **PR-E (Workspace + memory layers)**
   - Add workspace/memory layer inspector and guardrails.
6. **PR-F (replayframes + receipts audit trails)**
   - Add timeline/replay tooling and export.

---

## 7) Hard blockers and missing dependencies

1. **Naming mismatch blocker**
   - Requested page names (Mission Control, Flight Control, AppFolio Workspace) are not present in current IA; product naming decision needed before UI wiring.
2. **No unified runs abstraction blocker**
   - Chat/subagent/cron runs use different models; requires a shared run envelope before a true Runs page.
3. **No Workforce protocol namespace blocker**
   - Gateway RPC currently has no `workforce.*` methods; UI cannot fetch consolidated workforce state yet.
4. **Missing receipt/replay primitives blocker**
   - Existing events are stream-oriented; no first-class immutable receipt/replayframe store.
5. **Dependency decision needed**
   - Choose whether to leverage existing Control UI stack only (`lit`) or introduce additional visualization dependency for run timelines (prefer no new dependency in v1).

---

## First PR scope only (requested)

**PR-A: Workforce IA + docs-only foundation**

- Add docs page(s) defining the Workforce page map and naming decisions.
- Add a lightweight nav spec documenting mapping from existing tabs to new labels.
- Add explicit not yet implemented notes for Mission Control, Flight Control, Runs, AppFolio Workspace.
- Add architecture record for unified run envelope and receipt/replayframe requirements.
- No runtime, schema, or UI behavior changes in this PR.
