---
summary: "CLI reference for `openclaw workforce` operations"
read_when:
  - You are operating Workforce from terminal automation
  - You need command syntax for decisions, schedules, runs, and writeback gates
title: "workforce"
---

# `workforce`

Use `openclaw workforce` to operate Workforce state through the gateway.

## Commands

- `openclaw workforce status [--json]`
- `openclaw workforce next-steps [--json]`
- `openclaw workforce init [--force] [--json]`
- `openclaw workforce runs [--limit <n>] [--query <text>] [--status <status>] [--json]`
- `openclaw workforce decisions [--limit <n>] [--status <pending|resolved>] [--json]`
- `openclaw workforce resolve <decisionId> [--allow|--deny] [--actor <name>] [--json]`
- `openclaw workforce action <seatId> <action> [--source <chat|subagent|cron|workforce>] [--require-writeback-receipt] [--writeback-receipt-id <id>] [--no-auto-writeback] [--json]`
- `openclaw workforce schedules [--limit <n>] [--json]`
- `openclaw workforce schedule-add <seatId> <name> <intervalMs> <action> [--json]`
- `openclaw workforce ledger [--limit <n>] [--json]`
- `openclaw workforce workspace [--json]`
- `openclaw workforce tick [--actor <name>] [--json]`
- `openclaw workforce writeback [--actor <name>] [--note <text>] [--artifact <ref>] [--json]`
- `openclaw workforce appfolio-reports-probe [--json]`
- `openclaw workforce appfolio-reports-presets [--json]`
- `openclaw workforce appfolio-report-run <presetId> [--filters-json <json>] [--json]`
- `openclaw workforce appfolio-workflow-run <workflowId> [--filters-json <json>] [--filters-by-preset-json <json>] [--json]`
- `openclaw workforce appfolio-schedules-install [--preset <id>] [--json]`
- `openclaw workforce appfolio-workflow-schedule-install <workflowId> [--every <duration>] [--seat <seatId>] [--json]`

## Common flows

### Check readiness and next actions

```bash
openclaw workforce status
openclaw workforce next-steps
```

### Review and resolve decisions

```bash
openclaw workforce decisions --status pending
openclaw workforce resolve <decision-id> --allow
```

### Execute AppFolio gated action

```bash
openclaw workforce action queue-manager appfolio.comms.broadcast.owner-update --require-writeback-receipt
```

The CLI auto records a writeback receipt unless `--no-auto-writeback` is passed.

### Add and trigger schedules

```bash
openclaw workforce schedule-add scheduler "Hourly Patrol" 3600000 patrol:scheduler
openclaw workforce tick
```

### Probe AppFolio Reports API access

```bash
openclaw workforce appfolio-reports-probe
```

### Run built-in AppFolio report jobs

```bash
openclaw workforce appfolio-reports-presets
openclaw workforce appfolio-report-run rent_roll
openclaw workforce appfolio-report-run delinquency --filters-json '{"balance_operator":{"amount":"100","comparator":"="}}'
openclaw workforce appfolio-report-run work_order
openclaw workforce appfolio-report-run bill_detail
openclaw workforce appfolio-report-run vendor_ledger
openclaw workforce appfolio-report-run vendor_ledger_enhanced
```

### Chat shortcut mapping for AppFolio presets

When Workforce tooling is invoked from chat, `appfolio_report_run` accepts `presetId`, `shortcut`, or `query`.
Shortcuts map deterministically to these presets:

- `work orders`, `workorder`, `maintenance queue` -> `work_order`
- `smart bill`, `invoices`, `bill detail` -> `bill_detail`
- `vendor ledger details`, `vendor ledger enhanced` -> `vendor_ledger_enhanced`
- `vendor ledger` -> `vendor_ledger`
- `delinquency`, `arrears`, `collections` -> `delinquency`
- `rent roll`, `occupancy snapshot` -> `rent_roll`

Use the preset id directly when you want exact routing with no phrase matching.

### Run built-in AppFolio workflows

```bash
openclaw workforce appfolio-workflow-run smart_bill_daily
openclaw workforce appfolio-workflow-run smart_bill_triage --filters-json '{"occurred_on_from":"2026-02-01","occurred_on_to":"2026-02-12"}'
openclaw workforce appfolio-workflow-run smart_bill_daily --filters-by-preset-json '{"bill_detail":{"occurred_on_from":"2026-02-01","occurred_on_to":"2026-02-12"}}'
```

If your shell strips JSON quotes (common on some PowerShell/CMD paths), either use
`--filters-json-file`/`--filters-by-preset-file`, pass `--filters-json @path/to/filters.json` (works for `appfolio-report-run` and `appfolio-workflow-run`)
or `--filters-by-preset-json @path/to/filters-by-preset.json`,
or use the lenient object-literal form
(`{occurred_on_from:2026-02-01,occurred_on_to:2026-02-12}`).

Supported workflow IDs:

- `smart_bill_triage`
- `smart_bill_reconcile`
- `smart_bill_daily`

`appfolio-workflow-run` executes `appfolio_workflow_run` through Workforce policy gates, so the same workflow can run from CLI/Codex and chat with one action surface.

### Install default report schedules

```bash
openclaw workforce appfolio-schedules-install
```

### Install recurring Smart Bill workflow schedule (Workforce scheduler)

This creates a Workforce schedule that the gateway will execute automatically (the gateway runner ticks Workforce schedules every 60 seconds while the gateway is running).

```bash
openclaw workforce appfolio-workflow-schedule-install smart_bill_daily --every 1d
```

Recognized environment variables:

- `OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID`
- `OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET`
- `OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE` (`auto`|`basic`|`oauth`, default `auto`)
- `OPENCLAW_APPFOLIO_REPORTS_DATABASE` (for example `your-database` or `your-database.appfolio.com`)
- `OPENCLAW_APPFOLIO_REPORTS_DATABASE_URL` (optional full base URL override)
- `OPENCLAW_APPFOLIO_REPORTS_REPORT_NAME` (for example `purchase_order.json`)
- `OPENCLAW_APPFOLIO_REPORTS_METHOD` (`POST` default, `GET` optional)
- `OPENCLAW_APPFOLIO_REPORTS_REFRESH_TOKEN` (recommended when required by your tenant)
- `OPENCLAW_APPFOLIO_REPORTS_ACCESS_TOKEN` (optional override)
- `OPENCLAW_APPFOLIO_REPORTS_TOKEN_URL` (default: `https://api.appfolio.com/oauth/token`)
- `OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL` (default: `https://api.appfolio.com`)
- `OPENCLAW_APPFOLIO_REPORTS_LIST_PATH` (default: `/reports`)
- `OPENCLAW_APPFOLIO_REPORTS_SCOPE` (optional)

Credential file fallback (recommended for gateways started outside your interactive shell):

If the env vars are not set, OpenClaw also looks for a credentials file at:

- `~/.openclaw/credentials/appfolio-reports.json`

You can override the path with:

- `OPENCLAW_APPFOLIO_REPORTS_CREDENTIALS_PATH`

Example file format (do not commit this file to git):

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "database": "coastlineequity",
  "authMode": "basic"
}
```

If `database`/`report_name` are configured (or `auth_mode=basic`), the probe uses Basic auth against:

`https://{database}.appfolio.com/api/v2/reports/{report_name}.json`

Otherwise the probe uses OAuth mode against the configured token + API URLs.
If your tenant rejects client-credential grants in OAuth mode, set `OPENCLAW_APPFOLIO_REPORTS_REFRESH_TOKEN`.

## Related

- [Workforce](/workforce)
- [Workforce Architecture Decisions](/workforce/architecture)
- [gateway](/cli/gateway)
