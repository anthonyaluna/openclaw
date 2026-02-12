import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools workforce integration", () => {
  it("includes the workforce tool by default", () => {
    const tools = createOpenClawTools();
    const tool = tools.find((entry) => entry.name === "workforce");
    expect(tool).toBeDefined();
  });
});
