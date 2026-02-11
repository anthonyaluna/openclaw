export type WorkforceAutonomyMode = "FullAutonomy" | "RequestApproval" | "Observe";

export type WorkforceSystemsAccess = {
  appfolio: boolean;
  m365: boolean | "internal_only";
  repoWrite: boolean;
  codexAccess: boolean;
  webAccess: boolean | "limited";
};

export type WorkforceSeat = {
  seatId: string;
  displayName: string;
  department: string;
  roleTitle: string;
  description: string;
  defaultModel: string;
  autonomyMode: WorkforceAutonomyMode;
  permissions: string[];
  systemsAccess: WorkforceSystemsAccess;
  defaultSchedules: string[];
};

export const WORKFORCE_ROSTER: WorkforceSeat[] = [
  {
    seatId: "leadership_aiden",
    displayName: "Aiden Riviera",
    department: "Leadership",
    roleTitle: "Chief of Staff",
    description:
      "Orchestrates workforce, governs promotions, runs standups and retros, triggers engineering builds, escalates only material decisions.",
    defaultModel: "best reasoning model",
    autonomyMode: "FullAutonomy",
    permissions: [
      "assign_work",
      "start_standup",
      "start_roundtable",
      "start_retro",
      "ratify_procedural_tighten",
      "create_decision_cards",
      "trigger_engineering_build",
      "manage_queues",
    ],
    systemsAccess: {
      appfolio: true,
      m365: true,
      repoWrite: false,
      codexAccess: true,
      webAccess: true,
    },
    defaultSchedules: [
      "daily_standup",
      "daily_patrol_overview",
      "weekly_ops_retro",
      "weekly_engineering_retro",
    ],
  },
  {
    seatId: "accounting_ledger",
    displayName: "Ledger",
    department: "Accounting",
    roleTitle: "AP and Smart Bill Operator",
    description: "Smart Bill patrol, GL coding, enrichment, exception routing.",
    defaultModel: "strong structured model",
    autonomyMode: "FullAutonomy",
    permissions: [
      "appfolio_read",
      "appfolio_write_bills",
      "add_internal_notes",
      "create_receipts",
      "create_action_items",
      "route_exceptions",
    ],
    systemsAccess: {
      appfolio: true,
      m365: false,
      repoWrite: false,
      codexAccess: false,
      webAccess: "limited",
    },
    defaultSchedules: ["daily_smartbill_patrol", "weekly_accounting_standup"],
  },
  {
    seatId: "ops_flow",
    displayName: "Flow",
    department: "Operations",
    roleTitle: "Work Order and Vendor Flow Manager",
    description:
      "Triage work orders, assign vendors, follow-up, ensure AppFolio notes and receipts.",
    defaultModel: "fast reliable model",
    autonomyMode: "FullAutonomy",
    permissions: [
      "appfolio_read",
      "appfolio_write_workorders",
      "vendor_assign",
      "follow_up",
      "create_receipts",
      "create_action_items",
    ],
    systemsAccess: {
      appfolio: true,
      m365: false,
      repoWrite: false,
      codexAccess: false,
      webAccess: "limited",
    },
    defaultSchedules: ["daily_workorders_patrol", "weekly_ops_standup"],
  },
  {
    seatId: "mkt_echo",
    displayName: "Echo",
    department: "Marketing",
    roleTitle: "Content and Distribution Planner",
    description:
      "Maintains content calendar, drafts posts, analyzes performance, proposes experiments.",
    defaultModel: "best writing model aligned to PME voice",
    autonomyMode: "FullAutonomy",
    permissions: [
      "create_calendar_artifacts",
      "draft_posts",
      "analyze_performance",
      "propose_experiments",
      "create_action_items",
    ],
    systemsAccess: {
      appfolio: false,
      m365: "internal_only",
      repoWrite: false,
      codexAccess: false,
      webAccess: true,
    },
    defaultSchedules: ["daily_content_drafts", "weekly_marketing_retro"],
  },
  {
    seatId: "eng_architect",
    displayName: "Architect",
    department: "Engineering",
    roleTitle: "Systems Architect",
    description: "Writes specs and acceptance criteria.",
    defaultModel: "best reasoning model",
    autonomyMode: "FullAutonomy",
    permissions: ["create_specs", "open_issues", "plan_changes", "create_action_items"],
    systemsAccess: {
      appfolio: false,
      m365: false,
      repoWrite: true,
      codexAccess: true,
      webAccess: true,
    },
    defaultSchedules: ["weekly_engineering_retro"],
  },
  {
    seatId: "eng_release",
    displayName: "Release",
    department: "Engineering",
    roleTitle: "Release Manager",
    description:
      "Deploys staging, runs canary, proposes prod deploy via Decision Card, deploys prod after approval.",
    defaultModel: "best reasoning model",
    autonomyMode: "RequestApproval",
    permissions: [
      "deploy_staging",
      "run_canary",
      "propose_prod_deploy",
      "deploy_prod_after_approval",
    ],
    systemsAccess: {
      appfolio: false,
      m365: false,
      repoWrite: true,
      codexAccess: true,
      webAccess: false,
    },
    defaultSchedules: ["on_demand"],
  },
];
