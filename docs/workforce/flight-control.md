---
summary: "Proposed Flight Control page for orchestration actions and approvals"
read_when:
  - You are defining operational controls for workforce runs and policies
title: "Flight Control"
status: draft
---

# Flight Control

Flight Control is a proposed operations page for active orchestration and
control actions.

## Goal

Provide operator controls for:

- scheduling and triggering runs
- dispatch and queue controls
- approvals and escalation flow
- policy gate visibility

## Current equivalents

Today this is distributed across:

- cron UI and gateway cron methods
- node controls
- exec approval controls

## Current gap

Flight Control is not implemented as a first class page. A later phase should
reuse existing approval and allowlist gates rather than introducing parallel
policy systems.
