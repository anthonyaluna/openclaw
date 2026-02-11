import JSON5 from "json5";
import fs from "node:fs";
import path from "node:path";
import type { WorkforceStoreFile } from "./types.js";
import { resolveStateDir } from "../config/paths.js";

export const DEFAULT_WORKFORCE_DIR = path.join(resolveStateDir(process.env), "workforce");
export const DEFAULT_WORKFORCE_STORE_PATH = path.join(DEFAULT_WORKFORCE_DIR, "state.json");

export function resolveWorkforceStorePath(storePath?: string): string {
  if (storePath?.trim()) {
    return path.resolve(storePath.trim());
  }
  return DEFAULT_WORKFORCE_STORE_PATH;
}

export async function loadWorkforceStore(
  storePath: string,
): Promise<{ store: WorkforceStoreFile | null; exists: boolean }> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON5.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse workforce store at ${storePath}: ${String(err)}`, {
        cause: err,
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { store: null, exists: true };
    }
    return { store: parsed as WorkforceStoreFile, exists: true };
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return { store: null, exists: false };
    }
    throw err;
  }
}

export async function saveWorkforceStore(storePath: string, store: WorkforceStoreFile) {
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = `${JSON.stringify(store, null, 2)}\n`;
  await fs.promises.writeFile(tmp, json, "utf-8");
  const retryableCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.promises.rename(tmp, storePath);
      lastError = null;
      break;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (!code || !retryableCodes.has(code) || attempt === 4) {
        lastError = err;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

export async function updateWorkforceStore<T>(
  storePath: string,
  updater: (store: WorkforceStoreFile | null) => Promise<{ store: WorkforceStoreFile; result: T }>,
): Promise<T> {
  const { store } = await loadWorkforceStore(storePath);
  const { store: next, result } = await updater(store);
  await saveWorkforceStore(storePath, next);
  return result;
}
