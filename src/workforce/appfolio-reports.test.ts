import { describe, expect, it } from "vitest";
import {
  normalizeWorkforceAppfolioPaginationOptions,
  actionForWorkforceAppfolioWorkflow,
  parseWorkforceAppfolioWorkflowId,
  resolveWorkforceAppfolioReportPresetShortcut,
  resolveWorkforceAppfolioWorkflowShortcut,
  validateWorkforceAppfolioReportPayload,
} from "./appfolio-reports.js";

describe("resolveWorkforceAppfolioReportPresetShortcut", () => {
  it("resolves direct preset ids", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("bill_detail");
    expect(result).toMatchObject({
      ok: true,
      presetId: "bill_detail",
      matchedBy: "preset_id",
      confidence: 1,
    });
  });

  it("resolves report resources", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("vendor_ledger_enhanced.json");
    expect(result).toMatchObject({
      ok: true,
      presetId: "vendor_ledger_enhanced",
      matchedBy: "report_name",
      confidence: 0.99,
    });
  });

  it("resolves smart bill and invoice shortcuts to bill_detail", () => {
    const a = resolveWorkforceAppfolioReportPresetShortcut("smart bill");
    const b = resolveWorkforceAppfolioReportPresetShortcut("invoices");
    expect(a).toMatchObject({ ok: true, presetId: "bill_detail" });
    expect(b).toMatchObject({ ok: true, presetId: "bill_detail" });
  });

  it("resolves vendor ledger details to enhanced preset", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("vendor ledger details");
    expect(result).toMatchObject({
      ok: true,
      presetId: "vendor_ledger_enhanced",
      matchedBy: "shortcut",
    });
    if (!result.ok) {
      return;
    }
    expect(result.confidence).toBeGreaterThan(0.89);
  });

  it("keeps vendor ledger shortcut on the non-enhanced preset", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("vendor ledger");
    expect(result).toMatchObject({
      ok: true,
      presetId: "vendor_ledger",
    });
  });

  it("resolves work order shortcuts", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("maintenance queue");
    expect(result).toMatchObject({
      ok: true,
      presetId: "work_order",
      matchedBy: "shortcut",
    });
  });

  it("returns no_match for unknown inputs", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut("random unrelated report");
    expect(result).toMatchObject({ ok: false, reason: "no_match" });
  });

  it("returns ambiguity with clarification prompt for competing intents", () => {
    const result = resolveWorkforceAppfolioReportPresetShortcut(
      "show work orders and bill detail",
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
    if (result.ok) {
      return;
    }
    expect(result.candidates?.length).toBeGreaterThan(1);
    expect(result.clarificationPrompt).toContain("Choose one presetId");
  });
});

describe("resolveWorkforceAppfolioWorkflowShortcut", () => {
  it("resolves smart bill triage phrases", () => {
    const result = resolveWorkforceAppfolioWorkflowShortcut("work orders and invoice data");
    expect(result).toMatchObject({
      ok: true,
      workflowId: "smart_bill_triage",
      matchedBy: "shortcut",
    });
  });
});

describe("parseWorkforceAppfolioWorkflowId", () => {
  it("parses workflow actions", () => {
    expect(parseWorkforceAppfolioWorkflowId("appfolio.workflow.run:smart_bill_daily")).toBe(
      "smart_bill_daily",
    );
  });

  it("returns null for non-workflow actions", () => {
    expect(parseWorkforceAppfolioWorkflowId("appfolio.report.run:bill_detail")).toBeNull();
  });
});

describe("actionForWorkforceAppfolioWorkflow", () => {
  it("builds workflow action labels", () => {
    expect(actionForWorkforceAppfolioWorkflow("smart_bill_triage")).toBe(
      "appfolio.workflow.run:smart_bill_triage",
    );
  });
});

describe("validateWorkforceAppfolioReportPayload", () => {
  it("fails when bill_detail is missing required date filters", () => {
    const result = validateWorkforceAppfolioReportPayload("bill_detail", {
      properties: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_required_filter:occurred_on_from");
    expect(result.errors).toContain("missing_required_filter:occurred_on_to");
  });

  it("passes for valid work_order payload", () => {
    const result = validateWorkforceAppfolioReportPayload("work_order", {
      status_date_range_from: "2026-01-01",
      status_date_range_to: "2026-01-31",
      properties: {},
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("normalizeWorkforceAppfolioPaginationOptions", () => {
  it("clamps and defaults pagination settings", () => {
    const result = normalizeWorkforceAppfolioPaginationOptions({
      autoPaginate: true,
      maxPages: 999,
      maxRows: -4,
    });
    expect(result).toMatchObject({
      autoPaginate: true,
      maxPages: 20,
      maxRows: 1,
    });
  });
});
