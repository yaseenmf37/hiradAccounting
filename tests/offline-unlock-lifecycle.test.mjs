import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { test } from "node:test";

Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  value: indexedDB,
});
Object.defineProperty(globalThis, "IDBKeyRange", {
  configurable: true,
  value: IDBKeyRange,
});
Object.defineProperty(globalThis, "BroadcastChannel", {
  configurable: true,
  value: undefined,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { onLine: true },
});

const browserWindow = new EventTarget();
browserWindow.location = {
  href: "http://localhost/",
  origin: "http://localhost",
};
let getRequests = 0;
let invoicePosts = 0;
const networkFetch = async (input, init = {}) => {
  const url = new URL(String(input), browserWindow.location.href);
  if ((init.method ?? "GET").toUpperCase() === "POST") {
    if (url.pathname !== "/api/invoices") {
      throw new Error(`Unexpected POST request: ${url.pathname}`);
    }
    invoicePosts += 1;
    return Response.json({
      invoice: { id: "server-invoice-1", invoiceNumber: "INV-0001" },
    });
  }

  getRequests += 1;
  if (url.pathname === "/api/categories") {
    return Response.json({ categories: [] });
  }
  if (url.pathname === "/api/dashboard") return Response.json({ total: 0 });
  const collections = {
    "/api/products": "products",
    "/api/contacts": "contacts",
    "/api/invoices": "invoices",
    "/api/payments": "payments",
    "/api/expenses": "expenses",
    "/api/backorders": "backorders",
  };
  const collection = collections[url.pathname];
  if (collection) return Response.json({ [collection]: [], nextCursor: null });
  throw new Error(`Unexpected GET request: ${url.pathname}`);
};
browserWindow.fetch = networkFetch;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: browserWindow,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args) => browserWindow.fetch(...args),
});

const storage = await import("../src/lib/offline-storage.ts");
const { syncOfflineOutbox } = await import("../src/lib/offline-outbox-sync.ts");
const userId = "lifecycle-user";
const businessId = "lifecycle-business";
const account = storage.getOfflineAccountKey(userId, businessId);
const password = "lifecycle test password";

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hirad-offline", 5);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("login, unlock, bootstrap, lock, reopen, and sync preserve Outbox without duplicate requests", async () => {
  assert.equal(
    await storage.setOfflineUnlockCredential(userId, businessId, password),
    true,
    "successful account setup unlocks the local data key",
  );
  storage.configureOfflineWorkspace({
    userId,
    businessId,
    businessName: "Local test",
  });
  await storage.bootstrapOfflineWorkspace(account);
  assert.equal(storage.isOfflineWorkspaceUnlocked(account), true);
  assert.equal((await storage.getActiveOfflineWorkspace()).snapshotStatus, "complete");

  await storage.enqueueOfflineOperation(account, {
    entityType: "invoice",
    entityId: "local-invoice-1",
    idempotencyKey: "offline-invoice-operation-0001",
    payload: {
      path: "/api/invoices",
      method: "POST",
      body: { type: "SALE", items: [{ productId: "test-product" }] },
    },
  });

  storage.lockOfflineWorkspace(userId, businessId);
  assert.equal(storage.isOfflineWorkspaceUnlocked(account), false);
  const requestsAtLock = getRequests;
  await storage.bootstrapOfflineWorkspace(account);
  await syncOfflineOutbox(account);
  await assert.rejects(storage.getOfflineOutboxOperations(account), /Unlock/);
  assert.equal(getRequests, requestsAtLock, "locked workspace must not start bootstrap");
  assert.equal(invoicePosts, 0, "locked workspace must not start sync");

  const database = await openDatabase();
  const transaction = database.transaction("outbox", "readonly");
  const records = await new Promise((resolve, reject) => {
    const request = transaction.objectStore("outbox").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(records.length, 1, "locking must preserve the encrypted Outbox record");
  assert.equal(records[0].status, "pending");

  assert.equal(
    await storage.verifyOfflineUnlockCredential(userId, businessId, password),
    true,
    "the same account can unlock again",
  );
  storage.configureOfflineWorkspace({
    userId,
    businessId,
    businessName: "Local test",
  });
  await storage.bootstrapOfflineWorkspace(account);
  await syncOfflineOutbox(account);
  await syncOfflineOutbox(account);

  assert.equal(invoicePosts, 1, "repeated sync calls send the idempotent operation once");
  const synced = await storage.getOfflineOutboxOperations(account);
  assert.equal(synced[0].status, "synced");
  assert.equal(synced[0].serverId, "server-invoice-1");
  assert.equal(synced[0].serverNumber, "INV-0001");
  database.close();
});
