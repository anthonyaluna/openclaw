import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveOAuthDir } from "../config/paths.js";

type FetchLike = typeof fetch;

type AppfolioReportsEnv = {
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  authMode: "auto" | "oauth" | "basic";
  databaseHost: string | null;
  databaseBaseUrl: string | null;
  reportName: string | null;
  reportMethod: "GET" | "POST";
  tokenUrl: string;
  apiBaseUrl: string;
  listPath: string;
  scope: string | null;
};

type AppfolioTokenResult = {
  accessToken: string;
  tokenType: string | null;
  expiresIn: number | null;
  scope: string | null;
  source: "access_token" | "refresh_token" | "client_credentials";
};

type TokenAuthStyle = "body" | "basic";

export type AppfolioReportsProbeResult = {
  ok: boolean;
  configured: {
    authMode: "auto" | "oauth" | "basic";
    clientId: boolean;
    clientSecret: boolean;
    refreshToken: boolean;
    accessToken: boolean;
    databaseHost: boolean;
    databaseBaseUrl: boolean;
    reportName: boolean;
    tokenUrl: boolean;
    apiBaseUrl: boolean;
  };
  token: {
    acquired: boolean;
    source: "access_token" | "refresh_token" | "client_credentials" | "basic_auth" | "none";
    tokenType?: string | null;
    expiresIn?: number | null;
    scope?: string | null;
  };
  reports: {
    ok: boolean;
    endpoint?: string;
    status?: number;
    count?: number | null;
    error?: string;
  };
  error?: string;
  warnings: string[];
};

export type AppfolioReportRunResult = {
  ok: boolean;
  reportName: string;
  endpoint?: string;
  status?: number;
  count?: number | null;
  nextPageUrl?: string | null;
  rows?: unknown[];
  rowsReturned?: number | null;
  rowsTruncated?: boolean;
  columns?: string[];
  error?: string;
};

type BasicAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

type AppfolioReportsCredentialsFile = {
  clientId?: unknown;
  clientSecret?: unknown;
  refreshToken?: unknown;
  accessToken?: unknown;
  authMode?: unknown;
  database?: unknown;
  databaseHost?: unknown;
  databaseUrl?: unknown;
  databaseBaseUrl?: unknown;
  reportName?: unknown;
  reportMethod?: unknown;
  tokenUrl?: unknown;
  apiBaseUrl?: unknown;
  listPath?: unknown;
  scope?: unknown;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readAppfolioReportsCredentialsFile(
  env: NodeJS.ProcessEnv,
): AppfolioReportsCredentialsFile | null {
  const override = normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_CREDENTIALS_PATH);
  const credentialsPath = override
    ? path.resolve(override)
    : path.join(resolveOAuthDir(env), "appfolio-reports.json");
  try {
    const raw = readFileSync(credentialsPath, "utf8");
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as AppfolioReportsCredentialsFile;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeAuthMode(value: string | null): "auto" | "oauth" | "basic" {
  if (!value) {
    return "auto";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "oauth" || normalized === "basic") {
    return normalized;
  }
  return "auto";
}

function normalizeDatabaseHost(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!withoutProtocol) {
    return null;
  }
  const host = withoutProtocol.split("/")[0] ?? withoutProtocol;
  if (!host) {
    return null;
  }
  if (host.endsWith(".appfolio.com")) {
    return host;
  }
  if (host.includes(".")) {
    return host;
  }
  return `${host}.appfolio.com`;
}

function normalizeReportResource(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().replace(/^\/+/, "").toLowerCase();
  if (!trimmed) {
    return null;
  }
  const withJson = trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
  const aliases: Record<string, string> = {
    // Common aliases observed in prompts and operator commands.
    "work_orders.json": "work_order.json",
    "workorders.json": "work_order.json",
    "vendor_ledger_detail.json": "vendor_ledger_enhanced.json",
    "vendor_ledger_details.json": "vendor_ledger_enhanced.json",
  };
  return aliases[withJson] ?? withJson;
}

function resolveEnv(env: NodeJS.ProcessEnv): AppfolioReportsEnv {
  const file = readAppfolioReportsCredentialsFile(env);
  const authMode = normalizeAuthMode(
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_AUTH_MODE) ??
      normalizeString(env.OPENCLAW_APPFOLIO_AUTH_MODE) ??
      normalizeString(file?.authMode),
  );
  const databaseBaseUrl =
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_DATABASE_URL) ??
    normalizeString(env.OPENCLAW_APPFOLIO_DATABASE_URL) ??
    normalizeString(file?.databaseBaseUrl) ??
    normalizeString(file?.databaseUrl);
  const databaseHost = normalizeDatabaseHost(
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_DATABASE) ??
      normalizeString(env.OPENCLAW_APPFOLIO_DATABASE) ??
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_DB) ??
      normalizeString(env.OPENCLAW_APPFOLIO_DB) ??
      normalizeString(file?.databaseHost) ??
      normalizeString(file?.database),
  );
  const reportName = normalizeReportResource(
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_REPORT_NAME) ??
      normalizeString(env.OPENCLAW_APPFOLIO_REPORT_NAME) ??
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_RESOURCE) ??
      normalizeString(env.OPENCLAW_APPFOLIO_RESOURCE) ??
      normalizeString(file?.reportName),
  );
  const reportMethodRaw =
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_METHOD) ??
    normalizeString(env.OPENCLAW_APPFOLIO_METHOD) ??
    normalizeString(file?.reportMethod);
  const reportMethod = reportMethodRaw?.toUpperCase() === "GET" ? "GET" : "POST";
  const tokenUrl =
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_TOKEN_URL) ??
    normalizeString(env.OPENCLAW_APPFOLIO_TOKEN_URL) ??
    normalizeString(file?.tokenUrl) ??
    "https://api.appfolio.com/oauth/token";
  const apiBaseUrl =
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_API_BASE_URL) ??
    normalizeString(env.OPENCLAW_APPFOLIO_API_BASE_URL) ??
    normalizeString(file?.apiBaseUrl) ??
    "https://api.appfolio.com";
  const listPath =
    normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_LIST_PATH) ??
    normalizeString(env.OPENCLAW_APPFOLIO_LIST_PATH) ??
    normalizeString(file?.listPath) ??
    "/reports";
  return {
    clientId:
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_ID) ??
      normalizeString(env.OPENCLAW_APPFOLIO_CLIENT_ID) ??
      normalizeString(file?.clientId),
    clientSecret:
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_CLIENT_SECRET) ??
      normalizeString(env.OPENCLAW_APPFOLIO_CLIENT_SECRET) ??
      normalizeString(file?.clientSecret),
    refreshToken:
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_REFRESH_TOKEN) ??
      normalizeString(env.OPENCLAW_APPFOLIO_REFRESH_TOKEN) ??
      normalizeString(file?.refreshToken),
    accessToken:
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_ACCESS_TOKEN) ??
      normalizeString(env.OPENCLAW_APPFOLIO_ACCESS_TOKEN) ??
      normalizeString(file?.accessToken),
    authMode,
    databaseHost,
    databaseBaseUrl: databaseBaseUrl ? normalizeBaseUrl(databaseBaseUrl) : null,
    reportName,
    reportMethod,
    tokenUrl,
    apiBaseUrl: normalizeBaseUrl(apiBaseUrl),
    listPath: listPath.startsWith("/") ? listPath : `/${listPath}`,
    scope:
      normalizeString(env.OPENCLAW_APPFOLIO_REPORTS_SCOPE) ??
      normalizeString(env.OPENCLAW_APPFOLIO_SCOPE) ??
      normalizeString(file?.scope),
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractErrorMessage(payload: Record<string, unknown>, status: number): string {
  return (
    normalizeString(payload.error_description) ??
    normalizeString(payload.error) ??
    normalizeString(payload.message) ??
    `status_${status}`
  );
}

function isInvalidClientResponse(payload: Record<string, unknown>, status: number): boolean {
  if (status === 401) {
    return true;
  }
  const text = [
    normalizeString(payload.error_description),
    normalizeString(payload.error),
    normalizeString(payload.message),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("invalid client");
}

function buildTokenRequestBody(
  env: AppfolioReportsEnv,
  authStyle: TokenAuthStyle,
): URLSearchParams {
  const body = new URLSearchParams();
  if (env.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", env.refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
    if (env.scope) {
      body.set("scope", env.scope);
    }
  }
  if (authStyle === "body") {
    body.set("client_id", env.clientId ?? "");
    body.set("client_secret", env.clientSecret ?? "");
  }
  return body;
}

function buildTokenRequestHeaders(
  env: AppfolioReportsEnv,
  authStyle: TokenAuthStyle,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (authStyle === "basic" && env.clientId && env.clientSecret) {
    const token = Buffer.from(`${env.clientId}:${env.clientSecret}`, "utf8").toString("base64");
    headers.authorization = `Basic ${token}`;
  }
  return headers;
}

async function requestToken(
  env: AppfolioReportsEnv,
  fetchFn: FetchLike,
): Promise<{ ok: true; token: AppfolioTokenResult } | { ok: false; error: string }> {
  if (env.accessToken) {
    return {
      ok: true,
      token: {
        accessToken: env.accessToken,
        tokenType: "Bearer",
        expiresIn: null,
        scope: env.scope,
        source: "access_token",
      },
    };
  }

  if (!env.clientId || !env.clientSecret) {
    return { ok: false, error: "appfolio_client_credentials_missing" };
  }

  const attemptStyles: TokenAuthStyle[] = ["body", "basic"];
  let lastError = "appfolio_token_request_failed";

  for (let i = 0; i < attemptStyles.length; i++) {
    const authStyle = attemptStyles[i];
    let response: Response;
    try {
      response = await fetchFn(env.tokenUrl, {
        method: "POST",
        headers: buildTokenRequestHeaders(env, authStyle),
        body: buildTokenRequestBody(env, authStyle).toString(),
      });
    } catch (error) {
      return { ok: false, error: `appfolio_token_request_failed:${String(error)}` };
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const message = extractErrorMessage(payload, response.status);
      lastError = `appfolio_token_http_${response.status}:${message}`;
      const shouldTryBasicFallback =
        authStyle === "body" &&
        i < attemptStyles.length - 1 &&
        isInvalidClientResponse(payload, response.status);
      if (shouldTryBasicFallback) {
        continue;
      }
      return { ok: false, error: lastError };
    }

    const accessToken = normalizeString(payload.access_token);
    if (!accessToken) {
      return { ok: false, error: "appfolio_token_missing_access_token" };
    }

    return {
      ok: true,
      token: {
        accessToken,
        tokenType: normalizeString(payload.token_type),
        expiresIn: asNumber(payload.expires_in),
        scope: normalizeString(payload.scope),
        source: env.refreshToken ? "refresh_token" : "client_credentials",
      },
    };
  }

  return { ok: false, error: lastError };
}

function resolveDatabaseBaseUrl(env: AppfolioReportsEnv): string | null {
  if (env.databaseBaseUrl) {
    return normalizeBaseUrl(env.databaseBaseUrl);
  }
  if (env.databaseHost) {
    return `https://${env.databaseHost}`;
  }
  return null;
}

function countReportRows(payload: Record<string, unknown>): number | null {
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (Array.isArray(payload.data)) {
    return payload.data.length;
  }
  if (Array.isArray(payload.reports)) {
    return payload.reports.length;
  }
  if (Array.isArray(payload.results)) {
    return payload.results.length;
  }
  if (Array.isArray(payload.rows)) {
    return payload.rows.length;
  }
  return null;
}

function extractReportRows(payload: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.results)) {
    return payload.results;
  }
  if (Array.isArray(payload.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.reports)) {
    return payload.reports;
  }
  return null;
}

function extractColumns(rows: unknown[]): string[] {
  const firstObject = rows.find(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
  if (!firstObject) {
    return [];
  }
  return Object.keys(firstObject);
}

function normalizeMaxRows(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 200;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return 1;
  }
  return Math.min(normalized, 5000);
}

function extractNextPageUrl(payload: Record<string, unknown>): string | null {
  const value = payload.next_page_url;
  return normalizeString(value) ?? null;
}

function normalizeReportMethod(method: string | null | undefined): "GET" | "POST" {
  return method?.trim().toUpperCase() === "GET" ? "GET" : "POST";
}

function resolveBasicCredentials(env: AppfolioReportsEnv): BasicAuthCredentials | null {
  if (!env.clientId || !env.clientSecret) {
    return null;
  }
  return {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  };
}

function validateNextPageUrl(env: AppfolioReportsEnv, value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }
  if (env.databaseHost) {
    if (host !== env.databaseHost.toLowerCase()) {
      return null;
    }
  } else if (!(host === "appfolio.com" || host.endsWith(".appfolio.com"))) {
    return null;
  }
  if (!parsed.pathname.includes("/api/v2/reports/")) {
    return null;
  }
  return parsed;
}

async function runReportViaBasicAuth(
  env: AppfolioReportsEnv,
  fetchFn: FetchLike,
  options: {
    reportName: string;
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    includeRows?: boolean;
    maxRows?: number;
  },
): Promise<AppfolioReportRunResult> {
  if (!env.clientId || !env.clientSecret) {
    return {
      ok: false,
      reportName: options.reportName,
      error: "appfolio_client_credentials_missing",
    };
  }
  const baseUrl = resolveDatabaseBaseUrl(env);
  if (!baseUrl) {
    return {
      ok: false,
      reportName: options.reportName,
      error: "appfolio_database_missing",
    };
  }
  if (!options.reportName) {
    return {
      ok: false,
      reportName: options.reportName,
      error: "appfolio_report_name_missing",
    };
  }

  const method = options.method ?? env.reportMethod;
  const endpoint = `${baseUrl}/api/v2/reports/${options.reportName}`;
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`, "utf8").toString("base64")}`,
    accept: "application/json",
  };
  const requestInit: RequestInit = {
    method,
    headers,
  };
  if (method === "POST") {
    headers["content-type"] = "application/json";
    requestInit.body = JSON.stringify(options.body ?? {});
  }

  let response: Response;
  try {
    response = await fetchFn(endpoint, requestInit);
  } catch (error) {
    return {
      ok: false,
      reportName: options.reportName,
      endpoint,
      error: `appfolio_reports_request_failed:${String(error)}`,
    };
  }

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    if (response.status === 404) {
      return {
        ok: false,
        reportName: options.reportName,
        endpoint,
        status: response.status,
        error: `appfolio_reports_resource_not_found:${options.reportName}`,
      };
    }
    const message = extractErrorMessage(payload, response.status);
    return {
      ok: false,
      reportName: options.reportName,
      endpoint,
      status: response.status,
      error: `appfolio_reports_http_${response.status}:${message}`,
    };
  }

  const rows = extractReportRows(payload);
  const includeRows = options.includeRows === true;
  const maxRows = normalizeMaxRows(options.maxRows);
  const includedRows = includeRows && rows ? rows.slice(0, maxRows) : undefined;

  return {
    ok: true,
    reportName: options.reportName,
    endpoint,
    status: response.status,
    count: countReportRows(payload),
    nextPageUrl: extractNextPageUrl(payload),
    rows: includedRows,
    rowsReturned: includeRows ? (includedRows?.length ?? 0) : null,
    rowsTruncated: includeRows && rows ? rows.length > (includedRows?.length ?? 0) : false,
    columns: includeRows && includedRows ? extractColumns(includedRows) : undefined,
  };
}

async function probeReportsViaBasicAuth(
  env: AppfolioReportsEnv,
  fetchFn: FetchLike,
): Promise<{
  ok: boolean;
  endpoint?: string;
  status?: number;
  count?: number | null;
  error?: string;
}> {
  if (!env.reportName) {
    return { ok: false, error: "appfolio_report_name_missing" };
  }
  return await runReportViaBasicAuth(env, fetchFn, {
    reportName: env.reportName,
  });
}

async function probeReportsEndpoint(
  env: AppfolioReportsEnv,
  token: AppfolioTokenResult,
  fetchFn: FetchLike,
): Promise<{
  ok: boolean;
  endpoint?: string;
  status?: number;
  count?: number | null;
  error?: string;
}> {
  const candidates = [env.listPath, "/v1/reports", "/api/reports"];
  const deduped = Array.from(new Set(candidates));
  let lastError = "appfolio_reports_probe_failed";
  let lastStatus: number | undefined;

  for (const path of deduped) {
    const endpoint = `${env.apiBaseUrl}${path}`;
    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        headers: {
          authorization: `${token.tokenType ?? "Bearer"} ${token.accessToken}`,
          accept: "application/json",
        },
      });
    } catch (error) {
      lastError = `appfolio_reports_request_failed:${String(error)}`;
      continue;
    }

    lastStatus = response.status;
    const payload = await parseResponseBody(response);
    if (response.ok) {
      const listCandidate = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.reports)
          ? payload.reports
          : null;
      return {
        ok: true,
        endpoint,
        status: response.status,
        count: listCandidate ? listCandidate.length : null,
      };
    }

    if (response.status === 404) {
      lastError = `appfolio_reports_path_not_found:${path}`;
      continue;
    }

    const message = extractErrorMessage(payload, response.status);
    lastError = `appfolio_reports_http_${response.status}:${message}`;
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError,
  };
}

export async function runAppfolioReport(options: {
  reportName: string;
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
  includeRows?: boolean;
  maxRows?: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
}): Promise<AppfolioReportRunResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const env = resolveEnv(options.env ?? process.env);
  const reportName = normalizeReportResource(options.reportName);
  if (!reportName) {
    return {
      ok: false,
      reportName: options.reportName,
      error: "appfolio_report_name_missing",
    };
  }

  const preferBasicAuth =
    env.authMode === "basic" ||
    (env.authMode === "auto" &&
      (Boolean(env.databaseHost) || Boolean(env.databaseBaseUrl) || Boolean(env.reportName)));

  if (!preferBasicAuth) {
    return {
      ok: false,
      reportName,
      error: "appfolio_report_run_requires_basic_mode",
    };
  }

  return await runReportViaBasicAuth(env, fetchFn, {
    reportName,
    method: normalizeReportMethod(options.method),
    body: options.body,
    includeRows: options.includeRows,
    maxRows: options.maxRows,
  });
}

export async function runAppfolioReportNextPage(options: {
  nextPageUrl: string;
  method?: "GET" | "POST";
  includeRows?: boolean;
  maxRows?: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
}): Promise<AppfolioReportRunResult> {
  const env = resolveEnv(options.env ?? process.env);
  const fetchFn = options.fetchFn ?? fetch;
  const nextPageUrl = normalizeString(options.nextPageUrl);
  if (!nextPageUrl) {
    return {
      ok: false,
      reportName: "next_page",
      error: "appfolio_next_page_url_missing",
    };
  }

  const credentials = resolveBasicCredentials(env);
  if (!credentials) {
    return {
      ok: false,
      reportName: "next_page",
      error: "appfolio_client_credentials_missing",
    };
  }

  const endpointUrl = validateNextPageUrl(env, nextPageUrl);
  if (!endpointUrl) {
    return {
      ok: false,
      reportName: "next_page",
      error: "appfolio_next_page_url_invalid",
    };
  }

  const method = normalizeReportMethod(options.method);
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64")}`,
    accept: "application/json",
  };
  const requestInit: RequestInit = { method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetchFn(endpointUrl.toString(), requestInit);
  } catch (error) {
    return {
      ok: false,
      reportName: "next_page",
      endpoint: endpointUrl.toString(),
      error: `appfolio_reports_request_failed:${String(error)}`,
    };
  }

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message = extractErrorMessage(payload, response.status);
    return {
      ok: false,
      reportName: "next_page",
      endpoint: endpointUrl.toString(),
      status: response.status,
      error: `appfolio_reports_http_${response.status}:${message}`,
    };
  }

  const rows = extractReportRows(payload);
  const includeRows = options.includeRows === true;
  const maxRows = normalizeMaxRows(options.maxRows);
  const includedRows = includeRows && rows ? rows.slice(0, maxRows) : undefined;

  return {
    ok: true,
    reportName: "next_page",
    endpoint: endpointUrl.toString(),
    status: response.status,
    count: countReportRows(payload),
    nextPageUrl: extractNextPageUrl(payload),
    rows: includedRows,
    rowsReturned: includeRows ? (includedRows?.length ?? 0) : null,
    rowsTruncated: includeRows && rows ? rows.length > (includedRows?.length ?? 0) : false,
    columns: includeRows && includedRows ? extractColumns(includedRows) : undefined,
  };
}

export async function probeAppfolioReportsAccess(
  options: {
    env?: NodeJS.ProcessEnv;
    fetchFn?: FetchLike;
  } = {},
): Promise<AppfolioReportsProbeResult> {
  const env = resolveEnv(options.env ?? process.env);
  const fetchFn = options.fetchFn ?? fetch;
  const configured = {
    authMode: env.authMode,
    clientId: Boolean(env.clientId),
    clientSecret: Boolean(env.clientSecret),
    refreshToken: Boolean(env.refreshToken),
    accessToken: Boolean(env.accessToken),
    databaseHost: Boolean(env.databaseHost),
    databaseBaseUrl: Boolean(env.databaseBaseUrl),
    reportName: Boolean(env.reportName),
    tokenUrl: Boolean(env.tokenUrl),
    apiBaseUrl: Boolean(env.apiBaseUrl),
  };
  const warnings: string[] = [];

  const preferBasicAuth =
    env.authMode === "basic" ||
    (env.authMode === "auto" &&
      (configured.databaseHost || configured.databaseBaseUrl || configured.reportName));

  if (preferBasicAuth && !configured.databaseHost && !configured.databaseBaseUrl) {
    warnings.push(
      "Set OPENCLAW_APPFOLIO_REPORTS_DATABASE (or OPENCLAW_APPFOLIO_REPORTS_DATABASE_URL) for Basic Reports API mode.",
    );
  }
  if (preferBasicAuth && !configured.reportName) {
    warnings.push("Set OPENCLAW_APPFOLIO_REPORTS_REPORT_NAME (for example purchase_order.json).");
  }

  if (preferBasicAuth) {
    const reports = await probeReportsViaBasicAuth(env, fetchFn);
    return {
      ok: reports.ok,
      configured,
      token: {
        acquired: reports.ok,
        source: reports.ok ? "basic_auth" : "none",
      },
      reports: reports.ok
        ? reports
        : { ok: false, error: reports.error ?? "appfolio_reports_probe_failed" },
      warnings,
      ...(reports.ok ? {} : { error: reports.error ?? "appfolio_reports_probe_failed" }),
    };
  }

  if (!configured.refreshToken && !configured.accessToken) {
    warnings.push(
      "No refresh/access token configured. If client_credentials is not supported for your tenant, set OPENCLAW_APPFOLIO_REPORTS_REFRESH_TOKEN.",
    );
  }

  const token = await requestToken(env, fetchFn);
  if (!token.ok) {
    return {
      ok: false,
      configured,
      token: {
        acquired: false,
        source: "none",
      },
      reports: {
        ok: false,
        error: "token_not_acquired",
      },
      error: token.error,
      warnings,
    };
  }

  const reports = await probeReportsEndpoint(env, token.token, fetchFn);
  return {
    ok: reports.ok,
    configured,
    token: {
      acquired: true,
      source: token.token.source,
      tokenType: token.token.tokenType,
      expiresIn: token.token.expiresIn,
      scope: token.token.scope,
    },
    reports,
    warnings,
    ...(reports.ok ? {} : { error: reports.error ?? "appfolio_reports_probe_failed" }),
  };
}
