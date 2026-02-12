import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  probeAppfolioReportsAccess,
  runAppfolioReport,
  runAppfolioReportNextPage,
} from "./appfolio-reports.js";

describe("probeAppfolioReportsAccess", () => {
  it("returns credential error when auth inputs are missing", async () => {
    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_TOKEN_URL: "https://example.test/oauth/token",
        OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL: "https://example.test",
      },
      fetchFn: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("appfolio_client_credentials_missing");
    expect(result.token.acquired).toBe(false);
  });

  it("uses provided access token and probes reports endpoint", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(JSON.stringify({ data: [{ id: "r1" }, { id: "r2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_ACCESS_TOKEN: "token-1",
        OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL: "https://example.test",
        OPENCLAW_APPFOLIO_REPORTS_LIST_PATH: "/reports",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.token.source).toBe("access_token");
    expect(result.reports.ok).toBe(true);
    expect(result.reports.count).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("loads client credentials from the credentials file when env is missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openclaw-appfolio-reports-"));
    const credsPath = path.join(dir, "appfolio-reports.json");
    writeFileSync(
      credsPath,
      JSON.stringify(
        {
          clientId: "file-client",
          clientSecret: "file-secret",
          database: "coastlineequity",
          reportName: "work_order.json",
          authMode: "basic",
        },
        null,
        2,
      ),
      "utf8",
    );

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("https://coastlineequity.appfolio.com/api/v2/reports/work_order.json");
      expect(init?.headers).toBeTruthy();
      return new Response(JSON.stringify({ results: [{}], next_page_url: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_CREDENTIALS_PATH: credsPath,
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.configured.clientId).toBe(true);
    expect(result.configured.clientSecret).toBe(true);
    expect(result.configured.databaseHost).toBe(true);
    expect(result.configured.reportName).toBe(true);
    expect(result.token.source).toBe("basic_auth");
    expect(result.reports.ok).toBe(true);
  });

  it("requests token and falls back report paths after 404", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "token-from-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/reports")) {
        return new Response(JSON.stringify({ reports: [{ id: "a" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/reports")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_REFRESH_TOKEN: "refresh-token",
        OPENCLAW_APPFOLIO_REPORTS_TOKEN_URL: "https://example.test/oauth/token",
        OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL: "https://example.test",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.token.source).toBe("refresh_token");
    expect(result.reports.endpoint).toBe("https://example.test/v1/reports");
    expect(fetchFn).toHaveBeenCalled();
  });

  it("falls back to basic auth when body credentials are rejected", async () => {
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/oauth/token")) {
        tokenCalls += 1;
        const headers = init?.headers as Record<string, string> | undefined;
        const auth = headers?.authorization;
        if (tokenCalls === 1) {
          expect(auth).toBeUndefined();
          return new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "Invalid client credentials",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }
        expect(auth?.startsWith("Basic ")).toBe(true);
        return new Response(JSON.stringify({ access_token: "token-basic" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/reports")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_TOKEN_URL: "https://example.test/oauth/token",
        OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL: "https://example.test",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(tokenCalls).toBe(2);
    expect(result.token.acquired).toBe(true);
    expect(result.token.source).toBe("client_credentials");
  });

  it("probes database-scoped reports API with HTTP Basic auth", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://acme.appfolio.com/api/v2/reports/purchase_order.json");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.authorization?.startsWith("Basic ")).toBe(true);
      expect(headers?.accept).toBe("application/json");
      expect(headers?.["content-type"]).toBe("application/json");
      expect(init?.body).toBe("{}");
      return new Response(JSON.stringify({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await probeAppfolioReportsAccess({
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "acme",
        OPENCLAW_APPFOLIO_REPORTS_REPORT_NAME: "purchase_order",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.token.source).toBe("basic_auth");
    expect(result.reports.ok).toBe(true);
    expect(result.reports.count).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("runs a database-scoped report with request payload", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ as_of_to: "2026-02-11" }));
      return new Response(JSON.stringify({ results: [{ id: 1 }], next_page_url: "next-url" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await runAppfolioReport({
      reportName: "rent_roll.json",
      body: { as_of_to: "2026-02-11" },
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.nextPageUrl).toBe("next-url");
  });

  it("returns row data when includeRows=true with maxRows limit", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          results: [{ id: 1, vendor: "A" }, { id: 2, vendor: "B" }, { id: 3, vendor: "C" }],
          next_page_url: "next-url",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await runAppfolioReport({
      reportName: "bill_detail.json",
      includeRows: true,
      maxRows: 2,
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      { id: 1, vendor: "A" },
      { id: 2, vendor: "B" },
    ]);
    expect(result.rowsReturned).toBe(2);
    expect(result.rowsTruncated).toBe(true);
    expect(result.columns).toEqual(["id", "vendor"]);
  });

  it("returns explicit error when report run is not in basic mode", async () => {
    const result = await runAppfolioReport({
      reportName: "rent_roll.json",
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "oauth",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
      },
      fetchFn: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("appfolio_report_run_requires_basic_mode");
  });

  it("normalizes common report aliases to valid resource names", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://coastlineequity.appfolio.com/api/v2/reports/vendor_ledger_enhanced.json",
      );
      return new Response(JSON.stringify({ results: [{ id: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await runAppfolioReport({
      reportName: "vendor_ledger_details",
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.reportName).toBe("vendor_ledger_enhanced.json");
    expect(result.count).toBe(1);
  });

  it("runs next-page report requests with database scoped basic auth", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json?offset=5000",
      );
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.authorization?.startsWith("Basic ")).toBe(true);
      expect(headers?.accept).toBe("application/json");
      expect(headers?.["content-type"]).toBe("application/json");
      return new Response(JSON.stringify({ results: [{ id: 2 }], next_page_url: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await runAppfolioReportNextPage({
      nextPageUrl: "https://coastlineequity.appfolio.com/api/v2/reports/rent_roll.json?offset=5000",
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.nextPageUrl).toBeNull();
  });

  it("returns row data for next-page requests when includeRows=true", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(
        JSON.stringify({ results: [{ id: 11 }, { id: 12 }, { id: 13 }], next_page_url: null }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await runAppfolioReportNextPage({
      nextPageUrl: "https://coastlineequity.appfolio.com/api/v2/reports/bill_detail.json?offset=5000",
      includeRows: true,
      maxRows: 2,
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: 11 }, { id: 12 }]);
    expect(result.rowsReturned).toBe(2);
    expect(result.rowsTruncated).toBe(true);
    expect(result.columns).toEqual(["id"]);
  });

  it("rejects unsafe next_page_url hosts", async () => {
    const result = await runAppfolioReportNextPage({
      nextPageUrl: "https://example.com/api/v2/reports/rent_roll.json?offset=5000",
      env: {
        OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE: "basic",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID: "client-id",
        OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET: "client-secret",
        OPENCLAW_APPFOLIO_REPORTS_DATABASE: "coastlineequity",
      },
      fetchFn: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("appfolio_next_page_url_invalid");
  });
});
