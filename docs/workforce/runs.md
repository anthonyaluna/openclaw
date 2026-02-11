---
summary: "Proposed Runs page and unified run envelope requirements"
read_when:
  - You are working on run tracking across chat, sub agent, and cron flows
title: "Runs"
status: draft
---

# Runs

Runs is a proposed top level page for consolidated run tracking.

## Current state

Run data is currently split across subsystems:

- chat run state in gateway chat runtime
- sub agent run registry
- cron run log and history views

Because these models differ, a single runs page is not yet available.

## Required abstraction

A shared run envelope is needed before true consolidation.

Proposed minimum fields:

- `runId`
- `kind` (`chat`, `subagent`, `cron`)
- `agentId`
- `sessionKey`
- `status`
- `startedAt`
- `endedAt`
- `source`
- `approvalState`

## Related architecture work

- [Architecture decisions](/workforce/architecture)
- [Sub Agents](/tools/subagents)
