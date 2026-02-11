---
summary: "Proposed Mission Control page for workforce level visibility"
read_when:
  - You are designing the top level operations view for multiple agents
title: "Mission Control"
status: draft
---

# Mission Control

Mission Control is a proposed workforce level overview page.

## Goal

Provide a single readiness view across:

- agents and bindings
- active sessions
- channel health and routing coverage
- queue pressure and cron posture

## Current equivalents

Today this information is spread across existing surfaces:

- [Control UI](/web/control-ui) tabs
- [Multi Agent Routing](/concepts/multi-agent)
- gateway `status` and session views

## Current gap

Mission Control does not exist yet as a dedicated page. A future implementation
should remain read only first and consume existing APIs before adding mutating
workflows.
