/**
 * Workspace persistence (rev 17.18): crash recovery and recency, NOT a
 * document store. Files are truth; ob is stateless; the browser holds
 * drafts. Nothing here expands ob's command surface — the CLI's state
 * remains "whatever is in your files", and this module is the workbench's
 * swap file: the raw buffer text (verbatim, so a mid-edit unparseable
 * state survives a crash exactly as typed), the last-valid parsed
 * document, provenance, and the tab-session payload.
 *
 * Storage is IndexedDB rather than localStorage: one real-world document
 * (PokeAPI) is ~180KB and localStorage's ~5MB origin cap is a ceiling we
 * would actually hit. Caveat inherited from the platform: IndexedDB is
 * per-ORIGIN, and origin includes the port — a workbench served from a
 * fallback port cannot see sessions stored under the default port.
 *
 * The lease channel distinguishes RETURNING from OPENING-BESIDE: a fresh
 * tab that finds no live tabs is a return and silently resumes the most
 * recent session; a fresh tab that finds another tab already holding a
 * lease boots the plain default, because guessing which older session the
 * user meant would be wrong more often than right. A leased session is
 * never opened by a second tab — two tabs writing one record is exactly
 * the trample the per-tab session isolation was built to prevent.
 */

const DB_NAME = "openbindings.ob-start.workspaces.v1";
const STORE = "workspaces";
const CHANNEL = "openbindings.ob-start.workspace-leases.v1";

/** Oldest-unleased eviction beyond this many sessions. Eviction is delete
 * wearing gloves — a session can be the only copy of unexported work — so
 * the cap is generous and leased sessions are never evicted. */
export const WORKSPACE_CAP = 30;

export interface WorkspaceRecord {
  id: string;
  /** The buffer verbatim — including unparseable mid-edit states. */
  documentText: string;
  /** The last-valid parsed document, for hydrating the model on adopt. */
  document: unknown;
  label: string;
  name: string;
  version: string;
  /** Provenance as the user would say it: "this ob", a URL, a file name. */
  origin: string;
  /** The tab-session sessionStorage payload, carried verbatim so the
   * existing restore path replays it without knowing workspaces exist. */
  sessionsJSON: string | null;
  /**
   * Target invocation context for THIS document (rev 17.20). It rides the
   * workspace because it belongs to the document whose operations it
   * authorizes — while it lived in app chrome it evaporated on every
   * reload, which is exactly the loss 17.18 set out to end. It can carry
   * secrets, so the honest statement is the one the dialog makes: held in
   * this browser, alongside the session, sent only to the selected target.
   */
  context: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  version: string;
  origin: string;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDB();
  return dbPromise;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function putWorkspace(record: WorkspaceRecord): Promise<void> {
  const database = await db();
  await requestDone(
    database.transaction(STORE, "readwrite").objectStore(STORE).put(record),
  );
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const database = await db();
  const result = await requestDone<WorkspaceRecord | undefined>(
    database.transaction(STORE, "readonly").objectStore(STORE).get(id),
  );
  return result ?? null;
}

export async function deleteWorkspace(id: string): Promise<void> {
  const database = await db();
  await requestDone(
    database.transaction(STORE, "readwrite").objectStore(STORE).delete(id),
  );
}

/** All sessions, most recently touched first. Full records — the list is
 * small by construction (WORKSPACE_CAP) and the adopt path wants the
 * record it just chose without a second read. */
export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const database = await db();
  const all = await requestDone<WorkspaceRecord[]>(
    database.transaction(STORE, "readonly").objectStore(STORE).getAll(),
  );
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Evict oldest unleased sessions beyond the cap. Returns evicted ids. */
export async function evictBeyondCap(leased: ReadonlySet<string>): Promise<string[]> {
  const all = await listWorkspaces();
  const evicted: string[] = [];
  for (const record of all.slice(WORKSPACE_CAP).reverse()) {
    if (leased.has(record.id)) continue;
    await deleteWorkspace(record.id);
    evicted.push(record.id);
  }
  return evicted;
}

// --- Leases -----------------------------------------------------------------

interface LeaseMessage {
  t: "query" | "held" | "claim" | "release";
  id?: string;
  from: string;
}

/**
 * One lease holder per browser tab. The protocol is query/response over a
 * BroadcastChannel: holders answer "held" for the workspace they own, and
 * claim/release broadcasts keep any open sessions dialog live. No storage
 * backs the leases — a crashed tab's lease simply stops answering, which
 * is exactly the semantics wanted.
 */
export class WorkspaceLeases {
  #channel: BroadcastChannel | null = null;
  #tabId = Math.random().toString(36).slice(2);
  #held: string | null = null;
  #onChange: (() => void) | null = null;

  constructor() {
    try {
      this.#channel = new BroadcastChannel(CHANNEL);
      this.#channel.addEventListener("message", event => {
        const message = event.data as LeaseMessage;
        if (!message || message.from === this.#tabId) return;
        if (message.t === "query" && this.#held) {
          this.#post({ t: "held", id: this.#held, from: this.#tabId });
        }
        if (message.t === "claim" || message.t === "release") {
          this.#onChange?.();
        }
      });
    } catch {
      // No BroadcastChannel (jsdom): every boot looks like a return, which
      // degrades to the pre-lease behavior rather than breaking.
    }
    globalThis.addEventListener("pagehide", () => this.release());
  }

  /** Fires when another tab claims or releases — for live dialog rows. */
  set onChange(handler: (() => void) | null) {
    this.#onChange = handler;
  }

  get held(): string | null {
    return this.#held;
  }

  claim(id: string): void {
    if (this.#held === id) return;
    this.release();
    this.#held = id;
    this.#post({ t: "claim", id, from: this.#tabId });
  }

  release(): void {
    if (!this.#held) return;
    this.#post({ t: "release", id: this.#held, from: this.#tabId });
    this.#held = null;
  }

  /**
   * Collect workspace ids held by OTHER tabs. Browsers may defer a hidden
   * tab's BroadcastChannel handler beyond a short animation-frame-scale
   * window, so absence needs a full second before it is treated as proof
   * that this is a returning tab. Positive replies still accumulate during
   * that window; correctness matters more than a speculative fast resume.
   */
  query(windowMs = 1_000): Promise<Set<string>> {
    return new Promise(resolve => {
      const held = new Set<string>();
      if (!this.#channel) {
        resolve(held);
        return;
      }
      const listener = (event: MessageEvent): void => {
        const message = event.data as LeaseMessage;
        if (message?.t === "held" && message.id && message.from !== this.#tabId) {
          held.add(message.id);
        }
      };
      this.#channel.addEventListener("message", listener);
      this.#post({ t: "query", from: this.#tabId });
      setTimeout(() => {
        this.#channel?.removeEventListener("message", listener);
        resolve(held);
      }, windowMs);
    });
  }

  #post(message: LeaseMessage): void {
    try {
      this.#channel?.postMessage(message);
    } catch {
      // A closing channel is not worth an error surface.
    }
  }
}

/** "2m ago" / "3h ago" / "yesterday" / "Aug 4" — recency at the grain a
 * human thinks in, never a raw timestamp. */
export function relativeTime(updatedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - updatedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
