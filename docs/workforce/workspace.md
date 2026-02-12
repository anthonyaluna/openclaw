---
summary: "AppFolio Workspace controlled execution and writeback guardrails"
read_when:
  - You are executing AppFolio-adjacent actions through Workforce
title: "AppFolio Workspace"
status: active
---

# AppFolio Workspace

AppFolio Workspace is the controlled execution bay for actions that require stricter policy context.

## Guardrails

- Workspace policy state is loaded through `workforce.workspace`.
- Actions can require writeback receipt IDs before execution.
- Policy outcomes are explicit: `allow`, `block`, or `escalate`.
- Workspace policy profile defaults to `balanced` and can trigger stricter profiles by action class (for example deploy and security actions).

## Typical flow

1. record a writeback receipt
2. execute a gated action
3. resolve a generated decision card if escalation is required
4. review receipt and replay data

## Related

- [Workforce](/workforce)
- [Flight Control](/workforce/flight-control)
- [Runs](/workforce/runs)
