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

const browserWindow = new EventTarget();
browserWindow.location = {
  href: "http://localhost/",
  origin: "http://localhost",
};
browserWindow.fetch = async (input) => {
  const url = new URL(String(input), browserWindow.location.href);
  if (url.pathname === "/api/categories") {
    return Response.json({ categories: [{ id: "previous", name: "قبلی" }] });
  }
  throw new Error(`Unexpected bootstrap request: ${url.pathname}`);
};
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: browserWindow,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args) => browserWindow.fetch(...args),
});

const storage = await import("../src/lib/offline-storage.ts");
const account = storage.getOfflineAccountKey("category-test-user", "category-test-business");

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hirad-offline", 5);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function abortNextResponseWrite(database) {
  const prototype = Object.getPrototypeOf(database);
  const original = prototype.transaction;
  prototype.transaction = function (...args) {
    const transaction = original.apply(this, args);
    const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (args[1] === "readwrite" && stores.includes("responses")) {
      prototype.transaction = original;
      queueMicrotask(() => transaction.abort());
    }
    return transaction;
  };
}

test("category cache failure exposes its IndexedDB cause and preserves the old cache and Outbox", async () => {
  await storage.setOfflineUnlockCredential(
    "category-test-user",
    "category-test-business",
    "local test password",
  );
  storage.configureOfflineWorkspace({
    userId: "category-test-user",
    businessId: "category-test-business",
    businessName: "آزمایشی",
  });

  const firstResponse = await browserWindow.fetch("/api/categories");
  assert.equal(firstResponse.ok, true);
  await storage.enqueueOfflineOperation(account, {
    entityType: "invoice",
    entityId: "pending-invoice",
    idempotencyKey: "pending-invoice-operation",
    payload: { invoiceNumber: "temporary-test-number" },
  });

  const oldCategories = await storage.getCachedEndpointCollection(
    account,
    "/api/categories",
    "categories",
  );
  assert.deepEqual(oldCategories, [{ id: "previous", name: "قبلی" }]);
  const oldOutbox = await storage.getOfflineOutboxOperations(account);
  assert.equal(oldOutbox.length, 1);

  const database = await openDatabase();
  await abortNextResponseWrite(database);
  await assert.rejects(
    storage.bootstrapOfflineWorkspace(account),
    (error) => {
      assert.match(error.message, /Offline response \/api\/categories could not be saved/);
      assert.match(error.message, /AbortError:/);
      assert.ok(error.cause instanceof DOMException);
      assert.equal(error.cause.name, "AbortError");
      return true;
    },
  );

  assert.deepEqual(
    await storage.getCachedEndpointCollection(account, "/api/categories", "categories"),
    oldCategories,
    "the failed replacement must not overwrite previously cached categories",
  );
  assert.deepEqual(
    (await storage.getOfflineOutboxOperations(account)).map((operation) => ({
      idempotencyKey: operation.idempotencyKey,
      payload: operation.payload,
      status: operation.status,
    })),
    [{
      idempotencyKey: "pending-invoice-operation",
      payload: { invoiceNumber: "temporary-test-number" },
      status: "pending",
    }],
    "a cache failure must preserve pending financial operations",
  );
  database.close();
});
