import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseWorkforceFiltersByPresetJson,
  parseWorkforceFiltersByPresetJsonFile,
  parseWorkforceFiltersJson,
  parseWorkforceFiltersJsonFile,
} from "./workforce-cli.js";

describe("workforce filters parser", () => {
  it("parses plain JSON objects", () => {
    expect(parseWorkforceFiltersJson('{"property_visibility":"active"}')).toEqual({
      property_visibility: "active",
    });
  });

  it("parses shell-escaped JSON used in PowerShell invocations", () => {
    expect(parseWorkforceFiltersJson('{\\"property_visibility\\":\\"active\\"}')).toEqual({
      property_visibility: "active",
    });
  });

  it("parses quoted JSON payloads", () => {
    expect(parseWorkforceFiltersJson('"{\\"property_visibility\\":\\"active\\"}"')).toEqual({
      property_visibility: "active",
    });
  });

  it("parses legacy object-literal payloads with stripped quotes", () => {
    expect(parseWorkforceFiltersJson("{property_visibility:active,occurred_on_from:2026-02-01}")).toEqual(
      {
        property_visibility: "active",
        occurred_on_from: "2026-02-01",
      },
    );
  });

  it("parses JSON files via --filters-json-file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openclaw-workforce-cli-"));
    const file = path.join(dir, "filters.json");
    writeFileSync(file, '{"property_visibility":"active"}', "utf8");
    try {
      expect(parseWorkforceFiltersJsonFile(file)).toEqual({
        property_visibility: "active",
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects non-object JSON payloads", () => {
    expect(() => parseWorkforceFiltersJson('["not","object"]')).toThrow(
      /expected a JSON object/i,
    );
  });

  it("parses per-preset filter maps", () => {
    expect(
      parseWorkforceFiltersByPresetJson(
        '{"bill_detail":{"occurred_on_from":"2026-01-01"},"work_order":{"status":"open"}}',
      ),
    ).toEqual({
      bill_detail: { occurred_on_from: "2026-01-01" },
      work_order: { status: "open" },
    });
  });

  it("parses per-preset filter maps from file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openclaw-workforce-cli-"));
    const file = path.join(dir, "filters-by-preset.json");
    writeFileSync(
      file,
      '{"bill_detail":{"occurred_on_from":"2026-01-01"},"work_order":{"status":"open"}}',
      "utf8",
    );
    try {
      expect(parseWorkforceFiltersByPresetJsonFile(file)).toEqual({
        bill_detail: { occurred_on_from: "2026-01-01" },
        work_order: { status: "open" },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects per-preset filter values that are not objects", () => {
    expect(() => parseWorkforceFiltersByPresetJson('{"bill_detail":"bad"}')).toThrow(
      /expected each key to map to a JSON object/i,
    );
  });
});
