"use client";

import {
  claimOfflineOutboxOperation,
  getOfflineOutboxOperations,
  isOfflineWorkspaceUnlocked,
  updateOfflineOutboxOperation,
} from "@/lib/offline-storage";

type SyncResponse = {
  invoice?: { id?: unknown; invoiceNumber?: unknown };
  [key: string]: unknown;
};

const activeSyncs = new Map<string, Promise<void>>();
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 15 * 60_000;

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function syncOfflineOutbox(account: string) {
  if (!navigator.onLine || !isOfflineWorkspaceUnlocked(account)) return;
  const activeSync = activeSyncs.get(account);
  if (activeSync) return activeSync;
  const run = performSync(account);
  activeSyncs.set(account, run);
  try {
    await run;
  } finally {
    if (activeSyncs.get(account) === run) activeSyncs.delete(account);
  }
}

async function performSync(account: string) {
  if (!isOfflineWorkspaceUnlocked(account)) return;
  let syncedAny = false;
  const operations = await getOfflineOutboxOperations(account);
  const completedThisPass = new Set(
    operations
      .filter((operation) => operation.status === "synced")
      .map((operation) => operation.operationId)
  );
  for (const operation of operations) {
    if (!navigator.onLine || !isOfflineWorkspaceUnlocked(account)) return;
    if (
      operation.dependsOnOperationIds?.some(
        (dependencyId) => !completedThisPass.has(dependencyId)
      )
    ) {
      continue;
    }
    const now = new Date();
    if (operation.status === "failed" || Date.parse(operation.nextAttemptAt) > now.getTime()) {
      continue;
    }
    if (!(await claimOfflineOutboxOperation(operation.operationId, account, now))) {
      continue;
    }
    if (!isOfflineWorkspaceUnlocked(account)) return;

    const request = operation.payload as {
      path?: unknown;
      method?: unknown;
      body?: unknown;
    };
    if (
      typeof request.path !== "string" ||
      !request.path.startsWith("/api/") ||
      typeof request.method !== "string" ||
      request.method !== "POST"
    ) {
      await updateOfflineOutboxOperation(operation.operationId, account, {
        status: "failed",
        lastError: "ساختار عملیات محلی معتبر نیست.",
      });
      continue;
    }

    try {
      const response = await fetch(request.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.idempotencyKey,
        },
        body: JSON.stringify(request.body),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as SyncResponse | null;
      if (!response.ok) {
        const message =
          typeof data?.message === "string"
            ? data.message
            : `سرور عملیات را با وضعیت ${response.status} نپذیرفت.`;
        if (isRetryableStatus(response.status)) {
          await scheduleRetry(operation, account, message);
        } else {
          await updateOfflineOutboxOperation(operation.operationId, account, {
            status: "failed",
            lastError: message,
          });
        }
        continue;
      }

      const invoice = data?.invoice;
      if (
        operation.entityType === "invoice" &&
        (!invoice || typeof invoice.id !== "string" || typeof invoice.invoiceNumber !== "string")
      ) {
        await scheduleRetry(operation, account, "پاسخ موفق سرور ناقص است؛ عملیات با همان کلید دوباره بررسی می‌شود.");
        continue;
      }
      await updateOfflineOutboxOperation(operation.operationId, account, {
        status: "synced",
        lastError: null,
        serverId: typeof invoice?.id === "string" ? invoice.id : null,
        serverNumber:
          typeof invoice?.invoiceNumber === "string" ? invoice.invoiceNumber : null,
      });
      completedThisPass.add(operation.operationId);
      syncedAny = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "اتصال به سرور ناموفق بود.";
      await scheduleRetry(operation, account, message);
    }
  }
  if (syncedAny) window.dispatchEvent(new Event("hirad-offline-sync-succeeded"));
}

async function scheduleRetry(
  operation: Awaited<ReturnType<typeof getOfflineOutboxOperations>>[number],
  account: string,
  message: string
) {
  const attempts = operation.attempts + 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 16), RETRY_MAX_MS);
  await updateOfflineOutboxOperation(operation.operationId, account, {
    status: "pending",
    attempts,
    nextAttemptAt: new Date(Date.now() + delay).toISOString(),
    lastError: message,
  });
  window.setTimeout(() => {
    if (navigator.onLine) void syncOfflineOutbox(account);
  }, delay);
}
