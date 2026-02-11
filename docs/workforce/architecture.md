---
summary: "Architecture decisions for the Workforce runtime and UI integration"
read_when:
  - You are changing Workforce gateway methods, runtime policy, or UI data flow
title: "Workforce Architecture Decisions"
status: active
---

# Workforce Architecture Decisions

## Decision 1 additive gateway namespace

Workforce ships as an additive `workforce.*` gateway namespace and does not replace existing agent/session APIs.

## Decision 2 normalized run envelope

Workforce actions are persisted as normalized run envelopes to support shared archive and replay behavior.

## Decision 3 explicit policy outcomes

Policy evaluation always returns one of:

- `allow`
- `block`
- `escalate`

Escalation creates decision cards with explicit resolution paths.

## Decision 4 receipts and replay frames as first class records

Actions emit receipts and replay frames for audit and investigation flows.

## Decision 5 workspace policy guardrails

Workspace-sensitive actions support required writeback receipt checks before execution.

## Decision 6 guidance-first operations

The runtime computes actionable `nextSteps` from current decisions, blocked runs,
queue pressure, and due schedules. UI surfaces consume this directly to drive
operator and autonomous follow-up actions.

## Implementation references

- Runtime: `src/workforce/service.ts`
- Store: `src/workforce/store.ts`
- Types: `src/workforce/types.ts`
- Gateway handlers: `src/gateway/server-methods/workforce.ts`
- Protocol schema: `src/gateway/protocol/schema/workforce.ts`
