import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const databaseName = "hirad-offline";
const iterations = 310_000;

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
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    fetch: globalThis.fetch.bind(globalThis),
    location: { href: "http://localhost/", origin: "http://localhost" },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
  },
});

function openLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 4);
    request.onupgradeneeded = () => {
      const database = request.result;
      const responses = database.createObjectStore("responses", {
        keyPath: "key",
      });
      responses.createIndex("accountKey", "accountKey");
      database.createObjectStore("workspaces", { keyPath: "key" });
      database.createObjectStore("encryptionKeys", { keyPath: "accountKey" });
      const outbox = database.createObjectStore("outbox", {
        keyPath: "operationId",
      });
      outbox.createIndex("accountKey", "accountKey");
      outbox.createIndex("accountEntityId", ["accountKey", "entityId"]);
      database.createObjectStore("offlineCredentials", {
        keyPath: "accountKey",
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function seedLegacyAccount(database, userId, businessId, password) {
  const accountKey = `${userId}:${businessId}`;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const verifierSalt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const verifier = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: verifierSalt,
      iterations,
    },
    passwordKey,
    256
  );

  const responseIv = crypto.getRandomValues(new Uint8Array(12));
  const responsePayload = { dashboard: "legacy" };
  const responseCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: responseIv },
    key,
    new TextEncoder().encode(JSON.stringify(responsePayload))
  );
  const outboxIv = crypto.getRandomValues(new Uint8Array(12));
  const outboxPayload = { amount: 1250, note: "pending invoice" };
  const outboxCiphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: outboxIv },
    key,
    new TextEncoder().encode(JSON.stringify(outboxPayload))
  );

  const responseRecord = {
    key: `${accountKey}|/api/dashboard`,
    accountKey,
    url: "/api/dashboard",
    iv: responseIv.buffer,
    ciphertext: responseCiphertext,
    savedAt: new Date().toISOString(),
  };
  const outboxRecord = {
    operationId: `${userId}-operation`,
    accountKey,
    entityType: "invoice",
    entityId: `${userId}-invoice`,
    idempotencyKey: `${userId}-operation`,
    iv: outboxIv.buffer,
    ciphertext: outboxCiphertext,
    status: "pending",
    attempts: 2,
    nextAttemptAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverId: null,
    serverNumber: null,
  };

  const transaction = database.transaction(
    ["encryptionKeys", "offlineCredentials", "responses", "outbox"],
    "readwrite"
  );
  transaction.objectStore("encryptionKeys").put({ accountKey, key });
  transaction.objectStore("offlineCredentials").put({
    accountKey,
    salt: verifierSalt.buffer,
    verifier,
    iterations,
  });
  transaction.objectStore("responses").put(responseRecord);
  transaction.objectStore("outbox").put(outboxRecord);
  await transactionDone(transaction);
  return { accountKey, responseRecord, outboxRecord, responsePayload, outboxPayload };
}

const legacyDb = await openLegacyDatabase();
const interrupted = await seedLegacyAccount(
  legacyDb,
  "interrupt-user",
  "interrupt-business",
  "local password"
);
const migrated = await seedLegacyAccount(
  legacyDb,
  "migrate-user",
  "migrate-business",
  "local password"
);
const otherAccount = await seedLegacyAccount(
  legacyDb,
  "other-user",
  "other-business",
  "local password"
);
legacyDb.close();
const storage = await import("../src/lib/offline-storage.ts");
const database = await new Promise((resolve, reject) => {
  const request = indexedDB.open(databaseName, 5);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function getRecord(storeName, key) {
  const transaction = database.transaction(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function abortNextReadwriteTransaction(storeNames) {
  const prototype = Object.getPrototypeOf(database);
  const original = prototype.transaction;
  prototype.transaction = function (...args) {
    const transaction = original.apply(this, args);
    const requestedStores = Array.isArray(args[0]) ? args[0] : [args[0]];
    if (
      args[1] === "readwrite" &&
      storeNames.every((name) => requestedStores.includes(name))
    ) {
      prototype.transaction = original;
      queueMicrotask(() => {
        try {
          transaction.abort();
        } catch {
          // The transaction may have already completed.
        }
      });
    }
    return transaction;
  };
}

test("legacy migration abort keeps old key, ciphertext, credential, and Outbox usable", async () => {
  const legacyKey = await getRecord("encryptionKeys", interrupted.accountKey);
  const oldOutbox = await getRecord("outbox", interrupted.outboxRecord.operationId);
  const oldResponse = await getRecord("responses", interrupted.responseRecord.key);

  await abortNextReadwriteTransaction([
    "encryptionKeys",
    "offlineCredentials",
    "responses",
    "outbox",
  ]);
  await assert.rejects(
    storage.verifyOfflineUnlockCredential(
      "interrupt-user",
      "interrupt-business",
      "local password"
    )
  );

  const keyAfterAbort = await getRecord("encryptionKeys", interrupted.accountKey);
  assert.ok(keyAfterAbort.key);
  assert.equal(keyAfterAbort.formatVersion, undefined);
  assert.deepEqual(
    new Uint8Array(
      (await getRecord("outbox", interrupted.outboxRecord.operationId)).ciphertext
    ),
    new Uint8Array(oldOutbox.ciphertext)
  );
  assert.deepEqual(
    new Uint8Array(
      (await getRecord("responses", interrupted.responseRecord.key)).ciphertext
    ),
    new Uint8Array(oldResponse.ciphertext)
  );
  assert.equal(keyAfterAbort.key.algorithm.name, legacyKey.key.algorithm.name);

  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "interrupt-user",
      "interrupt-business",
      "local password"
    ),
    true
  );
  const operations = await storage.getOfflineOutboxOperations(interrupted.accountKey);
  assert.deepEqual(operations[0].payload, interrupted.outboxPayload);
});

test("wrong password changes nothing; successful migration wraps key and preserves data", async () => {
  const oldKey = await getRecord("encryptionKeys", migrated.accountKey);
  const oldOutbox = await getRecord("outbox", migrated.outboxRecord.operationId);

  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "wrong password"
    ),
    false
  );
  const unchangedKey = await getRecord("encryptionKeys", migrated.accountKey);
  assert.ok(unchangedKey.key);
  assert.deepEqual(
    new Uint8Array(
      (await getRecord("outbox", migrated.outboxRecord.operationId)).ciphertext
    ),
    new Uint8Array(oldOutbox.ciphertext)
  );

  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "local password"
    ),
    true
  );
  const wrappedKey = await getRecord("encryptionKeys", migrated.accountKey);
  assert.equal(wrappedKey.formatVersion, 2);
  assert.equal(wrappedKey.wrappingAlgorithm, "PBKDF2-AES-KW");
  assert.equal(wrappedKey.salt.byteLength, 16);
  assert.equal(wrappedKey.wrappedKey.byteLength, 40);
  assert.equal("key" in wrappedKey, false);

  const newOutbox = await getRecord("outbox", migrated.outboxRecord.operationId);
  assert.notDeepEqual(
    new Uint8Array(newOutbox.ciphertext),
    new Uint8Array(oldOutbox.ciphertext)
  );
  assert.equal(newOutbox.status, oldOutbox.status);
  assert.equal(newOutbox.idempotencyKey, oldOutbox.idempotencyKey);
  assert.deepEqual(
    (await storage.getOfflineOutboxOperations(migrated.accountKey))[0].payload,
    migrated.outboxPayload
  );
  assert.deepEqual(
    (await storage.getCachedApiResponses(migrated.accountKey))[0].payload,
    migrated.responsePayload
  );
  assert.equal(oldKey.formatVersion, undefined);

  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "other-user",
      "other-business",
      "local password"
    ),
    true
  );
  const otherWrappedKey = await getRecord("encryptionKeys", otherAccount.accountKey);
  assert.notDeepEqual(
    new Uint8Array(wrappedKey.salt),
    new Uint8Array(otherWrappedKey.salt)
  );
});

test("password change atomically rewraps the key and leaves pending Outbox intact", async () => {
  const account = migrated.accountKey;
  const oldOutbox = await getRecord("outbox", migrated.outboxRecord.operationId);

  assert.equal(
    await storage.changeOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "local password",
      "updated local password"
    ),
    true
  );
  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "local password"
    ),
    false
  );
  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "updated local password"
    ),
    true
  );
  const outbox = await getRecord("outbox", migrated.outboxRecord.operationId);
  assert.deepEqual(new Uint8Array(outbox.ciphertext), new Uint8Array(oldOutbox.ciphertext));
  assert.deepEqual(
    (await storage.getOfflineOutboxOperations(account))[0].payload,
    migrated.outboxPayload
  );

  storage.lockOfflineWorkspace("migrate-user", "migrate-business");
  assert.deepEqual(
    new Uint8Array(
      (await getRecord("outbox", migrated.outboxRecord.operationId)).ciphertext
    ),
    new Uint8Array(oldOutbox.ciphertext)
  );
  await assert.rejects(storage.getOfflineOutboxOperations(account));
  assert.equal(
    await storage.verifyOfflineUnlockCredential(
      "migrate-user",
      "migrate-business",
      "updated local password"
    ),
    true
  );
  assert.deepEqual(
    (await storage.getOfflineOutboxOperations(account))[0].payload,
    migrated.outboxPayload
  );
});
