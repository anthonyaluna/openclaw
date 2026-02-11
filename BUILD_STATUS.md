# Workforce Build Status

## Status Summary

- **Overall:** ?? Planning complete; implementation not started.
- **Confidence:** High for baseline capabilities (multi-agent routing + sub-agents exist), medium for Workforce UX completeness (no first-class surface yet).
- **Recommended next step:** Start with docs/terminology PR to define Workforce on top of existing primitives.

## Repo Audit Snapshot

### What exists today

1. **Multi-agent core primitives are present**
   - Routing and bindings implementation + tests in `src/routing/*` and agent command surfaces in `src/commands/agents.*`.
2. **Sub-agent execution is implemented**
   - `sessions_spawn` tooling and tests exist in `src/agents/tools/sessions-spawn-tool.ts` and related sub-agent test suites.
3. **Gateway methods already support agent/session operations**
   - Server methods for agents/sessions are present in `src/gateway/server-methods/agents.ts` and `src/gateway/server-methods/sessions.ts`.
4. **Documentation foundation exists**
   - Conceptual docs for multi-agent routing (`docs/concepts/multi-agent.md`) and sub-agents (`docs/tools/subagents.md`).
5. **Optional orchestration extension exists**
   - `extensions/open-prose` exposes plugin-level multi-agent orchestration semantics.

### What is missing for Workforce

1. **No first-class Workforce artifact**
   - No `workforce` concept page, how-to, or dedicated CLI command family in current tree.
2. **No consolidated Workforce status output**
   - Current status surfaces are agent/session oriented; they do not present topology-level readiness.
3. **No guided bootstrap workflow**
   - Users still assemble `agents.list`, `bindings`, and sub-agent settings manually.
4. **No Workforce-specific guardrail checklist**
   - Risks like duplicate `agentDir`, missing binding coverage, or cross-agent spawn policy are not grouped into a single operator workflow.

## Gap Matrix

| Area               | Current State                             | Gap                           | Priority |
| ------------------ | ----------------------------------------- | ----------------------------- | -------- |
| Terminology & docs | Strong multi-agent + sub-agent docs       | No Workforce framing/how-to   | P0       |
| CLI UX             | Agent commands exist                      | No `workforce status/init`    | P0       |
| Config ergonomics  | Flexible primitives                       | No scaffold/template helper   | P1       |
| Observability      | `status` and agent/session data available | No topology readiness summary | P1       |
| Troubleshooting    | Broad docs coverage                       | No Workforce playbook         | P2       |

## Proposed PR Track

- **PR 1:** Workforce docs + cross-links (docs-only)
- **PR 2:** `openclaw workforce status` (read-only)
- **PR 3:** `openclaw workforce init` (guided scaffold)
- **PR 4:** Troubleshooting + optional doctor checks

(See `PLANS.md` for detailed scope and exit criteria.)

## Readiness Decision

- **Go/No-Go for coding:**  **Go** (safe to start with docs and read-only CLI surfaces).
- **Blocking risks:** none for PR 1; PR 3 requires careful config-write safeguards.
