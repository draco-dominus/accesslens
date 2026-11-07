"use client";

/**
 * Device-only photo persistence for the current inspection. Photos are normalized JPEGs before they
 * reach this module; callers store a smaller copy so IndexedDB does not retain the original camera file.
 * Failures are intentionally non-fatal: an inspection must keep working in memory in private browsing
 * or when the device is out of storage.
 */

const DB_NAME = "accesslens-local";
const STORE = "inspection-photos";
const VERSION = 1;

type StoredPhoto = {
  key: string;
  sessionId: string;
  scanId: string;
  blob: Blob;
  savedAt: number;
};

const keyFor = (sessionId: string, scanId: string) => `${sessionId}:${scanId}`;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Local photo storage is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE) ? request.transaction!.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: "key" });
      if (!store.indexNames.contains("sessionId")) store.createIndex("sessionId", "sessionId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local photo storage."));
    request.onblocked = () => reject(new Error("Local photo storage is blocked by another AccessLens tab."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Local photo storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Local photo storage was interrupted."));
  });
}

export async function saveInspectionPhoto(sessionId: string, scanId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(STORE).put({ key: keyFor(sessionId, scanId), sessionId, scanId, blob, savedAt: Date.now() } satisfies StoredPhoto);
    await done;
  } finally {
    db.close();
  }
}

export async function loadInspectionPhotos(sessionId: string): Promise<Map<string, Blob>> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const done = transactionDone(tx);
    const request = tx.objectStore(STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId));
    const records = await new Promise<StoredPhoto[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredPhoto[]);
      request.onerror = () => reject(request.error ?? new Error("Could not restore inspection photos."));
    });
    await done;
    return new Map(records.map((record) => [record.scanId, record.blob]));
  } finally {
    db.close();
  }
}

export async function deleteInspectionPhotos(sessionId: string): Promise<void> {
  const db = await openDb();
  try {
    const read = db.transaction(STORE, "readonly");
    const readDone = transactionDone(read);
    const request = read.objectStore(STORE).index("sessionId").getAllKeys(IDBKeyRange.only(sessionId));
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not find stored inspection photos."));
    });
    await readDone;
    if (!keys.length) return;
    const write = db.transaction(STORE, "readwrite");
    const writeDone = transactionDone(write);
    for (const key of keys) write.objectStore(STORE).delete(key);
    await writeDone;
  } finally {
    db.close();
  }
}

export function photoStorageMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  return name === "QuotaExceededError"
    ? "This device is out of local storage. Photos remain available until you close or reload this page."
    : "Photos remain available for this visit, but this browser could not save them for reloads.";
}
