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
let detailRequests = 0;
let ledgerRequests = 0;
let contactInvoiceRequests = 0;
let networkUnavailable = false;
const postedOperations = [];
const networkFetch = async (input, init = {}) => {
  const url = new URL(String(input), browserWindow.location.href);
  if (networkUnavailable) throw new TypeError("Failed to fetch");
  if ((init.method ?? "GET").toUpperCase() === "POST") {
    const body = JSON.parse(init.body);
    postedOperations.push({
      path: url.pathname,
      idempotencyKey: new Headers(init.headers).get("Idempotency-Key"),
      body,
    });
    if (url.pathname === "/api/invoices") {
      invoicePosts += 1;
      return Response.json({
        invoice: { id: "server-invoice-1", invoiceNumber: "INV-0001" },
      });
    }
    if (url.pathname === "/api/contacts") {
      return Response.json({ contact: { id: body.id } });
    }
    if (url.pathname === "/api/expenses") {
      return Response.json({ expense: { id: body.id } });
    }
    if (url.pathname === "/api/payments") {
      return Response.json({ payment: { id: body.id } });
    }
    throw new Error(`Unexpected POST request: ${url.pathname}`);
  }

  getRequests += 1;
  if (url.pathname === "/api/categories") {
    return Response.json({ categories: [] });
  }
  if (url.pathname === "/api/dashboard") return Response.json({ total: 0 });
  if (url.pathname === "/api/invoices/cached-invoice") {
    detailRequests += 1;
    return Response.json({
      invoice: {
        id: "cached-invoice",
        payments: [{ amount: "300" }],
        salesReturns: [{ id: "sales-return-1", total: "50" }],
        purchaseReturns: [{ id: "purchase-return-1", total: "25" }],
      },
    });
  }
  if (url.pathname === "/api/contacts/cached-contact/ledger") {
    ledgerRequests += 1;
    const secondPage = url.searchParams.has("cursor");
    return Response.json({
      contact: { id: "cached-contact" },
      summary: { balance: "625" },
      entries: [{
        id: secondPage ? "ledger-entry-2" : "ledger-entry-1",
        amount: secondPage ? "25" : "600",
        balance: secondPage ? "625" : "600",
      }],
      total: 2,
      nextCursor: secondPage ? null : "next-ledger",
    });
  }
  if (url.pathname === "/api/contacts/cached-contact/invoices") {
    contactInvoiceRequests += 1;
    const secondPage = url.searchParams.has("cursor");
    return Response.json({
      invoices: [{
        id: secondPage ? "cached-invoice-2" : "cached-invoice",
        invoiceNumber: secondPage ? "INV-CACHED-2" : "INV-CACHED",
      }],
      nextCursor: secondPage ? null : "next-invoice",
    });
  }
  const collections = {
    "/api/products": "products",
    "/api/contacts": "contacts",
    "/api/invoices": "invoices",
    "/api/payments": "payments",
    "/api/expenses": "expenses",
    "/api/backorders": "backorders",
  };
  const collection = collections[url.pathname];
  if (collection) {
    const records = {
      contacts: [{ id: "cached-contact" }],
      invoices: [{ id: "cached-invoice" }],
    }[collection] ?? [];
    return Response.json({ [collection]: records, nextCursor: null });
  }
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
  assert.equal(detailRequests, 1, "bootstrap captures full invoice details");
  assert.equal(ledgerRequests, 2, "bootstrap captures every contact ledger page");
  assert.equal(contactInvoiceRequests, 2, "bootstrap captures every related-invoice page");
  const cachedInvoiceDetail = await storage.getCachedEndpointPayloads(
    account,
    "/api/invoices/cached-invoice",
  );
  assert.equal(cachedInvoiceDetail[0].invoice.salesReturns.length, 1);
  assert.equal(cachedInvoiceDetail[0].invoice.payments.length, 1);
  const cachedLedger = await storage.getCachedEndpointPayloads(
    account,
    "/api/contacts/cached-contact/ledger",
  );
  assert.equal(cachedLedger.length, 2);
  assert.equal(cachedLedger[0].summary.balance, "625");
  networkUnavailable = true;
  navigator.onLine = false;
  const offlineDetail = await browserWindow.fetch("/api/invoices/cached-invoice");
  assert.equal(offlineDetail.headers.get("X-Hirad-Offline-Cache"), "true");
  assert.equal((await offlineDetail.json()).invoice.salesReturns.length, 1);
  const cacheMiss = await browserWindow.fetch("/api/invoices/not-cached");
  assert.equal(cacheMiss.status, 503, "an offline cache miss returns controlled API JSON");
  assert.equal(cacheMiss.headers.get("X-Hirad-Offline-Cache"), "miss");
  networkUnavailable = false;
  navigator.onLine = true;

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
  await storage.enqueueOfflineOperation(account, {
    entityType: "payment",
    entityId: "offline-payment-id-0001",
    dependsOnOperationIds: ["offline-invoice-operation-0001"],
    idempotencyKey: "offline-payment-id-0001",
    payload: {
      path: "/api/payments",
      method: "POST",
      body: { id: "offline-payment-id-0001", invoiceId: "local-invoice-1" },
    },
  });
  await storage.enqueueOfflineOperation(account, {
    entityType: "contact",
    entityId: "offline-contact-id-0001",
    idempotencyKey: "offline-contact-id-0001",
    payload: {
      path: "/api/contacts",
      method: "POST",
      body: { id: "offline-contact-id-0001", name: "test" },
    },
  });
  await storage.enqueueOfflineOperation(account, {
    entityType: "expense",
    entityId: "offline-expense-id-0001",
    idempotencyKey: "offline-expense-id-0001",
    payload: {
      path: "/api/expenses",
      method: "POST",
      body: { id: "offline-expense-id-0001", amount: 1 },
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
  assert.equal(records.length, 4, "locking must preserve every encrypted Outbox record");
  assert.equal(records.every((record) => record.status === "pending"), true);

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

  assert.equal(invoicePosts, 1, "repeated sync calls send the invoice once");
  assert.equal(postedOperations.length, 4, "each queued create is sent once");
  const paymentPost = postedOperations.find((entry) => entry.path === "/api/payments");
  assert.equal(paymentPost.body.invoiceId, "server-invoice-1");
  assert.equal(paymentPost.idempotencyKey, "offline-payment-id-0001");
  const synced = await storage.getOfflineOutboxOperations(account);
  assert.equal(synced[0].status, "synced");
  assert.equal(synced[0].serverId, "server-invoice-1");
  assert.equal(synced[0].serverNumber, "INV-0001");
  assert.equal(synced.every((operation) => operation.status === "synced"), true);
  database.close();
});
