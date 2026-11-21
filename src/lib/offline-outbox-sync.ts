"use client";

import {
  claimOfflineOutboxOperation,
  getOfflineOutboxOperations,
  isOfflineWorkspaceUnlocked,
  updateOfflineOutboxOperation,
} from "@/lib/offline-storage";

type SyncEntity = { id?: unknown; invoiceNumber?: unknown };

type SyncResponse = {
  invoice?: SyncEntity;
  contact?: SyncEntity;
  expense?: SyncEntity;
  payment?: SyncEntity;
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
  const operationsById = new Map(
    operations.map((operation) => [operation.operationId, operation]),
  );
  const serverIdsByOperation = new Map(
    operations
      .filter((operation) => operation.status === "synced" && operation.serverId)
      .map((operation) => [operation.operationId, operation.serverId!]),
  );
  for (const operation of operations) {
    if (!navigator.onLine || !isOfflineWorkspaceUnlocked(account)) return;
    if (
      operation.dependsOnOperationIds?.some(
        (dependencyId) => !completedThisPass.has(dependencyId)
      )
    ) {
      const missingOrFailedDependency = operation.dependsOnOperationIds
        .map((dependencyId) => operationsById.get(dependencyId))
        .find((dependency) => !dependency || dependency.status === "failed");
      if (missingOrFailedDependency) {
        await updateOfflineOutboxOperation(operation.operationId, account, {
          status: "failed",
          lastError: "عملیات وابسته همگام‌سازی نشده است؛ ارتباط اسناد حفظ شد و این عملیات ارسال نشد.",
        });
      }
      continue;
    }
    const now = new Date();
    if (operation.status === "failed" || Date.parse(operation.nextAttemptAt) > now.getTime()) {
      continue;
    }
    if (!(await claimOfflineOutboxOperation(operation.operationId, account, now))) {
      continue;
    }
    if (!isOfflineWorkspaceUnlocked(account)) {
      await updateOfflineOutboxOperation(operation.operationId, account, {
        status: "pending",
      });
      return;
    }

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
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? { ...(request.body as Record<string, unknown>) }
          : request.body;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const bodyRecord = body as Record<string, unknown>;
        for (const dependencyId of operation.dependsOnOperationIds ?? []) {
          const dependency = operationsById.get(dependencyId);
          const serverId = serverIdsByOperation.get(dependencyId);
          if (
            dependency?.entityType === "invoice" &&
            bodyRecord.invoiceId === dependency.entityId &&
            !serverId
          ) {
            throw new Error("شناسه رسمی فاکتور وابسته هنوز از سرور دریافت نشده است.");
          }
          if (
            dependency?.entityType === "invoice" &&
            serverId &&
            bodyRecord.invoiceId === dependency.entityId
          ) {
            bodyRecord.invoiceId = serverId;
          }
        }
      }
      const response = await fetch(request.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.idempotencyKey,
        },
        body: JSON.stringify(body),
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

      const entityResponseKey = {
        invoice: "invoice",
        contact: "contact",
        expense: "expense",
        payment: "payment",
      }[operation.entityType];
      const syncedEntity = entityResponseKey
        ? data?.[entityResponseKey] as SyncEntity | undefined
        : undefined;
      if (
        entityResponseKey &&
        (!syncedEntity ||
          typeof syncedEntity.id !== "string" ||
          (operation.entityType === "invoice" &&
            typeof syncedEntity.invoiceNumber !== "string"))
      ) {
        await scheduleRetry(operation, account, "پاسخ موفق سرور ناقص است؛ عملیات با همان کلید دوباره بررسی می‌شود.");
        continue;
      }
      await updateOfflineOutboxOperation(operation.operationId, account, {
        status: "synced",
        lastError: null,
        serverId: typeof syncedEntity?.id === "string" ? syncedEntity.id : null,
        serverNumber:
          typeof syncedEntity?.invoiceNumber === "string"
            ? syncedEntity.invoiceNumber
            : null,
      });
      completedThisPass.add(operation.operationId);
      if (typeof syncedEntity?.id === "string") {
        serverIdsByOperation.set(operation.operationId, syncedEntity.id);
      }
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
