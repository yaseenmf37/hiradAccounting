"use client";

const DATABASE_NAME = "hirad-offline";
const DATABASE_VERSION = 5;
const RESPONSE_STORE = "responses";
const WORKSPACE_STORE = "workspaces";
const KEY_STORE = "encryptionKeys";
const OUTBOX_STORE = "outbox";
const CREDENTIAL_STORE = "offlineCredentials";
const ACTIVE_WORKSPACE_KEY = "active";
const MAX_RESPONSE_BYTES = 2_000_000;
const OFFLINE_CREDENTIAL_ITERATIONS = 310_000;
const OFFLINE_KEY_FORMAT_VERSION = 2;
const OFFLINE_CREDENTIAL_FORMAT_VERSION = 2;

type OfflineStorageFailureDetail = {
  accountKey?: string;
  operation?: string;
  url?: string;
  error: unknown;
};

function describeStorageError(error: unknown, seen = new Set<unknown>()): {
  name: string;
  message: string;
  cause?: ReturnType<typeof describeStorageError>;
} {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return { name: error.name, message: error.message, cause: { name: "Error", message: "Circular cause" } };
    }
    seen.add(error);
    const cause = "cause" in error ? error.cause : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(cause === undefined ? {} : { cause: describeStorageError(cause, seen) }),
    };
  }
  if (error && typeof error === "object") {
    if (seen.has(error)) {
      return { name: "UnknownError", message: "Circular error cause" };
    }
    seen.add(error);
    const value = error as { name?: unknown; message?: unknown; cause?: unknown };
    let message = typeof value.message === "string" ? value.message : "";
    if (!message) {
      try {
        message = JSON.stringify(error) ?? Object.prototype.toString.call(error);
      } catch {
        message = Object.prototype.toString.call(error);
      }
    }
    return {
      name: typeof value.name === "string" ? value.name : "UnknownError",
      message,
      ...(value.cause === undefined
        ? {}
        : { cause: describeStorageError(value.cause, seen) }),
    };
  }
  return { name: "UnknownError", message: String(error) };
}

function reportOfflineStorageError(
  error: unknown,
  context: Omit<OfflineStorageFailureDetail, "error"> = {},
) {
  const details = describeStorageError(error);
  console.error(
    `Offline storage failed during ${context.operation ?? "unknown operation"}${context.url ? ` for ${context.url}` : ""}: ${details.name}: ${details.message}`,
    { ...context, error: details },
  );
  const event = new Event("hirad-offline-storage-error");
  Object.defineProperty(event, "detail", {
    value: { ...context, error } satisfies OfflineStorageFailureDetail,
  });
  window.dispatchEvent(event);
}

export type CachedApiResponse = {
  key: string;
  accountKey: string;
  url: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  savedAt: string;
};

export type DecryptedCachedApiResponse = CachedApiResponse & {
  payload: unknown;
};

export type OfflineWorkspace = {
  accountKey: string;
  userId: string;
  businessId: string;
  businessName: string;
  lastOnlineAt: string;
  snapshotStatus?: "pending" | "complete" | "error";
  lastSnapshotAt?: string | null;
};

export type OfflineOutboxOperation = {
  operationId: string;
  accountKey: string;
  entityType: string;
  entityId: string;
  dependsOnOperationIds?: string[];
  idempotencyKey: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  status: "pending" | "syncing" | "failed" | "synced";
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  serverId: string | null;
  serverNumber: string | null;
};

export type DecryptedOfflineOutboxOperation = OfflineOutboxOperation & {
  payload: unknown;
};

type LegacyKeyRecord = {
  accountKey: string;
  key: CryptoKey;
  formatVersion?: undefined;
};

type WrappedKeyRecord = {
  accountKey: string;
  keyId: string;
  formatVersion: number;
  wrappingAlgorithm: "PBKDF2-AES-KW";
  salt: ArrayBuffer;
  iterations: number;
  wrappedKey: ArrayBuffer;
};

type OfflineCredentialRecord = {
  accountKey: string;
  formatVersion: number;
  salt: ArrayBuffer;
  verifier: ArrayBuffer;
  iterations: number;
  updatedAt: string;
};

let databasePromise: Promise<IDBDatabase> | null = null;
let configuredAccountKey: string | null = null;
let originalFetch: typeof window.fetch | null = null;
const encryptionKeys = new Map<string, Promise<CryptoKey>>();
const encryptionKeyIds = new Map<string, string>();
const unlockedAccounts = new Set<string>();
const workspaceBootstrapRuns = new Map<string, Promise<void>>();
const responseStorageFailures = new WeakMap<Response, {
  url: string;
  error: unknown;
}>();
const lockChannel =
  typeof window === "undefined" || !("BroadcastChannel" in window)
    ? null
    : new BroadcastChannel("hirad-offline-workspace-lock");

lockChannel?.addEventListener("message", (event: MessageEvent<{ account?: unknown }>) => {
  if (typeof event.data?.account !== "string") return;
  lockOfflineAccountInMemory(event.data.account);
});

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("مرورگر از ذخیره‌سازی محلی پشتیبانی نمی‌کند."));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RESPONSE_STORE)) {
        const responses = database.createObjectStore(RESPONSE_STORE, {
          keyPath: "key",
        });
        responses.createIndex("accountKey", "accountKey", { unique: false });
      }
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: "accountKey" });
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = database.createObjectStore(OUTBOX_STORE, {
          keyPath: "operationId",
        });
        outbox.createIndex("accountKey", "accountKey", { unique: false });
        outbox.createIndex("accountEntityId", ["accountKey", "entityId"], {
          unique: false,
        });
      }
      if (!database.objectStoreNames.contains(CREDENTIAL_STORE)) {
        database.createObjectStore(CREDENTIAL_STORE, { keyPath: "accountKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("باز کردن حافظه محلی ناموفق بود."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("به‌روزرسانی حافظه محلی مسدود شده است."));
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("خواندن حافظه محلی ناموفق بود."));
  });
}

function accountKey(userId: string, businessId: string) {
  return `${userId}:${businessId}`;
}

function randomBuffer(byteLength: number) {
  const buffer = new ArrayBuffer(byteLength);
  crypto.getRandomValues(new Uint8Array(buffer));
  return buffer;
}

async function derivePasswordKey(password: string, salt: ArrayBuffer) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey", "deriveBits"]
  );
  return {
    passwordKey,
    wrappingKey: await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new Uint8Array(salt),
        iterations: OFFLINE_CREDENTIAL_ITERATIONS,
      },
      passwordKey,
      { name: "AES-KW", length: 256 },
      false,
      ["wrapKey", "unwrapKey"]
    ),
  };
}

async function createCredentialRecord(
  account: string,
  password: string
): Promise<OfflineCredentialRecord> {
  const salt = randomBuffer(16);
  const { passwordKey } = await derivePasswordKey(password, salt);
  const verifier = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt),
      iterations: OFFLINE_CREDENTIAL_ITERATIONS,
    },
    passwordKey,
    256
  );
  return {
    accountKey: account,
    formatVersion: OFFLINE_CREDENTIAL_FORMAT_VERSION,
    salt,
    verifier,
    iterations: OFFLINE_CREDENTIAL_ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

function isValidCredentialRecord(
  record: Partial<OfflineCredentialRecord> | undefined
): record is OfflineCredentialRecord {
  return !!record &&
    (record.formatVersion === undefined ||
      record.formatVersion === OFFLINE_CREDENTIAL_FORMAT_VERSION) &&
    record.iterations === OFFLINE_CREDENTIAL_ITERATIONS &&
    record.salt instanceof ArrayBuffer &&
    record.salt.byteLength === 16 &&
    record.verifier instanceof ArrayBuffer &&
    record.verifier.byteLength === 32;
}

async function verifyCredentialRecord(
  password: string,
  credential: OfflineCredentialRecord
) {
  const { passwordKey } = await derivePasswordKey(password, credential.salt);
  const verifier = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(credential.salt),
      iterations: credential.iterations,
    },
    passwordKey,
    256
  );
  return equalBytes(
    new Uint8Array(verifier),
    new Uint8Array(credential.verifier)
  );
}

async function wrapDataKey(account: string, password: string, key: CryptoKey) {
  const salt = randomBuffer(16);
  const { wrappingKey } = await derivePasswordKey(password, salt);
  const wrappedKey = await crypto.subtle.wrapKey(
    "raw",
    key,
    wrappingKey,
    "AES-KW"
  );
  return {
    accountKey: account,
    keyId: crypto.randomUUID(),
    formatVersion: OFFLINE_KEY_FORMAT_VERSION,
    wrappingAlgorithm: "PBKDF2-AES-KW" as const,
    salt,
    iterations: OFFLINE_CREDENTIAL_ITERATIONS,
    wrappedKey,
  } satisfies WrappedKeyRecord;
}

function isWrappedKeyRecord(
  record: LegacyKeyRecord | WrappedKeyRecord | undefined
): record is WrappedKeyRecord {
  return !!record &&
    "formatVersion" in record &&
    record.formatVersion === OFFLINE_KEY_FORMAT_VERSION &&
    typeof record.keyId === "string" &&
    record.keyId.length > 0 &&
    record.wrappingAlgorithm === "PBKDF2-AES-KW" &&
    record.iterations === OFFLINE_CREDENTIAL_ITERATIONS &&
    record.salt instanceof ArrayBuffer &&
    record.salt.byteLength === 16 &&
    record.wrappedKey instanceof ArrayBuffer &&
    record.wrappedKey.byteLength === 40;
}

async function unwrapDataKey(
  record: WrappedKeyRecord,
  password: string,
  extractable = false
) {
  const { wrappingKey } = await derivePasswordKey(password, record.salt);
  return crypto.subtle.unwrapKey(
    "raw",
    record.wrappedKey,
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"]
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function setOfflineUnlockCredential(
  userId: string,
  businessId: string,
  password: string
) {
  if (!password) throw new Error("رمز عبور برای قفل فضای آفلاین معتبر نیست.");
  const account = accountKey(userId, businessId);
  const database = await openDatabase();
  const { keyRecord } = await getAccountKeyAndCredential(
    database,
    account
  );

  if (isWrappedKeyRecord(keyRecord)) {
    try {
      const key = await unwrapDataKey(keyRecord, password);
      const credential = await createCredentialRecord(account, password);
      await commitCredentialOnly(database, account, credential);
      encryptionKeys.set(account, Promise.resolve(key));
      encryptionKeyIds.set(account, keyRecord.keyId);
      unlockedAccounts.add(account);
      notifyOfflineWorkspaceUnlocked(account);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "OperationError") {
        return false;
      }
      throw error;
    }
  }

  if (keyRecord && !("key" in keyRecord)) {
    throw new Error("قالب کلید آفلاین پشتیبانی نمی‌شود؛ داده‌ها حفظ شده‌اند.");
  }

  const records = await getAccountEncryptedRecords(database, account);
  const legacyKey = keyRecord?.key;
  if (!legacyKey && (records.responses.length || records.outbox.length)) {
    throw new Error("کلید داده‌های آفلاین پیدا نشد؛ برای جلوگیری از حذف داده‌ها تنظیم متوقف شد.");
  }
  const key = await migrateAccountEncryption(
    database,
    account,
    password,
    legacyKey,
    records,
    keyRecord ? "legacy" : undefined
  );
  encryptionKeys.set(account, Promise.resolve(key));
  encryptionKeyIds.set(account, await getWrappedKeyId(database, account));
  unlockedAccounts.add(account);
  notifyOfflineWorkspaceUnlocked(account);
  return true;
}

export async function verifyOfflineUnlockCredential(
  userId: string,
  businessId: string,
  password: string
) {
  const account = accountKey(userId, businessId);
  const database = await openDatabase();
  const { keyRecord, credentialRecord } = await getAccountKeyAndCredential(
    database,
    account
  );
  if (!isValidCredentialRecord(credentialRecord)) return false;

  let valid: boolean;
  try {
    valid = await verifyCredentialRecord(password, credentialRecord);
  } catch {
    return false;
  }
  if (!valid) return false;

  if (isWrappedKeyRecord(keyRecord)) {
    try {
      const key = await unwrapDataKey(keyRecord, password);
      encryptionKeys.set(account, Promise.resolve(key));
      encryptionKeyIds.set(account, keyRecord.keyId);
      unlockedAccounts.add(account);
      notifyOfflineWorkspaceUnlocked(account);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "OperationError") {
        return false;
      }
      throw error;
    }
  }

  if (!keyRecord || !("key" in keyRecord)) return false;
  const records = await getAccountEncryptedRecords(database, account);
  const key = await migrateAccountEncryption(
    database,
    account,
    password,
    keyRecord.key,
    records,
    "legacy"
  );
  encryptionKeys.set(account, Promise.resolve(key));
  encryptionKeyIds.set(account, await getWrappedKeyId(database, account));
  unlockedAccounts.add(account);
  notifyOfflineWorkspaceUnlocked(account);
  return true;
}

export async function changeOfflineUnlockCredential(
  userId: string,
  businessId: string,
  currentPassword: string,
  newPassword: string
) {
  if (!newPassword) throw new Error("رمز عبور جدید معتبر نیست.");
  const account = accountKey(userId, businessId);
  const database = await openDatabase();
  const { keyRecord, credentialRecord } = await getAccountKeyAndCredential(
    database,
    account
  );

  if (!keyRecord) {
    const records = await getAccountEncryptedRecords(database, account);
    if (records.responses.length || records.outbox.length) {
      throw new Error("کلید داده‌های آفلاین پیدا نشد؛ داده‌ها حفظ شده‌اند.");
    }
    return setOfflineUnlockCredential(userId, businessId, newPassword);
  }

  if (!isValidCredentialRecord(credentialRecord) ||
      !(await verifyCredentialRecord(currentPassword, credentialRecord))) {
    throw new Error("رمز فعلی فضای آفلاین معتبر نیست؛ داده‌ها بدون تغییر حفظ شده‌اند.");
  }

  if (isWrappedKeyRecord(keyRecord)) {
    const extractableKey = await unwrapDataKey(keyRecord, currentPassword, true);
    const newKeyRecord = await wrapDataKey(account, newPassword, extractableKey);
    const newCredential = await createCredentialRecord(account, newPassword);
    const key = await unwrapDataKey(newKeyRecord, newPassword);
    await commitKeyAndCredential(
      database,
      account,
      keyRecord.keyId,
      newKeyRecord,
      newCredential
    );
    encryptionKeys.set(account, Promise.resolve(key));
    encryptionKeyIds.set(account, newKeyRecord.keyId);
    unlockedAccounts.add(account);
    notifyOfflineWorkspaceUnlocked(account);
    lockChannel?.postMessage({ account });
    return true;
  }

  if (!("key" in keyRecord)) {
    throw new Error("قالب کلید آفلاین پشتیبانی نمی‌شود؛ داده‌ها حفظ شده‌اند.");
  }
  const records = await getAccountEncryptedRecords(database, account);
  const key = await migrateAccountEncryption(
    database,
    account,
    newPassword,
    keyRecord.key,
    records,
    "legacy"
  );
  encryptionKeys.set(account, Promise.resolve(key));
  encryptionKeyIds.set(account, await getWrappedKeyId(database, account));
  unlockedAccounts.add(account);
  notifyOfflineWorkspaceUnlocked(account);
  return true;
}

async function getWrappedKeyId(database: IDBDatabase, account: string) {
  const transaction = database.transaction(KEY_STORE, "readonly");
  const record = await requestResult(
    transaction.objectStore(KEY_STORE).get(account)
  ) as WrappedKeyRecord | undefined;
  if (!isWrappedKeyRecord(record)) {
    throw new Error("کلید آفلاین پس از انتقال قابل تأیید نیست.");
  }
  return record.keyId;
}

async function getAccountKeyAndCredential(
  database: IDBDatabase,
  account: string
) {
  const transaction = database.transaction([KEY_STORE, CREDENTIAL_STORE], "readonly");
  const [keyRecord, credentialRecord] = await Promise.all([
    requestResult(transaction.objectStore(KEY_STORE).get(account)),
    requestResult(transaction.objectStore(CREDENTIAL_STORE).get(account)),
  ]);
  return {
    keyRecord: keyRecord as LegacyKeyRecord | WrappedKeyRecord | undefined,
    credentialRecord: credentialRecord as OfflineCredentialRecord | undefined,
  };
}

async function getAccountEncryptedRecords(database: IDBDatabase, account: string) {
  const transaction = database.transaction([RESPONSE_STORE, OUTBOX_STORE], "readonly");
  const [responses, outbox] = await Promise.all([
    requestResult(transaction.objectStore(RESPONSE_STORE).index("accountKey").getAll(account)),
    requestResult(transaction.objectStore(OUTBOX_STORE).index("accountKey").getAll(account)),
  ]);
  return {
    responses: responses as CachedApiResponse[],
    outbox: outbox as OfflineOutboxOperation[],
  };
}

async function reencryptRecord<T extends { iv: ArrayBuffer; ciphertext: ArrayBuffer }>(
  record: T,
  oldKey: CryptoKey,
  newKey: CryptoKey
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(record.iv) },
    oldKey,
    record.ciphertext
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    newKey,
    plaintext
  );
  return { ...record, iv: iv.buffer, ciphertext };
}

async function migrateAccountEncryption(
  database: IDBDatabase,
  account: string,
  password: string,
  legacyKey: CryptoKey | undefined,
  records: {
    responses: CachedApiResponse[];
    outbox: OfflineOutboxOperation[];
  },
  expectedKeyId: string | undefined
): Promise<CryptoKey> {
  const dataKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const wrappedKey = await wrapDataKey(account, password, dataKey);
  const newKey = await unwrapDataKey(wrappedKey, password);
  const credential = await createCredentialRecord(account, password);
  const migratedResponses = legacyKey
    ? await Promise.all(records.responses.map((record) =>
        reencryptRecord(record, legacyKey, newKey)
      ))
    : [];
  const migratedOutbox = legacyKey
    ? await Promise.all(records.outbox.map((record) =>
        reencryptRecord(record, legacyKey, newKey)
      ))
    : [];

  await commitEncryptionMigration(
    database,
    account,
    expectedKeyId,
    wrappedKey,
    credential,
    records,
    migratedResponses,
    migratedOutbox
  );
  lockChannel?.postMessage({ account });
  return newKey;
}

function commitEncryptionMigration(
  database: IDBDatabase,
  account: string,
  expectedKeyId: string | undefined,
  keyRecord: WrappedKeyRecord,
  credential: OfflineCredentialRecord,
  expectedRecords: {
    responses: CachedApiResponse[];
    outbox: OfflineOutboxOperation[];
  },
  responses: CachedApiResponse[],
  outbox: OfflineOutboxOperation[]
) {
  const transaction = database.transaction(
    [KEY_STORE, CREDENTIAL_STORE, RESPONSE_STORE, OUTBOX_STORE],
    "readwrite"
  );
  const keyStore = transaction.objectStore(KEY_STORE);
  const currentKeyRequest = keyStore.get(account);
  const currentResponsesRequest = transaction
    .objectStore(RESPONSE_STORE)
    .index("accountKey")
    .getAll(account);
  const currentOutboxRequest = transaction
    .objectStore(OUTBOX_STORE)
    .index("accountKey")
    .getAll(account);
  let completedReads = 0;
  const finishRead = () => {
    completedReads += 1;
    if (completedReads !== 3) return;
    const currentKey = currentKeyRequest.result as
      | LegacyKeyRecord
      | WrappedKeyRecord
      | undefined;
    if (
      (expectedKeyId === undefined && currentKey) ||
      (expectedKeyId !== undefined &&
        (!currentKey ||
          ("keyId" in currentKey ? currentKey.keyId : "legacy") !== expectedKeyId)) ||
      !sameEncryptedRecords(
        currentResponsesRequest.result as CachedApiResponse[],
        expectedRecords.responses
      ) ||
      !sameEncryptedRecords(
        currentOutboxRequest.result as OfflineOutboxOperation[],
        expectedRecords.outbox
      )
    ) {
      transaction.abort();
      return;
    }
    keyStore.put(keyRecord);
    transaction.objectStore(CREDENTIAL_STORE).put(credential);
    for (const response of responses) {
      transaction.objectStore(RESPONSE_STORE).put(response);
    }
    for (const operation of outbox) {
      transaction.objectStore(OUTBOX_STORE).put(operation);
    }
  };
  currentKeyRequest.onsuccess = finishRead;
  currentResponsesRequest.onsuccess = finishRead;
  currentOutboxRequest.onsuccess = finishRead;
  return transactionResult(
    transaction,
    "انتقال امن داده‌های آفلاین ناموفق بود؛ نسخه قبلی حفظ شده است."
  );
}

function sameEncryptedRecords(
  current: Array<CachedApiResponse | OfflineOutboxOperation>,
  expected: Array<CachedApiResponse | OfflineOutboxOperation>
) {
  if (current.length !== expected.length) return false;
  const expectedById = new Map(
    expected.map((record) => [
      "key" in record ? record.key : record.operationId,
      record,
    ])
  );
  return current.every((record) => {
    const id = "key" in record ? record.key : record.operationId;
    const previous = expectedById.get(id);
    if (
      !previous ||
      !equalBytes(new Uint8Array(record.iv), new Uint8Array(previous.iv)) ||
      !equalBytes(
        new Uint8Array(record.ciphertext),
        new Uint8Array(previous.ciphertext)
      )
    ) {
      return false;
    }
    if ("key" in record && "key" in previous) {
      return record.savedAt === previous.savedAt;
    }
    if (!("key" in record) && !("key" in previous)) {
      return (
        record.status === previous.status &&
        record.updatedAt === previous.updatedAt &&
        record.attempts === previous.attempts &&
        record.nextAttemptAt === previous.nextAttemptAt &&
        record.lastError === previous.lastError &&
        record.serverId === previous.serverId &&
        record.serverNumber === previous.serverNumber
      );
    }
    return false;
  });
}

function commitKeyAndCredential(
  database: IDBDatabase,
  account: string,
  expectedKeyId: string,
  keyRecord: WrappedKeyRecord,
  credential: OfflineCredentialRecord
) {
  const transaction = database.transaction([KEY_STORE, CREDENTIAL_STORE], "readwrite");
  const currentKeyRequest = transaction.objectStore(KEY_STORE).get(account);
  currentKeyRequest.onsuccess = () => {
    const currentKey = currentKeyRequest.result as
      | LegacyKeyRecord
      | WrappedKeyRecord
      | undefined;
    if (
      !isWrappedKeyRecord(currentKey) ||
      currentKey.keyId !== expectedKeyId
    ) {
      transaction.abort();
      return;
    }
    transaction.objectStore(KEY_STORE).put(keyRecord);
    transaction.objectStore(CREDENTIAL_STORE).put(credential);
  };
  return transactionResult(transaction, "تغییر قفل فضای آفلاین ناموفق بود؛ داده‌ها حفظ شده‌اند.");
}

function commitCredentialOnly(
  database: IDBDatabase,
  account: string,
  credential: OfflineCredentialRecord
) {
  const transaction = database.transaction(CREDENTIAL_STORE, "readwrite");
  transaction.objectStore(CREDENTIAL_STORE).put(credential);
  return transactionResult(transaction, "ذخیره verifier محلی ناموفق بود؛ داده‌ها حفظ شده‌اند.");
}

function transactionResult(transaction: IDBTransaction, message: string) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(message));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(message));
  });
}

function lockOfflineAccountInMemory(account: string) {
  unlockedAccounts.delete(account);
  encryptionKeys.delete(account);
  encryptionKeyIds.delete(account);
  if (configuredAccountKey === account) configuredAccountKey = null;
  window.dispatchEvent(new CustomEvent("hirad-offline-workspace-locked", {
    detail: { account },
  }));
}

export function lockOfflineWorkspace(userId: string, businessId: string) {
  const account = accountKey(userId, businessId);
  lockOfflineAccountInMemory(account);
  lockChannel?.postMessage({ account });
}

async function saveResponse(
  account: string,
  url: string,
  payload: unknown,
  responseSize: number
) {
  if (responseSize > MAX_RESPONSE_BYTES) {
    throw new Error(`Offline response exceeds the ${MAX_RESPONSE_BYTES}-byte storage limit.`);
  }

  const key = await getAccountEncryptionKey(account);
  const keyId = encryptionKeyIds.get(account);
  if (!keyId) throw new Error("نسخه کلید محلی مشخص نیست؛ برای امنیت، ذخیره پاسخ متوقف شد.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const serialized = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    serialized
  );
  const database = await openDatabase();
  const transaction = database.transaction(
    [KEY_STORE, RESPONSE_STORE, WORKSPACE_STORE],
    "readwrite"
  );
  const savedAt = new Date().toISOString();
  const keyRequest = transaction.objectStore(KEY_STORE).get(account);
  await new Promise<void>((resolve, reject) => {
    let callbackError: unknown;
    const abortWith = (error: unknown) => {
      callbackError ??= error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted due to the original error.
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      callbackError ??= transaction.error;
    };
    transaction.onabort = () => {
      reject(
        callbackError ??
          transaction.error ??
          new DOMException("IndexedDB response transaction aborted.", "AbortError"),
      );
    };
    keyRequest.onerror = () => {
      callbackError ??= keyRequest.error;
    };
    keyRequest.onsuccess = () => {
      if (!isWrappedKeyRecord(keyRequest.result) || keyRequest.result.keyId !== keyId) {
        abortWith(new Error("Account encryption key changed while saving the cached response."));
        return;
      }

      try {
        transaction.objectStore(RESPONSE_STORE).put({
          key: `${account}|${url}`,
          accountKey: account,
          url,
          iv: iv.buffer,
          ciphertext,
          savedAt,
        } satisfies CachedApiResponse);
        const workspaceRequest = transaction
          .objectStore(WORKSPACE_STORE)
          .get(ACTIVE_WORKSPACE_KEY);
        workspaceRequest.onerror = () => {
          callbackError ??= workspaceRequest.error;
        };
        workspaceRequest.onsuccess = () => {
          const workspace = workspaceRequest.result as
            | (OfflineWorkspace & { key: string })
            | undefined;
          if (workspace?.accountKey === account) {
            try {
              transaction.objectStore(WORKSPACE_STORE).put({
                ...workspace,
                lastOnlineAt: savedAt,
              });
            } catch (error) {
              abortWith(error);
            }
          }
        };
      } catch (error) {
        abortWith(error);
      }
    };
  });
  window.dispatchEvent(new Event("hirad-offline-storage-ready"));
}

async function findResponse(account: string, url: string) {
  const database = await openDatabase();
  const transaction = database.transaction(RESPONSE_STORE, "readonly");
  const cached = (await requestResult(
    transaction.objectStore(RESPONSE_STORE).get(`${account}|${url}`)
  )) as CachedApiResponse | undefined;
  if (!cached) return undefined;

  const key = await getAccountEncryptionKey(account);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(cached.iv) },
    key,
    cached.ciphertext
  );
  return {
    ...cached,
    payload: JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
  } satisfies DecryptedCachedApiResponse;
}

function getAccountEncryptionKey(account: string): Promise<CryptoKey> {
  const cachedKey = encryptionKeys.get(account);
  if (!unlockedAccounts.has(account) || !cachedKey) {
    return Promise.reject(new Error("کلید آفلاین باز نیست؛ برای دسترسی به داده‌ها حساب را دوباره Unlock کنید."));
  }
  return cachedKey;
}

export function isOfflineWorkspaceUnlocked(account: string) {
  return unlockedAccounts.has(account) && encryptionKeys.has(account);
}

function notifyOfflineWorkspaceUnlocked(account: string) {
  window.dispatchEvent(new CustomEvent("hirad-offline-workspace-unlocked", {
    detail: { account },
  }));
}

export function configureOfflineWorkspace(workspace: Omit<OfflineWorkspace, "accountKey" | "lastOnlineAt">) {
  if (typeof window === "undefined" || !workspace.businessId) return;

  const account = accountKey(workspace.userId, workspace.businessId);
  if (configuredAccountKey === account) return;
  configuredAccountKey = account;

  if (!originalFetch) originalFetch = window.fetch.bind(window);
  const networkFetch = originalFetch;

  window.fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, window.location.href);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/api/") ||
      method !== "GET"
    ) {
      return networkFetch(input, init);
    }

    let response: Response;
    try {
      response = await networkFetch(input, init);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const cached = await findResponse(account, url.pathname + url.search);
      if (!cached) throw error;

      return new Response(JSON.stringify(cached.payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Hirad-Offline-Cache": "true",
        },
      });
    }

    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return response;
    }

    if (!isOfflineWorkspaceUnlocked(account)) return response;

    try {
      const payload = await response.clone().json();
      const responseSize = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      await saveResponse(account, url.pathname + url.search, payload, responseSize);
    } catch (error) {
      responseStorageFailures.set(response, {
        url: url.pathname + url.search,
        error,
      });
      reportOfflineStorageError(error, {
        accountKey: account,
        operation: "cache-api-response",
        url: url.pathname + url.search,
      });
    }
    return response;
  };

  void (async () => {
    const database = await openDatabase();
    const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
    const store = transaction.objectStore(WORKSPACE_STORE);
    const request = store.get(ACTIVE_WORKSPACE_KEY);
    request.onsuccess = () => {
      const previous = request.result as
        | (OfflineWorkspace & { key: string })
        | undefined;
      store.put({
        key: ACTIVE_WORKSPACE_KEY,
        ...workspace,
        accountKey: account,
        lastOnlineAt: new Date().toISOString(),
        ...(previous?.accountKey === account
          ? {
              snapshotStatus: previous.snapshotStatus,
              lastSnapshotAt: previous.lastSnapshotAt,
            }
          : {}),
      } satisfies OfflineWorkspace & { key: string });
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("ذخیره فضای آفلاین ناموفق بود."));
    });
  })().catch((error: unknown) => {
    reportOfflineStorageError(error, {
      accountKey: account,
      operation: "save-active-workspace",
    });
  });
}

export async function getActiveOfflineWorkspace() {
  const database = await openDatabase();
  const transaction = database.transaction(WORKSPACE_STORE, "readonly");
  const workspace = await requestResult(
    transaction.objectStore(WORKSPACE_STORE).get(ACTIVE_WORKSPACE_KEY)
  );
  return (workspace as OfflineWorkspace & { key: string } | undefined) ?? null;
}

export async function setOfflineSnapshotStatus(
  account: string,
  status: NonNullable<OfflineWorkspace["snapshotStatus"]>,
  lastSnapshotAt?: string
) {
  const database = await openDatabase();
  const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
  const store = transaction.objectStore(WORKSPACE_STORE);
  const request = store.get(ACTIVE_WORKSPACE_KEY);
  request.onsuccess = () => {
    const workspace = request.result as
      | (OfflineWorkspace & { key: string })
      | undefined;
    if (workspace?.accountKey !== account) return;
    store.put({
      ...workspace,
      snapshotStatus: status,
      ...(lastSnapshotAt ? { lastSnapshotAt } : {}),
    });
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("وضعیت دریافت داده‌ها ذخیره نشد."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("ذخیره وضعیت دریافت داده‌ها لغو شد."));
  });
  window.dispatchEvent(new Event("hirad-offline-snapshot-updated"));
}

export async function bootstrapOfflineWorkspace(account: string) {
  if (!isOfflineWorkspaceUnlocked(account)) return;
  const activeRun = workspaceBootstrapRuns.get(account);
  if (activeRun) return activeRun;

  const run = performWorkspaceBootstrap(account);
  workspaceBootstrapRuns.set(account, run);
  try {
    await run;
  } finally {
    if (workspaceBootstrapRuns.get(account) === run) {
      workspaceBootstrapRuns.delete(account);
    }
  }
}

async function performWorkspaceBootstrap(account: string) {
  if (!isOfflineWorkspaceUnlocked(account)) return;
  const datasets: {
    path: string;
    params: Record<string, string>;
    collection: string;
  }[] = [
    { path: "/api/products", params: { includeArchived: "true" }, collection: "products" },
    { path: "/api/contacts", params: { type: "ALL", status: "all" }, collection: "contacts" },
    { path: "/api/invoices", params: { settlement: "all" }, collection: "invoices" },
    { path: "/api/payments", params: {}, collection: "payments" },
    { path: "/api/expenses", params: { status: "ALL" }, collection: "expenses" },
    { path: "/api/backorders", params: {}, collection: "backorders" },
  ];

  const assertResponseWasSaved = (response: Response, url: string) => {
    const failure = responseStorageFailures.get(response);
    if (!failure) return;
    const cause = failure.error;
    const causeMessage = cause instanceof Error
      ? `${cause.name}: ${cause.message}`
      : String(cause);
    throw new Error(
      `Offline response ${url} could not be saved: ${causeMessage}`,
      { cause },
    );
  };
  try {
    await setOfflineSnapshotStatus(account, "pending");
    if (!isOfflineWorkspaceUnlocked(account)) return;
    const categoriesResponse = await fetch("/api/categories", {
      cache: "no-store",
    });
    if (!isOfflineWorkspaceUnlocked(account)) return;
    assertResponseWasSaved(categoriesResponse, "/api/categories");
    if (!categoriesResponse.ok) {
      throw new Error(`Offline bootstrap failed for /api/categories: ${categoriesResponse.status}`);
    }
    const categoriesPayload: unknown = await categoriesResponse.json();
    if (
      !categoriesPayload ||
      typeof categoriesPayload !== "object" ||
      !Array.isArray((categoriesPayload as { categories?: unknown }).categories)
    ) {
      throw new Error("Invalid offline bootstrap response from /api/categories");
    }
    for (const dataset of datasets) {
      let cursor: string | null = null;
      let pages = 0;
      do {
        const params = new URLSearchParams({
          ...dataset.params,
          limit: "25",
        });
        if (cursor) params.set("cursor", cursor);
        const requestUrl = `${dataset.path}?${params}`;
        const response = await fetch(requestUrl, {
          cache: "no-store",
        });
        if (!isOfflineWorkspaceUnlocked(account)) return;
        assertResponseWasSaved(response, requestUrl);
        if (!response.ok) {
          throw new Error(`Offline bootstrap failed for ${dataset.path}: ${response.status}`);
        }
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new Error(`Invalid offline bootstrap response from ${dataset.path}`);
        }
        if (
          !Array.isArray((result as Record<string, unknown>)[dataset.collection]) ||
          !Object.hasOwn(result, "nextCursor")
        ) {
          throw new Error(`Incomplete offline bootstrap response from ${dataset.path}`);
        }
        const nextCursor = (result as { nextCursor?: unknown }).nextCursor;
        if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
          throw new Error(`Invalid pagination cursor from ${dataset.path}`);
        }
        cursor = typeof nextCursor === "string" ? nextCursor : null;
        pages += 1;
        if (pages >= 1000 && cursor) {
          throw new Error(`Offline bootstrap page limit reached for ${dataset.path}`);
        }
      } while (cursor);
    }

    const dashboardResponse = await fetch("/api/dashboard", { cache: "no-store" });
    if (!isOfflineWorkspaceUnlocked(account)) return;
    assertResponseWasSaved(dashboardResponse, "/api/dashboard");
    if (!dashboardResponse.ok) {
      throw new Error(`Offline bootstrap failed for dashboard: ${dashboardResponse.status}`);
    }
    await dashboardResponse.json();

    await setOfflineSnapshotStatus(account, "complete", new Date().toISOString());
  } catch (error) {
    if (!isOfflineWorkspaceUnlocked(account)) return;
    try {
      await setOfflineSnapshotStatus(account, "error");
    } catch (statusError) {
      throw new AggregateError(
        [error, statusError],
        "Offline bootstrap failed and its error status could not be saved.",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function getCachedApiResponses(account: string) {
  const key = await getAccountEncryptionKey(account);
  const database = await openDatabase();
  const transaction = database.transaction(RESPONSE_STORE, "readonly");
  const responses = await requestResult(
    transaction.objectStore(RESPONSE_STORE).index("accountKey").getAll(account)
  );
  return Promise.all(
    (responses as CachedApiResponse[])
      .sort((left, right) => left.savedAt.localeCompare(right.savedAt))
      .map(async (response) => {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(response.iv) },
          key,
          response.ciphertext
        );
        return {
          ...response,
          payload: JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
        } satisfies DecryptedCachedApiResponse;
      })
  );
}

export function getOfflineAccountKey(userId: string, businessId: string) {
  return accountKey(userId, businessId);
}

export async function enqueueOfflineOperation<T>(
  account: string,
  operation: {
    entityType: string;
    entityId: string;
    dependsOnOperationIds?: string[];
    idempotencyKey: string;
    payload: T;
  }
) {
  const key = await getAccountEncryptionKey(account);
  const keyId = encryptionKeyIds.get(account);
  if (!keyId) throw new Error("نسخه کلید محلی مشخص نیست؛ برای حفظ عملیات، ذخیره در صف متوقف شد.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(operation.payload))
  );
  const now = new Date().toISOString();
  const record: OfflineOutboxOperation = {
    operationId: operation.idempotencyKey,
    accountKey: account,
    entityType: operation.entityType,
    entityId: operation.entityId,
    dependsOnOperationIds: operation.dependsOnOperationIds ?? [],
    idempotencyKey: operation.idempotencyKey,
    iv: iv.buffer,
    ciphertext,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    serverId: null,
    serverNumber: null,
  };
  const database = await openDatabase();
  const transaction = database.transaction([KEY_STORE, OUTBOX_STORE], "readwrite");
  const keyRequest = transaction.objectStore(KEY_STORE).get(account);
  keyRequest.onsuccess = () => {
    if (!isWrappedKeyRecord(keyRequest.result) || keyRequest.result.keyId !== keyId) {
      transaction.abort();
      return;
    }
    transaction.objectStore(OUTBOX_STORE).add(record);
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("ذخیره عملیات آفلاین ناموفق بود."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("ذخیره عملیات آفلاین لغو شد."));
  });
  window.dispatchEvent(new Event("hirad-offline-outbox-updated"));
  return record.operationId;
}

export async function getOfflineOutboxOperations(account: string) {
  const key = await getAccountEncryptionKey(account);
  const database = await openDatabase();
  const transaction = database.transaction(OUTBOX_STORE, "readonly");
  const records = (await requestResult(
    transaction.objectStore(OUTBOX_STORE).index("accountKey").getAll(account)
  )) as OfflineOutboxOperation[];
  return Promise.all(
    records
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(async (record): Promise<DecryptedOfflineOutboxOperation> => {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(record.iv) },
          key,
          record.ciphertext
        );
        return {
          ...record,
          payload: JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
        };
      })
  );
}

export async function updateOfflineOutboxOperation(
  operationId: string,
  account: string,
  update: Partial<
    Pick<
      OfflineOutboxOperation,
      | "status"
      | "attempts"
      | "nextAttemptAt"
      | "lastError"
      | "serverId"
      | "serverNumber"
    >
  >
) {
  const database = await openDatabase();
  const transaction = database.transaction(OUTBOX_STORE, "readwrite");
  const store = transaction.objectStore(OUTBOX_STORE);
  const request = store.get(operationId);
  request.onsuccess = () => {
    const operation = request.result as OfflineOutboxOperation | undefined;
    if (!operation || operation.accountKey !== account) return;
    store.put({ ...operation, ...update, updatedAt: new Date().toISOString() });
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("به‌روزرسانی وضعیت عملیات ناموفق بود."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("به‌روزرسانی وضعیت عملیات لغو شد."));
  });
  window.dispatchEvent(new Event("hirad-offline-outbox-updated"));
}

export async function claimOfflineOutboxOperation(
  operationId: string,
  account: string,
  now: Date
) {
  const database = await openDatabase();
  const transaction = database.transaction(OUTBOX_STORE, "readwrite");
  const store = transaction.objectStore(OUTBOX_STORE);
  const request = store.get(operationId);
  let claimed = false;
  request.onsuccess = () => {
    const operation = request.result as OfflineOutboxOperation | undefined;
    if (!operation || operation.accountKey !== account) return;
    const staleSending =
      operation.status === "syncing" &&
      now.getTime() - Date.parse(operation.updatedAt) > 2 * 60 * 1000;
    const ready = operation.status === "pending" && Date.parse(operation.nextAttemptAt) <= now.getTime();
    if (!ready && !staleSending) return;
    claimed = true;
    store.put({
      ...operation,
      status: "syncing",
      updatedAt: now.toISOString(),
    } satisfies OfflineOutboxOperation);
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("دریافت عملیات صف ناموفق بود."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("دریافت عملیات صف لغو شد."));
  });
  if (claimed) window.dispatchEvent(new Event("hirad-offline-outbox-updated"));
  return claimed;
}

export async function removeOfflineOutboxOperation(
  operationId: string,
  account: string,
  notify = true
) {
  const database = await openDatabase();
  const transaction = database.transaction(OUTBOX_STORE, "readwrite");
  const store = transaction.objectStore(OUTBOX_STORE);
  const request = store.get(operationId);
  request.onsuccess = () => {
    const operation = request.result as OfflineOutboxOperation | undefined;
    if (operation?.accountKey === account) store.delete(operationId);
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("پاک‌سازی عملیات همگام‌شده ناموفق بود."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("پاک‌سازی عملیات همگام‌شده لغو شد."));
  });
  if (notify) window.dispatchEvent(new Event("hirad-offline-outbox-updated"));
}

export async function getCachedEndpointPayloads(account: string, endpoint: string) {
  const responses = await getCachedApiResponses(account);
  return responses
    .filter((response) =>
      new URL(response.url, window.location.origin).pathname === endpoint
    )
    .map((response) => response.payload);
}

export async function getCachedEndpointCollection(
  account: string,
  endpoint: string,
  collection: string
) {
  const payloads = await getCachedEndpointPayloads(account, endpoint);
  const records = new Map<string, Record<string, unknown>>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const values = (payload as Record<string, unknown>)[collection];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string") records.set(record.id, record);
    }
  }
  return [...records.values()];
}
