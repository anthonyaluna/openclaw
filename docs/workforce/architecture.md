---
summary: "Architecture decisions and constraints for Workforce rollout"
read_when:
  - You are implementing workforce protocol, UI, or policy flows
title: "Workforce Architecture Decisions"
status: draft
---

# Workforce Architecture Decisions

This note captures the initial architecture direction for Workforce work.

## Decision 1: additive namespace

Use an additive `workforce.*` namespace that compiles to existing primitives
instead of replacing current `agents`, `bindings`, and sub agent settings.

Why:

- preserves backward compatibility
- allows staged rollout

## Decision 2: read only first

Ship observability surfaces before mutating workflows.

Why:

- lower operational risk
- enables validation of data model and UX before control actions

## Decision 3: unified run envelope

Define a shared run envelope that covers chat, sub agent, and cron runs.

Why:

- enables a first class Runs page
- avoids duplicate adapters per UI surface

## Decision 4: policy first orchestration

Route workforce actions through existing approval and allowlist systems.

Why:

- keeps one authorization model
- preserves existing security posture

## Decision 5: receipt and replay requirements

Treat receipts and replay frames as first class requirements for later phases.

Why:

- improves auditability
- enables deterministic investigation workflows

## Open questions

- final product naming for Mission Control, Flight Control, and AppFolio Workspace
- storage target for receipts and replay frames
- visualization scope for timelines in v1
