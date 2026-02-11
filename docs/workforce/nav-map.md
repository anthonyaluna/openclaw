---
summary: "Mapping of requested Workforce page names to current OpenClaw surfaces"
read_when:
  - You need to map current Control UI tabs to proposed Workforce labels
title: "Navigation Map"
status: draft
---

# Navigation Map

This page maps requested Workforce names to current surfaces in the repository.

## Requested to current mapping

| Requested label | Current state | Current surfaces |
| --- | --- | --- |
| Chat Hub | Implemented | `ui/src/ui/views/chat.ts`, [WebChat](/web/webchat) |
| Mission Control | Partial | [Control UI](/web/control-ui) tabs: overview, channels, instances, sessions, usage, cron |
| Flight Control | Partial | cron, nodes, exec approvals surfaces in Control UI and gateway methods |
| Runs | Partial | chat run state, sub agent registry, cron run log |
| AppFolio Workspace | Partial | [Agent workspace](/concepts/agent-workspace), workspace runtime helpers |

## Not implemented yet

The following are not first class top level pages yet:

- Mission Control
- Flight Control
- Runs
- AppFolio Workspace

These labels are planning targets for the Workforce roadmap.
