---
summary: "Proposed AppFolio Workspace page and its relationship to existing workspace concepts"
read_when:
  - You are defining workspace level controls and memory boundaries
title: "AppFolio Workspace"
status: draft
---

# AppFolio Workspace

AppFolio Workspace is a requested Workforce label for workspace level operating
surfaces.

## Current equivalents

Existing workspace foundations already exist:

- [Agent workspace](/concepts/agent-workspace)
- workspace runtime helpers in `src/agents/workspace.ts` and `src/hooks/workspace.ts`
- macOS workspace UI bits

## Current gap

There is no first class AppFolio Workspace page today.

## Proposed focus

- workspace selection and boundary visibility
- memory layer inspection by scope
- policy and access constraints per workspace context

This should remain additive to existing workspace and session behavior.
