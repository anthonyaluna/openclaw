---
summary: "Workforce information architecture and rollout plan"
read_when:
  - You are planning Workforce docs, UX, or protocol work
  - You need the current mapping between requested pages and existing surfaces
title: "Workforce"
status: draft
---

# Workforce

Workforce is a proposed top level framing for multi agent operations in OpenClaw.
It builds on existing primitives that already ship today:

- multi agent routing
- sub agents
- sessions
- cron
- exec approvals

Current status as of February 11, 2026:

- Mission Control is not implemented as a first class page
- Flight Control is not implemented as a first class page
- Runs is not implemented as a first class page
- AppFolio Workspace is not implemented as a first class page

Use this section to plan IA, naming, and sequencing before runtime changes.

## Page map

- [Navigation map](/workforce/nav-map)
- [Mission Control](/workforce/mission-control)
- [Flight Control](/workforce/flight-control)
- [Runs](/workforce/runs)
- [AppFolio Workspace](/workforce/workspace)
- [Architecture decisions](/workforce/architecture)

## Scope for PR A

PR A is docs only:

- define names and page boundaries
- map requested labels to existing surfaces
- document what is not yet implemented
- define architecture constraints for later PRs

No runtime behavior changes are included in this phase.
