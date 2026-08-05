import "@openbindings/obi-editor/define";
import "@openbindings/obi-explorer/define";
import "@openbindings/operation-detail/define";
import "@openbindings/operation-tabs/define";
import "@openbindings/source-detail/define";
import {
  OPERATION_INVOKER_OPERATION,
  type OperationFrameError,
  type OperationInvokerInputFrame,
  type OperationInvokerOutputFrame,
} from "@openbindings/operation-workbench";
import "@openbindings/operation-workbench/define";
import "@openbindings/schema-split/define";
import type { SchemaSplitElement } from "@openbindings/schema-split";
import {
  fetchInterface,
  OperationInvoker,
  operationSignature,
  type ContextAlternative,
  type ContextRequiredDetails,
  type ContextRequirement,
  type OBInterface,
} from "@openbindings/sdk";
import { OperationEnvironment, debounce } from "@openbindings/ui-core";
import type { OBIEditorElement } from "@openbindings/obi-editor";
import type { OBIExplorerElement } from "@openbindings/obi-explorer";
import type { OperationDetailElement } from "@openbindings/operation-detail";
import type { OperationTabsElement } from "@openbindings/operation-tabs";
import type { OperationWorkbenchElement } from "@openbindings/operation-workbench";
import type {
  SourceDetailElement,
  SourceInspection,
} from "@openbindings/source-detail";
import {
  adaptOBStartFrameBindings,
  OBStartFrameInvoker,
} from "./ob-start-frame-invoker.js";
import "./styles.css";

const explorer = requiredElement<OBIExplorerElement>("ob-obi-explorer");
const interfaceEditor =
  requiredElement<OBIEditorElement>("ob-obi-editor");
const detail = requiredElement<OperationDetailElement>("ob-operation-detail");
const sourceDetail = requiredElement<SourceDetailElement>("ob-source-detail");
const operationTabs =
  requiredElement<OperationTabsElement>("ob-operation-tabs");
const invocationSessions = requiredElement<HTMLElement>(
  "#invocation-sessions",
);
const connectionStatus = requiredElement<HTMLButtonElement>(
  "#connection-status",
);
const connectionStatusText = requiredElement<HTMLElement>(
  "#connection-status-text",
);
const bootstrapMessage = requiredElement<HTMLElement>("#bootstrap-message");
const livenessNotice = requiredElement<HTMLElement>("#liveness-notice");
// Document bar (review/100 P1/P3): identity + verbs, no URL in the header.
const documentName = requiredElement<HTMLButtonElement>("#document-name");
const documentValidity = requiredElement<HTMLElement>("#document-validity");
const documentMeta = requiredElement<HTMLElement>("#document-meta");
const renameDialog = requiredElement<HTMLDialogElement>("#rename-dialog");
const renameForm = requiredElement<HTMLFormElement>("#rename-form");
const renameName = requiredElement<HTMLInputElement>("#rename-name");
const renameVersion = requiredElement<HTMLInputElement>("#rename-version");
const renameDescription = requiredElement<HTMLTextAreaElement>(
  "#rename-description",
);
const renameCancel = requiredElement<HTMLButtonElement>("#rename-cancel");
const connectionPanel =
  requiredElement<HTMLElement>("#connection-panel");
const connectionClose =
  requiredElement<HTMLButtonElement>("#connection-close");
const tokenForm = requiredElement<HTMLFormElement>("#token-form");
const tokenInput = requiredElement<HTMLInputElement>("#session-token");
const clearSessionTokenButton = requiredElement<HTMLButtonElement>(
  "#clear-session-token",
);
const sessionStatus = requiredElement<HTMLElement>("#session-status");
const sessionBadge = requiredElement<HTMLElement>("#session-badge");
const targetContextForm = requiredElement<HTMLFormElement>(
  "#target-context-form",
);
const targetContextInput = requiredElement<HTMLTextAreaElement>(
  "#target-context",
);
const clearTargetContextButton = requiredElement<HTMLButtonElement>(
  "#clear-target-context",
);
const targetContextStatus = requiredElement<HTMLElement>(
  "#target-context-status",
);
const targetRequirements =
  requiredElement<HTMLElement>("#target-requirements");
const targetRequirementsCopy = requiredElement<HTMLElement>(
  "#target-requirements-copy",
);
const requirementForm =
  requiredElement<HTMLFormElement>("#requirement-form");
const requirementAlternative = requiredElement<HTMLSelectElement>(
  "#requirement-alternative",
);
const requirementAlternativeLabel = requiredElement<HTMLElement>(
  "#requirement-alternative-label",
);
const requirementFields =
  requiredElement<HTMLElement>("#requirement-fields");
const applyRequirementsButton = requiredElement<HTMLButtonElement>(
  "#apply-requirements",
);
const requirementBanner =
  requiredElement<HTMLElement>("#requirement-banner");
const requirementBannerTitle = requiredElement<HTMLElement>(
  "#requirement-banner-title",
);
const requirementBannerCopy = requiredElement<HTMLElement>(
  "#requirement-banner-copy",
);
const requirementBannerAction = requiredElement<HTMLButtonElement>(
  "#requirement-banner-action",
);
const themeToggle = requiredElement<HTMLButtonElement>("#theme-toggle");
const leftPanelToggle = requiredElement<HTMLButtonElement>("#toggle-left-panel");
const rightPanelToggle = requiredElement<HTMLButtonElement>(
  "#toggle-right-panel",
);
const crumbDocument = requiredElement<HTMLElement>("#crumb-document");
const crumbItem = requiredElement<HTMLElement>("#crumb-item");
const railColumn = requiredElement<HTMLElement>(".rail-column");
const workbenchGrid = requiredElement<HTMLElement>(".workbench-grid");
const railGutter = requiredElement<HTMLElement>("#rail-gutter");
const sheetGutter = requiredElement<HTMLElement>("#sheet-gutter");
const sourceGutter = requiredElement<HTMLElement>("#source-gutter");
const tabContent = requiredElement<HTMLElement>("#tab-content");
const sheetStatus = requiredElement<HTMLElement>("#sheet-status");
const sheetDot = requiredElement<HTMLElement>("#sheet-dot");
const sheetRun = requiredElement<HTMLButtonElement>("#sheet-run");
const sheetToggle = requiredElement<HTMLButtonElement>("#sheet-toggle");
const schemasStrip = requiredElement<HTMLElement>("#schemas-strip");
const schemasToggle = requiredElement<HTMLButtonElement>("#schemas-toggle");
const schemaSplit = requiredElement<SchemaSplitElement>("#schema-split");
const confirmationDialog = requiredElement<HTMLDialogElement>(
  "#confirmation-dialog",
);
const confirmationTitle = requiredElement<HTMLElement>("#confirmation-title");
const confirmationMessage = requiredElement<HTMLElement>(
  "#confirmation-message",
);
const confirmationAccept = requiredElement<HTMLButtonElement>(
  "#confirmation-accept",
);

const operationEnvironment = new OperationEnvironment();

const sessionStorageKey = "openbindings.ob-start.session-token.v1";
const layoutStorageKey = "openbindings.ob-start.layout.v1";
const themeStorageKey = "openbindings.ob-start.theme.v1";

/**
 * Tri-state theme (rev 17.9): light → dark → system → light. "System"
 * follows the OS live (the media listener below re-applies on OS change)
 * and is the default — the app respects the platform until the user pins a
 * mode. The button is icon-only and shows the CURRENT mode (sun / moon /
 * monitor); the accessible name carries the state and the next action.
 */
type ThemeMode = "light" | "dark" | "system";

const themeMedia =
  typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-color-scheme: dark)")
    : null;
let themeMode: ThemeMode = "system";

function setTheme(mode: ThemeMode): void {
  themeMode = mode;
  const dark =
    mode === "dark" || (mode === "system" && Boolean(themeMedia?.matches));
  document.documentElement.toggleAttribute("data-dark", dark);
  document.documentElement.setAttribute("data-theme-mode", mode);
  const next = nextThemeMode(mode);
  const label =
    mode === "system"
      ? `Theme: system (follows the OS) — click for ${next}`
      : `Theme: ${mode} — click for ${next}`;
  themeToggle.setAttribute("aria-label", label);
  themeToggle.title = label;
}

function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
}

themeMedia?.addEventListener("change", () => {
  if (themeMode === "system") setTheme("system");
});

function restoreTheme(): ThemeMode {
  try {
    const stored = globalThis.localStorage.getItem(themeStorageKey);
    // Pre-17.9 storage held "light"/"dark" from the two-state toggle; both
    // read as a pinned mode. Anything else means "system".
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

const tabsStoragePrefix = "openbindings.ob-start.operation-tabs.v1.";
const defaultWorkspaceLayout: WorkspaceLayout = {
  explorer: true,
  operation: true,
  source: true,
  railWidth: 352,
  sourceWidth: 420,
  execSplit: 0.5,
  schemas: true,
};
const DEFAULT_SHEET_RATIO = 0.45;
const SHEET_RATIO_MIN = 0.05;
const SHEET_RATIO_MAX = 0.95;
let sessionToken = tokenFromFragment() || restoreSessionToken();
/**
 * What is actually known about the session credential. "Ready" and
 * "Authenticated" are only ever claimed from "verified" — the result of a
 * successful authenticated request — never from token presence alone.
 */
type SessionAuthState = "none" | "checking" | "verified" | "rejected";
let sessionAuth: SessionAuthState = sessionToken ? "checking" : "none";
/**
 * Server reachability as last observed by the bootstrap probe or the
 * liveness watcher. "down" overrides every credential-derived pill state.
 */
let serverHealth: "unknown" | "up" | "down" = "unknown";
const LIVENESS_INTERVAL_MS = 15_000;
const LIVENESS_TIMEOUT_MS = 4_000;
const LIVENESS_RECHECK_DEBOUNCE_MS = 300;
/** Event-driven rechecks (focus/visibility) are spaced at least this far. */
const LIVENESS_RECHECK_MIN_GAP_MS = 5_000;
let livenessStarted = false;
let livenessDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let livenessInFlight: Promise<void> | null = null;
let lastLivenessCheckAt = 0;
let obInterface: OBInterface | null = null;
let obImplementationInterface: OBInterface | null = null;
let obInvoker: OperationInvoker | null = null;
let targetInterface: OBInterface | null = null;
let targetLabel = "";
let targetContext: Record<string, unknown> | null = null;
let pendingInterfaceDraft: OBInterface | null = null;
let targetSessionID = "";

// --- The tab model (rev 16): tabs are workspace items -----------------------
//
// A tab is a named workspace item keyed by a generated session id — NOT by
// operation key. The operation key is data inside an invocation session, so
// several sessions of the same operation (different inputs, bindings, output
// histories) coexist. Rail clicks focus the most-recently-active session for
// an operation, or open one; duplication is the explicit act that creates a
// second session. Persisted state carries schema version 2 and migrates the
// v1 operation-keyed shape once.

interface SessionRunStatus {
  state: "idle" | "running" | "done" | "failed";
  outputCount?: number;
  durationMs?: number;
  code?: string;
}

interface OperationSession {
  id: string;
  kind: "operation";
  operationKey: string;
  label: string;
  /** Bottom-sheet state, per session (rev 16): collapsed strip or open. */
  collapsed: boolean;
  /** Sheet height as a fraction of the tab content, 0.05–0.95. */
  ratio: number;
  lastActiveAt: number;
  element: OperationWorkbenchElement;
  status: SessionRunStatus;
}

/**
 * A source view (rev 16): one source's facts, verbs, and derived bindings,
 * shown through the shared ob-source-detail element. No invocation sheet, no
 * dirty state; `running` while a pull for it is in flight.
 */
interface SourceSession {
  id: string;
  kind: "source";
  sourceKey: string;
  label: string;
  lastActiveAt: number;
  status: SessionRunStatus;
}

type WorkspaceSession = OperationSession | SourceSession;

const sessionsById = new Map<string, WorkspaceSession>();
let openSessionIds: string[] = [];
let activeSessionId: string | null = null;
let sessionCounter = 0;

function generateSessionId(): string {
  sessionCounter += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `s-${random}-${sessionCounter.toString(36)}`;
}

function activeSession(): WorkspaceSession | null {
  return activeSessionId ? sessionsById.get(activeSessionId) ?? null : null;
}

function activeOperationKey(): string | null {
  const session = activeSession();
  return session?.kind === "operation" ? session.operationKey : null;
}
let contextChallenge: ContextRequiredDetails | null = null;
let retryAfterContext = false;
let preflightAttempt = 0;
/**
 * Preflight is advisory: it asks `ob` whether an operation would need
 * additional context before you run it. It is also expensive — the request
 * embeds the whole interface document, and the SDK compiles the invoker's
 * schema synchronously before the call leaves the page, which put roughly a
 * second of blocking work on every click that reached it.
 *
 * Two things fix that without changing what the user sees. The result only
 * depends on (interface, operation, binding, context), so an unchanged tuple
 * reuses the previous answer; and when a real preflight is needed it is
 * scheduled after paint, so selecting a tab is never waiting on it.
 */
let preflightKey: string | null = null;
let preflightTimer: ReturnType<typeof setTimeout> | null = null;
const preflightCache = new Map<string, ContextRequiredDetails | null>();
/**
 * The preflight's answer, demoted to an advisory (rev 17.10, dogfood: "I'm
 * just updating the description… I'm not running an operation at all. Why
 * does it think I am?"). Authoring never raises the credentials banner —
 * the strip reports "needs target credentials" quietly, and the banner
 * appears only when a RUN actually emits CONTEXT_REQUIRED.
 */
let contextAdvisory: ContextRequiredDetails | null = null;
let workspaceLayout = restoreWorkspaceLayout();
if (
  !workspaceLayout.explorer &&
  !workspaceLayout.operation &&
  !workspaceLayout.source
) {
  workspaceLayout.operation = true;
}

persistSessionToken(sessionToken);
setTheme(restoreTheme());
renderSessionState();
applyWorkspaceLayout();

// The document bar is the document's identity (review/100 P3); the rail
// repeating the same name/version directly beneath it was a dogfooded
// duplication. The explorer keeps its description and count.
explorer.hideIdentity = true;

// Panjir's master pane (rev 15.1): the rail is ONE scroll container
// (.rail-column, styles.css). The explorer flows to content height and pins
// its sticky rows — filter, then the Operations and Sources section
// headings — against that scroller. Since rev 16 the sources overview lives
// inside the explorer, so its one filter narrows both sections natively.
explorer.flowContent = true;

explorer.addEventListener("ob-operation-select", event => {
  activateOperation(event.detail.operationKey);
});

// Source overview rows (rev 16): the rail opens/focuses the source's
// workspace tab; the detail lives there, not in the rail.
explorer.addEventListener("ob-source-select", event => {
  activateSource(event.detail.sourceKey);
});

// Binding roles (rev 15): the operation detail's bindings disclosure is
// informational only — it emits no selection. The cockpit's binding-select in
// the invocation session is the single selection surface; the detail mirrors
// it through the display-only `selectedBindingKey` writes below.

// One shared exec split across sessions: any session's resize becomes the
// workspace ratio, applied everywhere and persisted with the rest of the
// layout (the element never persists; that policy lives here).
invocationSessions.addEventListener("ob-layout-change", event => {
  const layoutEvent = event as CustomEvent<{ splitRatio: number }>;
  applyExecSplit(layoutEvent.detail.splitRatio);
});

// ONE split axis (rev 17.12): resizing either strip moves both — the schema
// columns sit directly over the cockpit columns by construction.
schemaSplit.addEventListener("ob-layout-change", event => {
  const layoutEvent = event as CustomEvent<{ splitRatio: number }>;
  applyExecSplit(layoutEvent.detail.splitRatio);
});

function applyExecSplit(ratio: number): void {
  workspaceLayout.execSplit = ratio;
  for (const session of sessionsById.values()) {
    if (session.kind === "operation") {
      session.element.splitRatio = ratio;
    }
  }
  schemaSplit.splitRatio = ratio;
  persistWorkspaceLayout();
}

// The SCHEMAS strip collapse (rev 17.12): same law as the sheet — the
// header row never moves, the chevron is pinned far right.
schemasToggle.addEventListener("click", () => {
  workspaceLayout = { ...workspaceLayout, schemas: !workspaceLayout.schemas };
  applySchemasStrip();
  persistWorkspaceLayout();
});

function applySchemasStrip(): void {
  const expanded = workspaceLayout.schemas;
  schemasStrip.classList.toggle("collapsed", !expanded);
  schemasToggle.setAttribute("aria-expanded", String(expanded));
  const label = expanded
    ? "Collapse the schemas strip"
    : "Expand the schemas strip";
  schemasToggle.title = label;
  schemasToggle.setAttribute("aria-label", label);
}

// The invocation element's own compact selector emits the same intent event;
// keep the contract view in sync with it.
invocationSessions.addEventListener("ob-binding-select", event => {
  const detailEvent = event as CustomEvent<{ bindingKey: string }>;
  detail.selectedBindingKey = detailEvent.detail.bindingKey;
  bootstrapMessage.textContent = `Using binding ${detailEvent.detail.bindingKey}.`;
  schedulePreflight();
});

operationTabs.addEventListener("ob-tab-activate", event => {
  focusSession(event.detail.key);
});

operationTabs.addEventListener("ob-tab-close", event => {
  closeSession(event.detail.key);
});

operationTabs.addEventListener("ob-tab-rename", event => {
  renameSession(event.detail.key, event.detail.label);
});

operationTabs.addEventListener("ob-tab-duplicate", event => {
  duplicateSession(event.detail.key);
});

operationTabs.addEventListener("ob-tab-reorder", event => {
  const proposed = event.detail.keys;
  if (
    proposed.length !== openSessionIds.length ||
    proposed.some(id => !openSessionIds.includes(id))
  ) {
    return;
  }
  openSessionIds = [...proposed];
  renderOperationTabs();
  persistSessions();
});

operationTabs.addEventListener("ob-tabs-close-unselected", () => {
  for (const id of [...openSessionIds]) {
    if (id !== activeSessionId) removeSession(id);
  }
  openSessionIds = activeSessionId ? [activeSessionId] : [];
  renderOperationTabs();
  persistSessions();
});

operationTabs.addEventListener("ob-tabs-close-all", () => {
  for (const id of [...openSessionIds]) removeSession(id);
  openSessionIds = [];
  showNoActiveOperation();
  renderOperationTabs();
  persistSessions();
});

// --- The invocation bottom sheet (rev 16) ----------------------------------
//
// Per-session {collapsed, ratio}: three tabs can hold the same operation
// collapsed, half-open, and full-bleed simultaneously. Running from the
// collapsed strip NEVER auto-expands — the strip itself reports completion.

sheetToggle.addEventListener("click", () => {
  toggleSheetCollapsed();
});

sheetGutter.addEventListener("dblclick", () => {
  toggleSheetCollapsed();
});

sheetRun.addEventListener("click", () => {
  const session = activeSession();
  if (session?.kind === "operation") void session.element.run();
});

sheetGutter.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const session = activeSession();
  if (session?.kind !== "operation" || session.collapsed) return;
  const bounds = tabContent.getBoundingClientRect();
  startPointerResize(sheetGutter, event, move => {
    session.ratio = clamp(
      (bounds.bottom - move.clientY) / bounds.height,
      SHEET_RATIO_MIN,
      SHEET_RATIO_MAX,
    );
    applySheetLayout();
  });
});

sheetGutter.addEventListener("keydown", event => {
  const session = activeSession();
  if (session?.kind !== "operation") return;
  let ratio = session.ratio;
  if (event.key === "ArrowUp") ratio += 0.04;
  else if (event.key === "ArrowDown") ratio -= 0.04;
  else if (event.key === "Home") ratio = SHEET_RATIO_MIN;
  else if (event.key === "End") ratio = SHEET_RATIO_MAX;
  else return;
  event.preventDefault();
  session.ratio = clamp(ratio, SHEET_RATIO_MIN, SHEET_RATIO_MAX);
  applySheetLayout();
  persistSessions();
});

function toggleSheetCollapsed(): void {
  const session = activeSession();
  if (session?.kind !== "operation") return;
  session.collapsed = !session.collapsed;
  applySheetLayout();
  persistSessions();
  sheetToggle.focus();
}

function applySheetLayout(): void {
  const active = activeSession();
  // The invocation sheet belongs to operation sessions only; a source tab
  // (or no tab) shows the detail region full-height.
  const session = active?.kind === "operation" ? active : null;
  tabContent.classList.toggle("no-session", !session);
  if (!session) {
    updateSheetStatus();
    return;
  }
  // The SCHEMAS strip mirrors the active operation on the shared axis.
  schemaSplit.obi = targetInterface;
  schemaSplit.operationKey = session.operationKey;
  schemaSplit.splitRatio = workspaceLayout.execSplit;
  applySchemasStrip();
  tabContent.classList.toggle("sheet-collapsed", session.collapsed);
  tabContent.style.setProperty(
    "--sheet-size",
    `${Math.round(session.ratio * 1000) / 10}%`,
  );
  sheetGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(session.ratio * 100)),
  );
  sheetToggle.setAttribute("aria-expanded", String(!session.collapsed));
  const toggleLabel = session.collapsed
    ? "Expand the invocation sheet"
    : "Collapse the invocation sheet";
  sheetToggle.title = toggleLabel;
  sheetToggle.setAttribute("aria-label", toggleLabel);
  // The strip keeps ONE layout in both states (rev 17.2/17.3): controls
  // that jump between rows or slots cost more than they save. Run is a
  // permanent fixture — the standing "hey, try it" — and only its enabled
  // state changes (updateSheetStatus).
  updateSheetStatus();
}

/**
 * The collapsed strip's honest status line: Ready / running… /
 * "N values · duration" / "failed · CODE" with the danger treatment. Also
 * shown expanded, where it doubles as a compact run summary.
 */
function updateSheetStatus(): void {
  const session = activeSession();
  const status = session?.status ?? { state: "idle" as const };
  const capable = Boolean(obInvoker) && sessionAuth === "verified";
  // The dot is the status (fixed anchor beside the title): green ready,
  // amber running, red not. Run reports print in the flexible middle —
  // appearing text never moves the dot (left-anchored) or the chevron
  // (right-anchored).
  let dot: "ready" | "attention" | "failed" = capable ? "ready" : "failed";
  let label = capable ? "Ready" : "No invoker available";
  let text = "";
  let danger = false;
  if (status.state === "running") {
    dot = "attention";
    label = "Invocation running";
    text = "running…";
  } else if (status.state === "done") {
    const count = status.outputCount ?? 0;
    dot = capable ? "ready" : "failed";
    text = `${count} value${count === 1 ? "" : "s"} · ${formatDuration(status.durationMs ?? 0)}`;
    label = `Completed: ${text}`;
  } else if (status.state === "failed") {
    dot = "failed";
    text = `failed · ${status.code ?? "ERROR"}`;
    label = `Invocation ${text}`;
    danger = true;
  } else if (capable && contextAdvisory) {
    // Preflight advisory (rev 17.10): a quiet amber heads-up that Run will
    // ask for target credentials — never a banner while authoring.
    dot = "attention";
    text = "needs target credentials";
    label = "Run will ask for target credentials";
  }
  sheetDot.dataset.state = dot;
  sheetDot.setAttribute("aria-label", label);
  sheetDot.title = label;
  sheetStatus.textContent = text;
  sheetStatus.classList.toggle("danger", danger);
  // Run is a fixture: present in both states, disabled when it cannot act.
  sheetRun.disabled = !capable || status.state === "running";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

// Direct editing (rev 14.3, dogfood: "what would Apply do that Export
// doesn't?"): the editor IS the living document. A valid edit commits on
// idle through the same reconcile path every other document mutation uses —
// surviving sessions keep their state. An invalid document changes nothing
// and says so; Export remains the only durability act (P6).
const commitInterfaceEdit = debounce(() => {
  const draft = pendingInterfaceDraft;
  if (!draft) return;
  pendingInterfaceDraft = null;
  updateCurrentTarget(draft, targetLabel, { editorOriginated: true });
  bootstrapMessage.textContent = "";
}, 80);

interfaceEditor.addEventListener("ob-interface-edit", event => {
  if (event.detail.valid && event.detail.dirty) {
    pendingInterfaceDraft = event.detail.value;
    commitInterfaceEdit();
  } else {
    pendingInterfaceDraft = null;
    if (!event.detail.valid) {
      bootstrapMessage.textContent =
        "The document is not valid JSON yet — the workspace keeps the last valid state.";
    } else {
      bootstrapMessage.textContent = "";
    }
  }
});

// The source tab's verbs (rev 16): each is an intent the app commits through
// the contract — pullSource, inspectSource, removeSource, unbindOperation.
sourceDetail.addEventListener("ob-source-pull", event => {
  void refreshSource(event.detail.sourceKey);
});

sourceDetail.addEventListener("ob-source-inspect", event => {
  void inspectSource(event.detail.sourceKey);
});

sourceDetail.addEventListener("ob-source-remove", event => {
  void removeSource(event.detail.sourceKey);
});

// Navigation, not selection (rev 15): clicking a binding in the source tab
// activates its operation, but the invocation keeps its own binding choice —
// only the cockpit's binding-select changes it.
sourceDetail.addEventListener("ob-binding-select", event => {
  activateOperation(event.detail.operationKey);
});

sourceDetail.addEventListener("ob-binding-remove", event => {
  void removeBinding(
    event.detail.bindingKey,
    event.detail.operationKey,
    event.detail.sourceKey,
  );
});

// --- The document model (review/100) ---------------------------------------
//
// The workbench holds one living OBI document; every verb below is a contract
// operation (or a composition of them) applied to it. Acquisition is an
// action inside the Open/Add flows, never a header identity (P3). The parity
// gate (scripts/parity-gates.mjs) holds this file to that claim.

let validationAttempt = 0;

function documentKey(obi: OBInterface): string {
  return `doc:${obi.name?.trim() || "unnamed"}@${obi.version?.trim() || "0"}`;
}

function renderDocumentBar(obi: OBInterface): void {
  documentName.textContent = obi.name?.trim() || "Untitled interface";
  const operationCount = Object.keys(obi.operations).length;
  const sourceCount = Object.keys(obi.sources ?? {}).length;
  // The rail no longer repeats the document's identity, so the bar's meta
  // line carries all of it: version, spec version, then the counts.
  documentMeta.textContent = [
    obi.version?.trim() ? `v${obi.version.trim()}` : "",
    obi.openbindings ? `OBI ${obi.openbindings}` : "",
    `${operationCount} operation${operationCount === 1 ? "" : "s"}`,
    `${sourceCount} source${sourceCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Server-side validation rides its own slower debounce: the local mirror
  // must be instant (rev 17.10), but a validateInterface round trip per
  // commit would spam the server during a typing burst.
  scheduleValidityRefresh();
  renderBreadcrumb();
}

const scheduleValidityRefresh = debounce(() => {
  if (targetInterface) void refreshDocumentValidity(targetInterface);
}, 600);

/**
 * Wayfinding under the tab strip (rev 17): the document identity lives in
 * the hideable rail, so the core column names where you are —
 * "<document> › <tab label>". No kind suffix (rev 17.1): the tab's own
 * chip classifies. With no open item, the document name stands alone.
 */
function renderBreadcrumb(): void {
  const documentTitle =
    targetInterface?.name?.trim() || (targetInterface ? "Untitled interface" : "");
  const session = activeSession();
  crumbDocument.textContent = documentTitle;
  crumbItem.textContent = session?.label ?? "";
  crumbItem.parentElement
    ?.querySelector(".crumb-separator")
    ?.toggleAttribute("hidden", !session);
}

/**
 * The validity chip is the contract's own verdict: validateInterface runs
 * against the live document on every document change. Linter doctrine
 * (rev 17.9): validity is SILENT — the chip renders only when the server
 * reports problems. Unverified, checking, and valid all show nothing;
 * spell checkers don't flag correct words.
 */
async function refreshDocumentValidity(obi: OBInterface): Promise<void> {
  const attempt = ++validationAttempt;
  if (!obInterface) return;
  // Same rule as preflight (rev 13): no authenticated call before the
  // session credential is verified — a guaranteed 401 is noise, not honesty.
  if (sessionAuth !== "verified") {
    documentValidity.hidden = true;
    return;
  }
  try {
    const report = await invokeThroughOB<
      { interface: OBInterface },
      { valid: boolean; problems?: string[] }
    >(obInterface, "openbindings.ob.validateInterface", { interface: obi });
    if (attempt !== validationAttempt) return;
    if (report.valid) {
      documentValidity.hidden = true;
      documentValidity.removeAttribute("title");
    } else {
      const problems = report.problems ?? [];
      documentValidity.hidden = false;
      documentValidity.textContent = problems.length
        ? `${problems.length} problem${problems.length === 1 ? "" : "s"}`
        : "Invalid";
      documentValidity.className = "badge danger";
      documentValidity.title = problems.slice(0, 6).join("\n");
    }
  } catch {
    if (attempt !== validationAttempt) return;
    documentValidity.hidden = true;
  }
}

documentName.addEventListener("click", () => {
  if (!targetInterface) return;
  renameName.value = targetInterface.name ?? "";
  renameVersion.value = targetInterface.version ?? "";
  renameDescription.value = targetInterface.description ?? "";
  renameDialog.showModal();
});

renameCancel.addEventListener("click", () => renameDialog.close());

renameForm.addEventListener("submit", event => {
  event.preventDefault();
  void commitRename();
});

async function commitRename(): Promise<void> {
  if (!obInterface || !targetInterface) return;
  try {
    const next = await invokeThroughOB<
      Record<string, unknown>,
      OBInterface
    >(obInterface, "openbindings.ob.setMetadata", {
      interface: targetInterface,
      ...(renameName.value.trim() ? { name: renameName.value.trim() } : {}),
      ...(renameVersion.value.trim()
        ? { version: renameVersion.value.trim() }
        : {}),
      ...(renameDescription.value.trim()
        ? { description: renameDescription.value.trim() }
        : {}),
    });
    renameDialog.close();
    updateCurrentTarget(next, next.name?.trim() || targetLabel);
  } catch (error) {
    renameDialog.close();
    bootstrapMessage.textContent = callFailureText(error);
  }
}

// The pill is the interim standing entry to connection settings (rev 17):
// the Connection button died with the verb row (review/120 loss ledger).
connectionStatus.addEventListener("click", () => {
  setConnectionPanel(connectionPanel.hidden);
});

connectionClose.addEventListener("click", () => {
  setConnectionPanel(false);
  connectionStatus.focus();
});

requirementBannerAction.addEventListener("click", () => {
  setConnectionPanel(true);
  focusFirstRequirement();
});

requirementAlternative.addEventListener("change", renderRequirementFields);

requirementForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!contextChallenge) return;
  const alternative =
    contextChallenge.alternatives[Number(requirementAlternative.value)];
  if (!alternative) return;
  const resolved = contextFromRequirementFields(alternative);
  if (!resolved) return;
  targetContext = mergeContext(targetContext, resolved);
  targetContextInput.value = JSON.stringify(targetContext, null, 2);
  applyTargetContext();
  renderTargetContextState();
  hideContextChallenge();
  bootstrapMessage.textContent = retryAfterContext
    ? "Credentials applied. Retrying the operation…"
    : "Credentials applied to this target.";
  const shouldRetry = retryAfterContext;
  retryAfterContext = false;
  const invocation = activeInvocation();
  if (shouldRetry && invocation) void invocation.run();
  else schedulePreflight();
});

tokenForm.addEventListener("submit", event => {
  event.preventDefault();
  const nextToken = tokenInput.value.trim();
  if (!nextToken) {
    bootstrapMessage.textContent = "Enter a session token before applying it.";
    tokenInput.focus();
    return;
  }
  sessionToken = nextToken;
  persistSessionToken(sessionToken);
  tokenInput.value = "";
  sessionAuth = "checking";
  renderSessionState();
  applyTargetContext();
  publishOBImplementation();
  bootstrapMessage.textContent =
    "Verifying the session token against this ob start instance…";
  // The same authenticated probe as bootstrap: the submitted token is
  // reported as accepted or rejected, never assumed to work.
  void probeSessionCredential().then(result => {
    applySessionProbe(result);
    bootstrapMessage.textContent =
      result === "verified"
        ? "Workbench session connected. The credential will not be forwarded to targets."
        : result === "rejected"
          ? "ob start rejected this session token."
          : "ob start did not answer the verification request.";
  });
});

clearSessionTokenButton.addEventListener("click", () => {
  sessionToken = "";
  persistSessionToken("");
  tokenInput.value = "";
  sessionAuth = "none";
  renderSessionState();
  applyTargetContext();
  publishOBImplementation();
  hideContextChallenge();
  bootstrapMessage.textContent =
    "Workbench session disconnected. Open the authenticated URL from ob start to reconnect.";
});

targetContextForm.addEventListener("submit", event => {
  event.preventDefault();
  const raw = targetContextInput.value.trim();
  if (!raw) {
    clearTargetContext();
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("target context must be one JSON object");
    }
    targetContext = parsed as Record<string, unknown>;
    applyTargetContext();
    renderTargetContextState();
    hideContextChallenge();
    bootstrapMessage.textContent =
      "Target context applied to invocations for the selected interface.";
    schedulePreflight();
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
    targetContextInput.focus();
  }
});

clearTargetContextButton.addEventListener("click", clearTargetContext);

themeToggle.addEventListener("click", () => {
  const mode = nextThemeMode(themeMode);
  setTheme(mode);
  try {
    globalThis.localStorage.setItem(themeStorageKey, mode);
  } catch {
    // The selected theme still applies for the current page.
  }
});

// VS Code-style panel toggles (rev 17): the center tab column is the core
// space and never hides; left (rail) and right (document editor) each get
// one standing toggle with a pressed state.
leftPanelToggle.addEventListener("click", () => {
  workspaceLayout = { ...workspaceLayout, explorer: !workspaceLayout.explorer };
  applyWorkspaceLayout();
  persistWorkspaceLayout();
});

rightPanelToggle.addEventListener("click", () => {
  workspaceLayout = { ...workspaceLayout, source: !workspaceLayout.source };
  applyWorkspaceLayout();
  persistWorkspaceLayout();
});

railGutter.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const bounds = workbenchGrid.getBoundingClientRect();
  const maximum = Math.max(240, Math.min(560, bounds.width - 320));
  startPointerResize(railGutter, event, move => {
    workspaceLayout.railWidth = clamp(
      move.clientX - bounds.left,
      240,
      maximum,
    );
    applyWorkspaceLayout();
  });
});

railGutter.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  workspaceLayout.railWidth = clamp(
    workspaceLayout.railWidth + (event.key === "ArrowLeft" ? -24 : 24),
    240,
    560,
  );
  applyWorkspaceLayout();
  persistWorkspaceLayout();
});

sourceGutter.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const bounds = workbenchGrid.getBoundingClientRect();
  const minimumMainWidth = 360;
  const maximum = Math.max(
    300,
    Math.min(
      720,
      bounds.width -
        (workspaceLayout.explorer ? workspaceLayout.railWidth : 0) -
        minimumMainWidth,
    ),
  );
  startPointerResize(sourceGutter, event, move => {
    workspaceLayout.sourceWidth = clamp(
      bounds.right - move.clientX,
      300,
      maximum,
    );
    applyWorkspaceLayout();
  });
});

sourceGutter.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  workspaceLayout.sourceWidth = clamp(
    workspaceLayout.sourceWidth + (event.key === "ArrowLeft" ? 24 : -24),
    300,
    720,
  );
  applyWorkspaceLayout();
  persistWorkspaceLayout();
});

void bootstrap();

async function bootstrap(): Promise<void> {
  // The credential probe runs in parallel with public discovery so verified
  // readiness costs one overlapped round trip, not an extra sequential one.
  const probe = sessionToken ? probeSessionCredential() : null;
  try {
    const fetched = await fetchInterface(globalThis.location.origin);
    obInterface = fetched.iface;
    obImplementationInterface = adaptOBStartFrameBindings(obInterface);
    obInvoker = new OperationInvoker([
      new OBStartFrameInvoker({
        origin: globalThis.location.origin,
        token: () => sessionToken,
      }),
    ]);
    publishOBImplementation();

    // The server's own OBI is a useful zero-configuration target and proves
    // that the workbench can invoke ob through ob's published interface.
    setTarget(
      obInterface,
      "This ob start instance",
      `local:${globalThis.location.origin}`,
    );
    const preferred =
      obInterface.operations["openbindings.ob.describe"]
        ? "openbindings.ob.describe"
        : Object.keys(obInterface.operations)[0];
    if (!activeSession() && preferred) activateOperation(preferred);

    // Public discovery only proves the server answers anonymous requests.
    // The pill claims Ready when — and only when — the authenticated probe
    // came back accepted.
    if (probe) applySessionProbe(await probe);
    else renderSessionState();
    startLivenessWatcher();
  } catch (error) {
    await probe?.catch(() => undefined);
    setConnectionStatus("Connection failed", "failed");
    bootstrapMessage.textContent = errorText(error);
  }
}

// --- Session credential verification and liveness -------------------------
//
// Honesty rules for the connection pill (and the e2e contract around it):
//
// * "Ready" is set only after ONE cheap authenticated request succeeds:
//   `GET /describe` with the session bearer. The route sits behind the
//   server's auth middleware, so 200 proves the credential is accepted;
//   401/403 surfaces as "Credential rejected" and opens the connection
//   panel. Token presence alone never produces Ready or "Authenticated".
// * After bootstrap, a single liveness watcher polls the public
//   `GET /healthz` every 15 seconds (4 second timeout), plus a debounced
//   recheck on window focus / tab visibility. A hidden tab pauses the tick.
//   Failure flips the pill to "Disconnected — retrying…" and shows the
//   inline notice near the target bar; recovery re-runs the authenticated
//   probe so the pill lands back on Ready (or Credential rejected) honestly.
// * Verification hook: the e2e harness owns the live server and cannot kill
//   it mid-test, so `window.__obLiveness.checkNow()` is exported for manual
//   kill/restart verification — it forces an immediate health check without
//   waiting for the 15 second tick.

type SessionProbeResult = "verified" | "rejected" | "unreachable";

async function probeSessionCredential(): Promise<SessionProbeResult> {
  try {
    const response = await fetch(
      new URL("/describe", globalThis.location.origin),
      {
        headers: { authorization: `Bearer ${sessionToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS),
      },
    );
    if (response.ok) return "verified";
    if (response.status === 401 || response.status === 403) return "rejected";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

function applySessionProbe(result: SessionProbeResult): void {
  if (!sessionToken) {
    sessionAuth = "none";
    renderSessionState();
    return;
  }
  if (result === "unreachable") {
    serverHealth = "down";
    setLivenessNotice(livenessStarted);
    renderSessionState();
    return;
  }
  serverHealth = "up";
  setLivenessNotice(false);
  const wasVerified = sessionAuth === "verified";
  sessionAuth = result;
  renderSessionState();
  // The validity chip waits for a verified credential (it is a real
  // contract call); the first verification back-fills it for the document
  // that loaded while auth was still checking.
  if (!wasVerified && sessionAuth === "verified" && targetInterface) {
    void refreshDocumentValidity(targetInterface);
  }
  // The sheet strip's idle text depends on invoker capability — repaint it
  // whenever verification lands or lapses, or it reports a stale state.
  updateSheetStatus();
  if (result === "rejected") {
    setConnectionPanel(true);
    tokenInput.focus();
  } else {
    // Preflight is deferred until the credential is proven; run the one that
    // was skipped while verification was in flight.
    schedulePreflight();
  }
}

function startLivenessWatcher(): void {
  if (livenessStarted) return; // exactly one watcher, ever
  livenessStarted = true;
  setInterval(() => {
    // A hidden tab pauses the tick; visibilitychange below catches up.
    if (document.hidden) return;
    void runLivenessCheck();
  }, LIVENESS_INTERVAL_MS);
  globalThis.addEventListener("focus", scheduleLivenessRecheck);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleLivenessRecheck();
  });
}

function scheduleLivenessRecheck(): void {
  if (!livenessStarted || livenessDebounceTimer !== null) return;
  livenessDebounceTimer = setTimeout(() => {
    livenessDebounceTimer = null;
    if (
      serverHealth !== "down" &&
      Date.now() - lastLivenessCheckAt < LIVENESS_RECHECK_MIN_GAP_MS
    ) {
      return;
    }
    void runLivenessCheck();
  }, LIVENESS_RECHECK_DEBOUNCE_MS);
}

function runLivenessCheck(): Promise<void> {
  if (livenessInFlight) return livenessInFlight;
  livenessInFlight = (async () => {
    lastLivenessCheckAt = Date.now();
    let up = false;
    try {
      const response = await fetch(
        new URL("/healthz", globalThis.location.origin),
        { cache: "no-store", signal: AbortSignal.timeout(LIVENESS_TIMEOUT_MS) },
      );
      up = response.ok;
    } catch {
      up = false;
    }
    if (!up) {
      serverHealth = "down";
      setLivenessNotice(true);
      renderConnectionPill();
      return;
    }
    const wasDown = serverHealth === "down";
    serverHealth = "up";
    setLivenessNotice(false);
    if (wasDown && sessionToken) {
      // A restarted server may hold a different token set: re-prove the
      // credential instead of assuming the pre-outage state still holds.
      sessionAuth = "checking";
      renderSessionState();
      applySessionProbe(await probeSessionCredential());
      return;
    }
    renderSessionState();
  })().finally(() => {
    livenessInFlight = null;
  });
  return livenessInFlight;
}

function setLivenessNotice(visible: boolean): void {
  livenessNotice.hidden = !visible;
}

declare global {
  interface Window {
    __obLiveness?: { checkNow: () => Promise<void> };
  }
}

window.__obLiveness = { checkNow: () => runLivenessCheck() };

function publishOBImplementation(): void {
  operationEnvironment.replace(
    obImplementationInterface && obInvoker
      ? [
          {
            interface: obImplementationInterface,
            invoker: obInvoker,
            label: "This ob start instance",
          },
        ]
      : [],
  );
}

async function invokeThroughOB<I, O>(
  target: OBInterface,
  operation: string,
  input: I,
): Promise<O> {
  if (!obImplementationInterface || !obInvoker) {
    throw new Error("The ob start invocation capability is not ready.");
  }
  const call = obInvoker.invoke(
    obImplementationInterface,
    operationSignature<OperationInvokerInputFrame, OperationInvokerOutputFrame>(
      OPERATION_INVOKER_OPERATION,
    ),
  );
  const outputs: O[] = [];
  const terminalErrors: OperationFrameError[] = [];

  const pump = async () => {
    await call.write({
      kind: "open",
      input: {
        interface: target,
        operation,
        ...(target === obInterface && sessionToken
          ? { context: { bearerToken: sessionToken } }
          : {}),
      },
    });
    await call.write({ kind: "input", value: input });
    await call.write({ kind: "close" });
    await call.close();
  };
  const drain = async () => {
    for await (const frame of call.outputs) {
      if (frame.kind === "output") outputs.push(frame.value as O);
      if (frame.kind === "error") terminalErrors.push(frame.error);
    }
  };

  await Promise.all([pump(), drain()]);
  await call.closed;
  const terminalError = terminalErrors[0];
  if (terminalError) {
    throw new WireCallError(terminalError);
  }
  if (outputs.length !== 1) {
    throw new Error(
      `Expected one output from ${operation}, received ${outputs.length}.`,
    );
  }
  return outputs[0]!;
}

function setTarget(obi: OBInterface, label: string, sessionID: string): void {
  preflightAttempt += 1;
  preflightKey = null;
  preflightCache.clear();
  contextAdvisory = null;
  hideContextChallenge();
  for (const id of [...openSessionIds]) removeSession(id);
  openSessionIds = [];
  activeSessionId = null;
  targetSessionID = sessionID;
  targetLabel = label;
  // Context belongs to one selected target. Carrying it across a target
  // switch could disclose one service's credentials to another service.
  targetContext = null;
  targetContextInput.value = "";
  targetInterface = obi;
  explorer.obi = obi;
  explorer.selectedOperation = null;
  explorer.selectedSource = null;
  sourceDetail.obi = obi;
  sourceDetail.sourceKey = null;
  detail.obi = obi;
  detail.operationKey = null;
  detail.selectedBindingKey = null;
  interfaceEditor.value = obi;
  pendingInterfaceDraft = null;
  applyTargetContext();
  renderTargetContextState();
  renderDocumentBar(obi);
  restoreSessions();
}

/**
 * Reconcile a new document for the target already open in the workbench.
 *
 * This deliberately differs from setTarget: an edit, source refresh, or
 * binding removal is not navigation. Surviving operation sessions keep their
 * input/output history, while sessions and selections whose keys disappeared
 * are removed.
 */
function updateCurrentTarget(
  obi: OBInterface,
  label: string,
  options: { editorOriginated?: boolean } = {},
): void {
  const previous = targetInterface;
  const previousActiveId = activeSessionId;

  // Sessions whose subject vanished from the document close; the rest keep
  // their state.
  for (const [id, session] of [...sessionsById]) {
    if (session.kind === "operation" && !obi.operations[session.operationKey]) {
      removeSession(id);
    } else if (session.kind === "source" && !obi.sources?.[session.sourceKey]) {
      removeSession(id);
    }
  }
  openSessionIds = openSessionIds.filter(id => sessionsById.has(id));

  for (const session of sessionsById.values()) {
    if (session.kind !== "operation") continue;
    const invocation = session.element;
    invocation.obi = obi;
    invocation.operationKey = session.operationKey;
    invocation.operationSource = operationEnvironment;
    invocation.context = effectiveTargetContext();
    const bindingKey = invocation.bindingKey;
    const binding = bindingKey ? obi.bindings?.[bindingKey] : null;
    if (!binding || binding.operation !== session.operationKey) {
      invocation.bindingKey = preferredBindingKey(obi, session.operationKey);
    }
  }

  targetInterface = obi;
  targetLabel = label;
  explorer.obi = obi;
  sourceDetail.obi = obi;
  detail.obi = obi;
  schemaSplit.obi = obi;
  // The editor is the source of truth (rev 17.10.1): a commit that came FROM
  // the editor is only acknowledged (baseline), never written back — the
  // write-back reformatted the buffer and reset the caret to the top while
  // typing. Every other mutation (source pull, rename, merges) still renders
  // into the editor.
  if (options.editorOriginated) interfaceEditor.commitBaseline();
  else interfaceEditor.value = obi;
  pendingInterfaceDraft = null;
  renderDocumentBar(obi);

  if (previousActiveId && sessionsById.has(previousActiveId)) {
    focusSession(previousActiveId);
  } else {
    showNoActiveOperation();
    renderOperationTabs();
    persistSessions();
  }
}

/**
 * Rail navigation: focus the most-recently-active session for this
 * operation, or open one. Duplication (the tab menu) is the only act that
 * creates a second session for an operation the workspace already holds.
 */
function activateOperation(operationKey: string): void {
  if (!targetInterface?.operations[operationKey]) return;
  const existing = mostRecentSessionFor(operationKey);
  if (existing) {
    if (activeSessionId === existing.id) {
      focusTabButton(existing.id);
      return;
    }
    focusSession(existing.id);
    return;
  }
  const session = createOperationSession({ operationKey });
  focusSession(session.id);
}

function mostRecentSessionFor(operationKey: string): WorkspaceSession | null {
  let best: WorkspaceSession | null = null;
  for (const id of openSessionIds) {
    const session = sessionsById.get(id);
    if (!session || session.kind !== "operation") continue;
    if (session.operationKey !== operationKey) continue;
    if (!best || session.lastActiveAt > best.lastActiveAt) best = session;
  }
  return best;
}

/**
 * Rail navigation for sources (rev 16): focus the source's view tab, or open
 * one. A source has at most one view tab — there is nothing to fork.
 */
function activateSource(sourceKey: string): void {
  if (!targetInterface?.sources?.[sourceKey]) return;
  for (const id of openSessionIds) {
    const session = sessionsById.get(id);
    if (session?.kind === "source" && session.sourceKey === sourceKey) {
      if (activeSessionId === id) focusTabButton(id);
      else focusSession(id);
      return;
    }
  }
  const session: SourceSession = {
    id: generateSessionId(),
    kind: "source",
    sourceKey,
    label: sourceKey,
    lastActiveAt: Date.now(),
    status: { state: "idle" },
  };
  sessionsById.set(session.id, session);
  focusSession(session.id);
}

/** Makes a session the visible workspace item and syncs every mirror. */
function focusSession(id: string): void {
  const session = sessionsById.get(id);
  if (!session) return;
  if (!openSessionIds.includes(id)) openSessionIds.push(id);
  activeSessionId = id;
  session.lastActiveAt = Date.now();
  const operation = session.kind === "operation" ? session : null;
  for (const [otherId, other] of sessionsById) {
    if (other.kind === "operation") other.element.hidden = otherId !== id;
  }
  // The detail region shows the active item's kind: the operation contract,
  // or the source view. Both elements stay mounted; [hidden] flips.
  detail.hidden = !operation;
  sourceDetail.hidden = Boolean(operation);
  if (operation) {
    explorer.selectedOperation = operation.operationKey;
    explorer.selectedSource = null;
    detail.operationKey = operation.operationKey;
    detail.selectedBindingKey = operation.element.bindingKey;
    updateOperationDeepLink(operation.operationKey);
    describeBindingChoices(operation.operationKey);
  } else if (session.kind === "source") {
    explorer.selectedOperation = null;
    explorer.selectedSource = session.sourceKey;
    detail.operationKey = null;
    detail.selectedBindingKey = null;
    sourceDetail.sourceKey = session.sourceKey;
    updateOperationDeepLink(null);
    contextAdvisory = null;
    hideContextChallenge();
  }
  renderOperationTabs();
  persistSessions();
  applySheetLayout();
  if (operation) schedulePreflight();
}

interface OperationSessionSeed {
  id?: string;
  operationKey: string;
  label?: string;
  collapsed?: boolean;
  ratio?: number;
}

function createOperationSession(seed: OperationSessionSeed): OperationSession {
  const id = seed.id ?? generateSessionId();
  const operationKey = seed.operationKey;
  const invocation = document.createElement(
    "ob-operation-workbench",
  ) as OperationWorkbenchElement;
  invocation.obi = targetInterface;
  invocation.operationKey = operationKey;
  invocation.layout = "split";
  invocation.splitRatio = workspaceLayout.execSplit;
  invocation.bindingKey = preferredBindingKey(targetInterface, operationKey);
  invocation.operationSource = operationEnvironment;
  invocation.context = effectiveTargetContext();
  invocation.hidden = true;
  // The sheet strip + breadcrumb already name the invocation; the element's
  // identity header would be the third naming in two rows (rev 17.1). The
  // strip also owns the Run verb (rev 17.6), so the rail's play button would
  // be a second Run two inches away — cancel and ⌘/Ctrl+Enter stay.
  invocation.hideIdentity = true;
  invocation.hideRun = true;
  // The sheet provides the frame and the height; the element's card chrome
  // would be a second border and a band of dead space (rev 17.7).
  invocation.flush = true;
  invocation.dataset.operationKey = operationKey;
  invocation.dataset.sessionId = id;

  const session: OperationSession = {
    id,
    kind: "operation",
    operationKey,
    label: seed.label?.trim() || operationKey,
    collapsed: seed.collapsed ?? false,
    ratio: clamp(
      seed.ratio ?? DEFAULT_SHEET_RATIO,
      SHEET_RATIO_MIN,
      SHEET_RATIO_MAX,
    ),
    lastActiveAt: Date.now(),
    element: invocation,
    status: { state: "idle" },
  };

  invocation.addEventListener("ob-invocation-start", () => {
    session.status = { state: "running" };
    renderOperationTabs();
    if (activeSessionId === id) updateSheetStatus();
  });
  invocation.addEventListener("ob-invocation-complete", event => {
    session.status = {
      state: "done",
      outputCount: event.detail.outputCount,
      durationMs: event.detail.durationMs,
    };
    renderOperationTabs();
    // NO auto-expand: a run finishing while the sheet is collapsed only
    // updates the strip (and a background tab only its running dot).
    if (activeSessionId === id) updateSheetStatus();
  });
  invocation.addEventListener("ob-invocation-error", event => {
    const error = event.detail.error;
    session.status = {
      state: "failed",
      code:
        typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code)
          : "ERROR",
    };
    renderOperationTabs();
    if (activeSessionId === id) updateSheetStatus();
  });
  invocation.addEventListener("ob-context-required", event => {
    if (activeSessionId !== id) focusSession(id);
    setConnectionPanel(true);
    if (targetInterface === obInterface && !sessionToken) {
      bootstrapMessage.textContent =
        "This browser session needs the local ob start credential.";
      tokenInput.focus();
      return;
    }
    const details = parseContextRequiredDetails(event.detail.details);
    if (details) {
      retryAfterContext = true;
      showContextChallenge(details);
      bootstrapMessage.textContent = contextRequiredMessage(details);
      focusFirstRequirement();
    } else {
      bootstrapMessage.textContent = contextRequiredMessage(
        event.detail.details,
      );
      targetContextInput.focus();
    }
  });

  sessionsById.set(id, session);
  invocationSessions.append(invocation);
  return session;
}

/**
 * Forks an invocation session: same operation, copied input (text, mode,
 * view) and binding choice, fresh output history. The label counts up —
 * "placeOrder · 2", "placeOrder · 3" — from the number of sessions the
 * operation already has.
 */
function duplicateSession(id: string): void {
  const source = sessionsById.get(id);
  if (!source || source.kind !== "operation") return;
  const count = [...sessionsById.values()].filter(
    candidate =>
      candidate.kind === "operation" &&
      candidate.operationKey === source.operationKey,
  ).length;
  const session = createOperationSession({
    operationKey: source.operationKey,
    label: `${source.operationKey} · ${count + 1}`,
    collapsed: source.collapsed,
    ratio: source.ratio,
  });
  session.element.inputText = source.element.inputText;
  session.element.inputMode = source.element.inputMode;
  session.element.inputView = source.element.inputView;
  session.element.bindingKey = source.element.bindingKey;
  const index = openSessionIds.indexOf(id);
  if (index >= 0) openSessionIds.splice(index + 1, 0, session.id);
  focusSession(session.id);
}

function renameSession(id: string, label: string): void {
  const session = sessionsById.get(id);
  const next = label.trim();
  if (!session || !next || session.label === next) return;
  session.label = next;
  renderOperationTabs();
  persistSessions();
}

function closeSession(id: string): void {
  const index = openSessionIds.indexOf(id);
  if (index < 0) return;
  const wasActive = activeSessionId === id;
  removeSession(id);
  openSessionIds.splice(index, 1);

  if (wasActive) {
    // Prefer the tab that slid into this slot, else the new last tab.
    const neighbor =
      openSessionIds[Math.min(index, openSessionIds.length - 1)] ?? null;
    if (neighbor) {
      // focusSession renders and persists on its own.
      focusSession(neighbor);
      return;
    }
    showNoActiveOperation();
  }

  renderOperationTabs();
  persistSessions();
}

function removeSession(id: string): void {
  const session = sessionsById.get(id);
  if (!session) return;
  if (session.kind === "operation") {
    void session.element.cancel();
    session.element.remove();
  }
  sessionsById.delete(id);
  if (activeSessionId === id) activeSessionId = null;
}

function showNoActiveOperation(): void {
  activeSessionId = null;
  explorer.selectedOperation = null;
  explorer.selectedSource = null;
  detail.hidden = false;
  sourceDetail.hidden = true;
  detail.operationKey = null;
  detail.selectedBindingKey = null;
  hideContextChallenge();
  updateOperationDeepLink(null);
  applySheetLayout();
}

function activeInvocation(): OperationWorkbenchElement | null {
  const session = activeSession();
  return session?.kind === "operation" ? session.element : null;
}

function focusTabButton(sessionId: string): void {
  operationTabs.shadowRoot
    ?.querySelector<HTMLElement>(
      `.tab-shell[data-tab-key="${CSS.escape(sessionId)}"] .tab-button`,
    )
    ?.focus();
}

function renderOperationTabs(): void {
  operationTabs.tabs = openSessionIds.flatMap(id => {
    const session = sessionsById.get(id);
    if (!session) return [];
    return [
      {
        key: id,
        label: session.label,
        // The default kind goes unmarked (rev 17.1): only source views
        // carry the inline chip, so operation tabs stay one clean line.
        ...(session.kind === "source" ? { kind: "source" } : {}),
        running: session.status.state === "running",
      },
    ];
  });
  operationTabs.activeKey = activeSessionId;
  renderBreadcrumb();
}

// --- Session persistence: schema v2 ----------------------------------------
//
// sessionStorage survives a reload, dies with the browser tab, and two tabs
// never trample each other (review/100 P4/P6). Version 2 stores workspace
// items keyed by session id; the v1 operation-keyed shape is migrated once
// (each open operation becomes one session) and the next persist writes v2.

interface PersistedOperationSessionV2 {
  id: string;
  kind: "operation";
  operationKey: string;
  label: string;
  collapsed: boolean;
  ratio: number;
}

interface PersistedSourceSessionV2 {
  id: string;
  kind: "source";
  sourceKey: string;
  label: string;
}

type PersistedSessionV2 =
  | PersistedOperationSessionV2
  | PersistedSourceSessionV2;

function restoreSessions(): void {
  const available = targetInterface?.operations ?? {};
  let records: PersistedSessionV2[] = [];
  let restoredActiveId: string | null = null;
  try {
    const raw = globalThis.sessionStorage.getItem(operationTabsStorageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (isRecord(parsed) && parsed.version === 2 && Array.isArray(parsed.sessions)) {
      const availableSources = targetInterface?.sources ?? {};
      const seen = new Set<string>();
      for (const candidate of parsed.sessions) {
        if (!isRecord(candidate)) continue;
        if (typeof candidate.id !== "string" || !candidate.id) continue;
        if (seen.has(candidate.id)) continue;
        if (candidate.kind === "operation") {
          if (
            typeof candidate.operationKey !== "string" ||
            !available[candidate.operationKey]
          ) {
            continue;
          }
          seen.add(candidate.id);
          records.push({
            id: candidate.id,
            kind: "operation",
            operationKey: candidate.operationKey,
            label:
              typeof candidate.label === "string" && candidate.label.trim()
                ? candidate.label.trim()
                : candidate.operationKey,
            collapsed: candidate.collapsed === true,
            ratio:
              typeof candidate.ratio === "number"
                ? clamp(candidate.ratio, SHEET_RATIO_MIN, SHEET_RATIO_MAX)
                : DEFAULT_SHEET_RATIO,
          });
        } else if (candidate.kind === "source") {
          if (
            typeof candidate.sourceKey !== "string" ||
            !availableSources[candidate.sourceKey]
          ) {
            continue;
          }
          seen.add(candidate.id);
          records.push({
            id: candidate.id,
            kind: "source",
            sourceKey: candidate.sourceKey,
            label:
              typeof candidate.label === "string" && candidate.label.trim()
                ? candidate.label.trim()
                : candidate.sourceKey,
          });
        }
      }
      records = records.slice(0, 30);
      restoredActiveId =
        typeof parsed.activeId === "string" &&
        records.some(record => record.id === parsed.activeId)
          ? parsed.activeId
          : records[0]?.id ?? null;
    } else if (isRecord(parsed) && Array.isArray(parsed.keys)) {
      // One-shot v1 migration: each operation-keyed tab becomes a session.
      const keys = parsed.keys
        .filter(
          (key): key is string =>
            typeof key === "string" && Boolean(available[key]),
        )
        .filter((key, index, all) => all.indexOf(key) === index)
        .slice(0, 30);
      records = keys.map(key => ({
        id: generateSessionId(),
        kind: "operation" as const,
        operationKey: key,
        label: key,
        collapsed: false,
        ratio: DEFAULT_SHEET_RATIO,
      }));
      const activeKey =
        typeof parsed.activeKey === "string" ? parsed.activeKey : null;
      restoredActiveId =
        records.find(
          record =>
            record.kind === "operation" && record.operationKey === activeKey,
        )?.id ??
        records[0]?.id ??
        null;
    }
  } catch {
    // A malformed or unavailable local store must not block the workbench.
  }
  const deepLinked = operationFromDeepLink();
  const restoredActive = records.find(
    record => record.id === restoredActiveId,
  );
  if (
    deepLinked &&
    available[deepLinked] &&
    !(
      restoredActive?.kind === "operation" &&
      restoredActive.operationKey === deepLinked
    )
  ) {
    // The stored active session does not satisfy the deep link; prefer an
    // existing session of the linked operation, else open one.
    const match = records.find(
      record =>
        record.kind === "operation" && record.operationKey === deepLinked,
    );
    if (match) {
      restoredActiveId = match.id;
    } else {
      const record: PersistedSessionV2 = {
        id: generateSessionId(),
        kind: "operation",
        operationKey: deepLinked,
        label: deepLinked,
        collapsed: false,
        ratio: DEFAULT_SHEET_RATIO,
      };
      records.push(record);
      restoredActiveId = record.id;
    }
  }
  openSessionIds = [];
  for (const record of records) {
    if (record.kind === "operation") {
      const session = createOperationSession(record);
      openSessionIds.push(session.id);
    } else {
      const session: SourceSession = {
        id: record.id,
        kind: "source",
        sourceKey: record.sourceKey,
        label: record.label,
        lastActiveAt: Date.now(),
        status: { state: "idle" },
      };
      sessionsById.set(session.id, session);
      openSessionIds.push(session.id);
    }
  }
  if (restoredActiveId && sessionsById.has(restoredActiveId)) {
    focusSession(restoredActiveId);
  } else {
    showNoActiveOperation();
    renderOperationTabs();
  }
  if (!deepLinked) {
    // Restoring focus scrolls the rail to the selected row (the explorer's
    // deep-link contract). On a plain boot that buries the document identity
    // at the rail's top — and the breadcrumb already names where you are —
    // so the rail opens at its head. A real deep link keeps the reveal.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        railColumn.scrollTop = 0;
      });
    });
  }
}

function persistSessions(): void {
  if (!targetSessionID) return;
  try {
    globalThis.sessionStorage.setItem(
      operationTabsStorageKey(),
      JSON.stringify({
        version: 2,
        sessions: openSessionIds.flatMap<PersistedSessionV2>(id => {
          const session = sessionsById.get(id);
          if (!session) return [];
          if (session.kind === "source") {
            return [
              {
                id: session.id,
                kind: "source",
                sourceKey: session.sourceKey,
                label: session.label,
              },
            ];
          }
          return [
            {
              id: session.id,
              kind: "operation",
              operationKey: session.operationKey,
              label: session.label,
              collapsed: session.collapsed,
              ratio: session.ratio,
            },
          ];
        }),
        activeId: activeSessionId,
      }),
    );
  } catch {
    // Tabs remain functional when persistence is unavailable.
  }
}

function operationTabsStorageKey(): string {
  return `${tabsStoragePrefix}${stableHash(targetSessionID)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function operationFromDeepLink(): string | null {
  return new URL(globalThis.location.href).searchParams.get("operation");
}

function updateOperationDeepLink(operationKey: string | null): void {
  const url = new URL(globalThis.location.href);
  if (operationKey) url.searchParams.set("operation", operationKey);
  else url.searchParams.delete("operation");
  // A same-task replaceState that changes the URL while the discovery fetch is
  // finalizing tags that request net::ERR_ABORTED in devtools. Skip no-op
  // writes, and defer real ones to a macrotask (latest wins) so the write
  // never lands in the fetch's finalization task (WB reason code obs 1b).
  if (url.href === globalThis.location.href) return;
  pendingDeepLink = `${url.pathname}${url.search}${url.hash}`;
  globalThis.setTimeout(() => {
    if (pendingDeepLink === null) return;
    const target = pendingDeepLink;
    pendingDeepLink = null;
    if (globalThis.location.href !== new URL(target, globalThis.location.href).href) {
      globalThis.history.replaceState(null, "", target);
    }
  }, 0);
}

let pendingDeepLink: string | null = null;

function describeBindingChoices(operationKey: string): void {
  if (!targetInterface) return;
  const choices = Object.entries(targetInterface.bindings ?? {}).filter(
    ([, binding]) => binding.operation === operationKey,
  );
  if (choices.length > 1) {
    const preferred = preferredBindingKey(targetInterface, operationKey);
    bootstrapMessage.textContent = preferred
      ? `Running via ${preferred} — the author's preferred binding. Change it next to Run.`
      : `${choices.length} bindings implement this operation and the author expressed no preference — choose one next to Run before invoking.`;
  } else {
    bootstrapMessage.textContent = "";
  }
}

/**
 * Application binding policy, per the core schema's own terms: `preference`
 * is an author signal ("higher is more preferred; equal values express no
 * ordering; omission states no preference") and "the specification defines
 * no selection algorithm" — selection is application policy (agent-primer
 * §invocation). This application's policy: default to the author's unique
 * most-preferred non-deprecated binding; where the signal expresses no
 * unique order (tie at the top, or no preferences at all), default nothing
 * and ask the user.
 */
function preferredBindingKey(
  obi: OBInterface | null,
  operationKey: string,
): string | null {
  const ordered = orderedBindingChoices(obi, operationKey);
  return ordered.length > 0 ? ordered[0]! : null;
}

/**
 * The strictly-ordered prefix of an operation's preference ranking: sorted
 * descending, truncated at the first tie (equal values express no ordering,
 * so ordering past a tie would invent policy the author didn't state).
 * Deprecated bindings never enter the default ranking.
 */
function orderedBindingChoices(
  obi: OBInterface | null,
  operationKey: string,
): string[] {
  if (!obi) return [];
  const ranked: Array<{ key: string; preference: number }> = [];
  for (const [key, binding] of Object.entries(obi.bindings ?? {})) {
    if (binding.operation !== operationKey) continue;
    if (binding.deprecated) continue;
    if (typeof binding.preference !== "number") continue;
    ranked.push({ key, preference: binding.preference });
  }
  ranked.sort((a, b) => b.preference - a.preference);
  const ordered: string[] = [];
  for (let i = 0; i < ranked.length; i += 1) {
    if (i + 1 < ranked.length && ranked[i]!.preference === ranked[i + 1]!.preference) {
      if (i === 0) return [];
      break;
    }
    ordered.push(ranked[i]!.key);
  }
  return ordered;
}

/**
 * Ordered caller choice for every operation with a strict preference
 * ranking, merged into invocation context as `configuration.selection` —
 * the contract's channel for binding choice that also reaches nested
 * operation-graph steps (a graph's inner operations resolve against the
 * same list). A selection the user supplied in the raw context editor is
 * theirs; the derived list never overrides it.
 */
function withPreferenceSelection(
  context: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!targetInterface) return context;
  const existing = (context?.configuration ?? null) as
    | { selection?: unknown }
    | null;
  if (Array.isArray(existing?.selection) && existing.selection.length > 0) {
    return context;
  }
  const selection: string[] = [];
  for (const operationKey of Object.keys(targetInterface.operations ?? {})) {
    selection.push(...orderedBindingChoices(targetInterface, operationKey));
  }
  if (selection.length === 0) return context;
  return {
    ...(context ?? {}),
    configuration: {
      ...(typeof existing === "object" && existing !== null ? existing : {}),
      selection,
    },
  };
}

async function refreshSource(sourceKey: string): Promise<void> {
  const obi = targetInterface;
  if (!obi || !ensureWorkbenchSession()) return;
  bootstrapMessage.textContent = `Pulling source ${sourceKey} through ob…`;
  // The source's view tab reports the pull honestly: running dot on the tab,
  // disabled Pull verb while in flight (open question 1, review/110).
  setSourceSessionRunning(sourceKey, true);
  try {
    const output = await invokeThroughOB<
      { interface: OBInterface; sourceKeys: string[] },
      { interface: OBInterface; warnings?: string[] }
    >(obInterface!, "openbindings.ob.pullSource", {
      interface: obi,
      sourceKeys: [sourceKey],
    });
    applyManagedInterface(
      output.interface,
      output.warnings?.length
        ? `Source pulled in the local workspace with ${output.warnings.length} warning${output.warnings.length === 1 ? "" : "s"}. No interface file was saved.`
        : `Source ${sourceKey} pulled in the local workspace. No interface file was saved.`,
    );
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
  } finally {
    setSourceSessionRunning(sourceKey, false);
  }
}

function setSourceSessionRunning(sourceKey: string, running: boolean): void {
  for (const session of sessionsById.values()) {
    if (session.kind === "source" && session.sourceKey === sourceKey) {
      session.status = { state: running ? "running" : "idle" };
    }
  }
  if (sourceDetail.sourceKey === sourceKey) sourceDetail.pulling = running;
  renderOperationTabs();
}

/**
 * inspectSource (rev 16): asks ob what bindable targets the source offers
 * and hands the report to the source tab. Read-only — the document is
 * unchanged.
 */
async function inspectSource(sourceKey: string): Promise<void> {
  const obi = targetInterface;
  const source = obi?.sources?.[sourceKey];
  if (!obi || !source || !ensureWorkbenchSession()) return;
  bootstrapMessage.textContent = `Inspecting source ${sourceKey} through ob…`;
  try {
    const inspection = await invokeThroughOB<
      { source: typeof source },
      SourceInspection
    >(obInterface!, "openbindings.ob.inspectSource", { source });
    if (sourceDetail.sourceKey === sourceKey) {
      sourceDetail.inspection = inspection;
    }
    const count = inspection.targets?.length ?? 0;
    bootstrapMessage.textContent = `Source ${sourceKey} offers ${count} bindable target${count === 1 ? "" : "s"}.`;
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
  }
}

async function removeSource(sourceKey: string): Promise<void> {
  const obi = targetInterface;
  if (!obi || !ensureWorkbenchSession()) return;
  const bindingCount = Object.values(obi.bindings ?? {}).filter(
    binding => binding.source === sourceKey,
  ).length;
  if (
    !(await confirmChange(
      `Remove source ${sourceKey}?`,
      `The source and ${bindingCount} referencing binding${bindingCount === 1 ? "" : "s"} will be removed. Operations are preserved.`,
      "Remove source",
    ))
  ) {
    return;
  }
  try {
    const next = await invokeThroughOB<
      { interface: OBInterface; key: string },
      OBInterface
    >(obInterface!, "openbindings.ob.removeSource", {
      interface: obi,
      key: sourceKey,
    });
    applyManagedInterface(
      next,
      `Source ${sourceKey} removed from the local workspace. No interface file was saved.`,
    );
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
  }
}

async function removeBinding(
  bindingKey: string,
  operationKey: string,
  sourceKey: string,
): Promise<void> {
  const obi = targetInterface;
  if (!obi || !ensureWorkbenchSession()) return;
  if (
    !(await confirmChange(
      `Remove binding ${bindingKey}?`,
      `The ${operationKey} operation remains, but it will no longer use source ${sourceKey} through this binding.`,
      "Remove binding",
    ))
  ) {
    return;
  }
  try {
    const next = await invokeThroughOB<
      { interface: OBInterface; binding: string },
      OBInterface
    >(obInterface!, "openbindings.ob.unbindOperation", {
      interface: obi,
      binding: bindingKey,
    });
    applyManagedInterface(
      next,
      `Binding ${bindingKey} removed from the local workspace. No interface file was saved.`,
    );
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
  }
}

function applyManagedInterface(next: OBInterface, message: string): void {
  updateCurrentTarget(next, targetLabel);
  bootstrapMessage.textContent = message;
}

function ensureWorkbenchSession(): boolean {
  if (obInterface && obInvoker && sessionToken) return true;
  setConnectionPanel(true);
  bootstrapMessage.textContent =
    "Connect this browser session before asking ob to modify an interface.";
  tokenInput.focus();
  return false;
}

function confirmChange(
  title: string,
  message: string,
  acceptLabel: string,
): Promise<boolean> {
  if (confirmationDialog.open) confirmationDialog.close("cancel");
  confirmationTitle.textContent = title;
  confirmationMessage.textContent = message;
  confirmationAccept.textContent = acceptLabel;
  confirmationDialog.returnValue = "";
  confirmationDialog.showModal();
  return new Promise(resolve => {
    confirmationDialog.addEventListener(
      "close",
      () => resolve(confirmationDialog.returnValue === "confirm"),
      { once: true },
    );
  });
}

function resolveJSONPointer(document: unknown, ref: string): unknown {
  if (ref === "#") return document;
  if (!ref.startsWith("#/")) {
    throw new Error(`ref ${JSON.stringify(ref)} is not a graph JSON Pointer`);
  }
  let current = document;
  for (const rawToken of ref.slice(2).split("/")) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = canonicalArrayIndex(token);
      if (index >= current.length) {
        throw new Error(`ref ${JSON.stringify(ref)} does not resolve`);
      }
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      throw new Error(`ref ${JSON.stringify(ref)} does not resolve`);
    }
  }
  return current;
}

function replaceJSONPointer(
  document: unknown,
  ref: string,
  replacement: unknown,
): unknown {
  if (ref === "#") return structuredClone(replacement);
  if (!ref.startsWith("#/")) {
    throw new Error(`ref ${JSON.stringify(ref)} is not a graph JSON Pointer`);
  }
  const next = structuredClone(document);
  const tokens = ref
    .slice(2)
    .split("/")
    .map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = next;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[canonicalArrayIndex(token)];
    } else if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      throw new Error(`ref ${JSON.stringify(ref)} does not resolve`);
    }
  }
  const final = tokens.at(-1);
  if (final === undefined) throw new Error("graph ref has no target token");
  if (Array.isArray(current)) {
    const index = canonicalArrayIndex(final);
    if (index >= current.length) {
      throw new Error(`ref ${JSON.stringify(ref)} does not resolve`);
    }
    current[index] = structuredClone(replacement);
  } else if (isRecord(current) && Object.hasOwn(current, final)) {
    current[final] = structuredClone(replacement);
  } else {
    throw new Error(`ref ${JSON.stringify(ref)} does not resolve`);
  }
  return next;
}

function canonicalArrayIndex(token: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new Error(`JSON Pointer array token ${JSON.stringify(token)} is not canonical`);
  }
  return Number(token);
}

function applyTargetContext(): void {
  // The local session token authenticates this ob start process. It must
  // never become an arbitrary remote target's bearer token. It is supplied
  // as target context only when the selected target is the server itself.
  const context = effectiveTargetContext();
  for (const session of sessionsById.values()) {
    if (session.kind === "operation") session.element.context = context;
  }
}

function effectiveTargetContext(): Record<string, unknown> | null {
  const base =
    targetInterface === obInterface && sessionToken
      ? { ...(targetContext ?? {}), bearerToken: sessionToken }
      : targetContext;
  return withPreferenceSelection(base);
}

function clearTargetContext(): void {
  targetContext = null;
  targetContextInput.value = "";
  applyTargetContext();
  renderTargetContextState();
  hideContextChallenge();
  bootstrapMessage.textContent =
    "Target context cleared. Public operations can still be invoked.";
  schedulePreflight();
}

function renderTargetContextState(): void {
  targetContextStatus.textContent = targetContext
    ? "Context is configured for the selected target."
    : "No target credentials configured.";
}

/**
 * Schedules the advisory preflight off the interaction that requested it.
 * Coalesces bursts (a switch touches several call sites) into one run.
 */
function schedulePreflight(): void {
  if (preflightTimer !== null) return;
  preflightTimer = setTimeout(() => {
    preflightTimer = null;
    void preflightTarget();
  }, 0);
}

/** Identity of everything the preflight answer depends on. */
function currentPreflightKey(): string | null {
  const operation = activeOperationKey();
  if (!targetInterface || !operation) return null;
  const binding = activeInvocation()?.bindingKey ?? "";
  const context = effectiveTargetContext();
  return [
    targetLabel,
    operation,
    binding,
    context ? stableHash(JSON.stringify(context)) : "",
    sessionToken ? stableHash(sessionToken) : "",
  ].join("\u0000");
}

async function preflightTarget(): Promise<void> {
  const target = targetInterface;
  const operation = activeOperationKey();
  const invocation = activeInvocation();
  const binding = invocation?.bindingKey ?? null;
  // Preflight rides the local session carrier, so it can only be meaningful
  // once the credential has actually been accepted. A rejected or unverified
  // token would just spend a guaranteed-401 round trip.
  if (
    !target ||
    !operation ||
    !obInterface ||
    !obInvoker ||
    !sessionToken ||
    sessionAuth !== "verified"
  ) {
    contextAdvisory = null;
    updateSheetStatus();
    hideContextChallenge();
    return;
  }

  const key = currentPreflightKey();
  if (key !== null && key === preflightKey) return;
  if (key !== null && preflightCache.has(key)) {
    preflightKey = key;
    contextAdvisory = preflightCache.get(key) ?? null;
    updateSheetStatus();
    return;
  }

  const attempt = ++preflightAttempt;
  try {
    const context = effectiveTargetContext();
    const details = await invokeThroughOB<
      {
        interface: OBInterface;
        operation?: string;
        binding?: string;
        context?: Record<string, unknown>;
      },
      ContextRequiredDetails | null
    >(obInterface, "openbindings.ob.prepareOperation", {
      interface: target,
      ...(binding ? { binding } : { operation }),
      ...(context ? { context } : {}),
    });
    if (
      attempt !== preflightAttempt ||
      target !== targetInterface ||
      operation !== activeOperationKey() ||
      binding !== activeInvocation()?.bindingKey
    ) {
      return;
    }
    const parsed = parseContextRequiredDetails(details);
    if (key !== null) {
      preflightKey = key;
      preflightCache.set(key, parsed);
    }
    // Advisory only: the strip carries the quiet warning; the banner is
    // reserved for a real run's CONTEXT_REQUIRED.
    contextAdvisory = parsed;
    updateSheetStatus();
  } catch {
    // Preflight is advisory. Invocation remains authoritative and will emit
    // a structured CONTEXT_REQUIRED challenge when context is truly needed.
    if (attempt === preflightAttempt) {
      contextAdvisory = null;
      updateSheetStatus();
    }
  }
}

function showContextChallenge(details: ContextRequiredDetails): void {
  contextChallenge = details;
  requirementAlternative.replaceChildren();
  for (const [index, alternative] of details.alternatives.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = alternativeLabel(alternative);
    requirementAlternative.append(option);
  }
  requirementAlternative.hidden = details.alternatives.length <= 1;
  requirementAlternativeLabel.hidden = details.alternatives.length <= 1;
  targetRequirements.hidden = false;
  targetRequirementsCopy.textContent = details.target
    ? `Choose how this operation may access ${displayTarget(details.target)}.`
    : "Choose how to satisfy this operation’s runtime requirements.";
  requirementBanner.hidden = false;
  requirementBannerTitle.textContent = "Target context needed";
  requirementBannerCopy.textContent = details.target
    ? `This operation needs context for ${displayTarget(details.target)}.`
    : "This operation declares runtime requirements.";
  renderRequirementFields();
}

function hideContextChallenge(): void {
  contextChallenge = null;
  targetRequirements.hidden = true;
  requirementBanner.hidden = true;
  requirementFields.replaceChildren();
}

function renderRequirementFields(): void {
  requirementFields.replaceChildren();
  if (!contextChallenge) return;
  const alternative =
    contextChallenge.alternatives[Number(requirementAlternative.value)] ??
    contextChallenge.alternatives[0];
  if (!alternative) return;

  let unsupported = false;
  for (const [index, requirement] of alternative.requirements.entries()) {
    const fields = requirementControls(requirement, index);
    if (fields.length === 0) {
      unsupported = true;
      const notice = document.createElement("p");
      notice.className = "requirement-unsupported";
      notice.textContent =
        requirement.description?.trim() ||
        `${requirement.type} requires protocol-specific context. Use Advanced JSON context.`;
      requirementFields.append(notice);
      continue;
    }
    requirementFields.append(...fields);
  }
  applyRequirementsButton.disabled = unsupported;
  applyRequirementsButton.textContent = retryAfterContext
    ? "Apply and retry"
    : "Apply credentials";
}

function requirementControls(
  requirement: ContextRequirement,
  index: number,
): HTMLElement[] {
  const controls: HTMLElement[] = [];
  const addInput = (
    field: string,
    labelText: string,
    type: "text" | "password" = "password",
  ) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const id = `requirement-${index}-${field}`;
    label.htmlFor = id;
    label.textContent = labelText;
    input.id = id;
    input.type = type;
    input.autocomplete = "off";
    input.dataset.requirementIndex = String(index);
    input.dataset.field = field;
    input.required = true;
    label.append(input);
    controls.push(label);
  };

  switch (requirement.type) {
    case "auth.bearer":
      addInput("bearerToken", requirement.description || "Bearer token");
      break;
    case "auth.apiKey":
      addInput(
        "apiKey",
        requirement.description ||
          `${typeof requirement.name === "string" ? requirement.name : "API"} key`,
      );
      break;
    case "auth.basic":
      addInput("basic.username", "Username", "text");
      addInput("basic.password", "Password");
      break;
    case "auth.oauth2":
      addInput(
        "accessToken",
        requirement.description || "OAuth access token",
      );
      break;
  }
  return controls;
}

function contextFromRequirementFields(
  alternative: ContextAlternative,
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const [index, requirement] of alternative.requirements.entries()) {
    const value = requirementFieldValue(index, requirement);
    if (!value) return null;
    Object.assign(result, value);
  }
  return result;
}

function requirementFieldValue(
  index: number,
  requirement: ContextRequirement,
): Record<string, unknown> | null {
  const read = (field: string) =>
    requirementFields
      .querySelector<HTMLInputElement>(
        `[data-requirement-index="${index}"][data-field="${field}"]`,
      )
      ?.value.trim() ?? "";
  switch (requirement.type) {
    case "auth.bearer": {
      const token = read("bearerToken");
      return token ? { bearerToken: token } : null;
    }
    case "auth.apiKey": {
      const key = read("apiKey");
      if (!key) return null;
      return typeof requirement.name === "string" && requirement.name
        ? { apiKeys: { [requirement.name]: key } }
        : { apiKey: key };
    }
    case "auth.basic": {
      const username = read("basic.username");
      const password = read("basic.password");
      return username && password ? { basic: { username, password } } : null;
    }
    case "auth.oauth2": {
      const accessToken = read("accessToken");
      return accessToken ? { accessToken } : null;
    }
    default:
      return null;
  }
}

function mergeContext(
  current: Record<string, unknown> | null,
  addition: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(current ?? {}), ...addition };
  if (isRecord(current?.apiKeys) && isRecord(addition.apiKeys)) {
    merged.apiKeys = { ...current.apiKeys, ...addition.apiKeys };
  }
  return merged;
}

function alternativeLabel(alternative: ContextAlternative): string {
  return alternative.requirements.map(requirementLabel).join(" + ");
}

function requirementLabel(requirement: ContextRequirement): string {
  switch (requirement.type) {
    case "auth.bearer":
      return "Bearer token";
    case "auth.apiKey":
      return typeof requirement.name === "string" && requirement.name
        ? `${requirement.name} API key`
        : "API key";
    case "auth.basic":
      return "Username and password";
    case "auth.oauth2":
      return "OAuth access token";
    default:
      return requirement.description?.trim() || requirement.type;
  }
}

function focusFirstRequirement(): void {
  const field = requirementFields.querySelector<HTMLInputElement>("input");
  if (field) field.focus();
  else targetContextInput.focus();
}

function renderSessionState(): void {
  const hasToken = Boolean(sessionToken);
  if (!hasToken) {
    sessionStatus.textContent = "No local session credential is configured.";
    sessionBadge.textContent = "Not connected";
    sessionBadge.className = "badge attention";
  } else if (sessionAuth === "verified") {
    sessionStatus.textContent = "Authenticated for this browser tab.";
    sessionBadge.textContent = "Connected";
    sessionBadge.className = "badge connected";
  } else if (sessionAuth === "rejected") {
    sessionStatus.textContent =
      "Credential rejected — enter a valid session token.";
    sessionBadge.textContent = "Rejected";
    sessionBadge.className = "badge danger";
  } else {
    sessionStatus.textContent = "Verifying the session credential…";
    sessionBadge.textContent = "Checking";
    sessionBadge.className = "badge";
  }
  tokenInput.placeholder = hasToken
    ? "Replace the current token"
    : "Paste a session token";
  renderConnectionPill();
}

/**
 * Derives the header pill from what has actually been observed: server
 * reachability first, then the verified credential state. Nothing here
 * claims Ready off token presence.
 */
function renderConnectionPill(): void {
  if (serverHealth === "down") {
    setConnectionStatus(
      livenessStarted ? "Disconnected — retrying…" : "Server unreachable",
      "failed",
    );
    return;
  }
  if (!sessionToken) {
    setConnectionStatus("Session credential needed", "attention");
    return;
  }
  switch (sessionAuth) {
    case "verified":
      setConnectionStatus("Ready", "ready");
      break;
    case "rejected":
      setConnectionStatus("Credential rejected", "failed");
      break;
    default:
      setConnectionStatus(
        obInterface ? "Verifying credential…" : "Connecting…",
        "connecting",
      );
  }
}

function setConnectionPanel(open: boolean): void {
  connectionPanel.hidden = !open;
  connectionStatus.setAttribute("aria-expanded", String(open));
}

function setConnectionStatus(
  message: string,
  state: "connecting" | "ready" | "attention" | "failed",
): void {
  connectionStatusText.textContent = message;
  connectionStatus.dataset.state = state;
  // Dot-only when Ready (rev 17.1): the healthy state spends no words; any
  // other state brings the text back. The accessible name always carries
  // the message plus the pill's job as the connection-settings entry.
  connectionStatus.setAttribute(
    "aria-label",
    `${message} — connection and credentials`,
  );
  connectionStatus.title = `${message} — connection and credentials`;
}

interface WorkspaceLayout {
  explorer: boolean;
  operation: boolean;
  source: boolean;
  railWidth: number;
  sourceWidth: number;
  execSplit: number;
  /** The SCHEMAS strip's expanded state (rev 17.12). */
  schemas: boolean;
}

function applyWorkspaceLayout(): void {
  // The tab column is the core space (rev 17): it never hides, so the two
  // panel toggles carry the whole layout state.
  workspaceLayout.operation = true;
  applyPanelToggle(
    leftPanelToggle,
    workspaceLayout.explorer,
    "interface rail",
  );
  applyPanelToggle(
    rightPanelToggle,
    workspaceLayout.source,
    "interface document",
  );
  workbenchGrid.classList.toggle(
    "hide-explorer",
    !workspaceLayout.explorer,
  );
  workbenchGrid.classList.toggle("hide-source", !workspaceLayout.source);
  workbenchGrid.style.setProperty(
    "--rail-width",
    `${workspaceLayout.railWidth}px`,
  );
  workbenchGrid.style.setProperty(
    "--source-width",
    `${workspaceLayout.sourceWidth}px`,
  );
  railGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(workspaceLayout.railWidth)),
  );
  sourceGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(workspaceLayout.sourceWidth)),
  );
}

function applyPanelToggle(
  button: HTMLButtonElement,
  visible: boolean,
  name: string,
): void {
  button.setAttribute("aria-pressed", String(visible));
  const label = `${visible ? "Hide" : "Show"} the ${name}`;
  button.setAttribute("aria-label", label);
  button.title = label;
}

function restoreWorkspaceLayout(): WorkspaceLayout {
  try {
    const parsed = JSON.parse(
      globalThis.localStorage.getItem(layoutStorageKey) ?? "null",
    ) as unknown;
    if (!isRecord(parsed)) return { ...defaultWorkspaceLayout };
    return {
      explorer:
        typeof parsed.explorer === "boolean"
          ? parsed.explorer
          : defaultWorkspaceLayout.explorer,
      // Rev 16 folds the old detail/invocation checkboxes into one tab
      // column; a stored pre-16 layout maps to "visible if either was".
      operation:
        typeof parsed.operation === "boolean"
          ? parsed.operation
          : typeof parsed.detail === "boolean" ||
              typeof parsed.invocation === "boolean"
            ? parsed.detail === true || parsed.invocation === true
            : defaultWorkspaceLayout.operation,
      source:
        typeof parsed.source === "boolean"
          ? parsed.source
          : defaultWorkspaceLayout.source,
      railWidth:
        typeof parsed.railWidth === "number"
          ? clamp(parsed.railWidth, 240, 560)
          : defaultWorkspaceLayout.railWidth,
      sourceWidth:
        typeof parsed.sourceWidth === "number"
          ? clamp(parsed.sourceWidth, 300, 720)
          : defaultWorkspaceLayout.sourceWidth,
      execSplit:
        typeof parsed.execSplit === "number"
          ? clamp(parsed.execSplit, 0.2, 0.8)
          : defaultWorkspaceLayout.execSplit,
      schemas:
        typeof parsed.schemas === "boolean"
          ? parsed.schemas
          : defaultWorkspaceLayout.schemas,
    };
  } catch {
    return { ...defaultWorkspaceLayout };
  }
}

function persistWorkspaceLayout(): void {
  try {
    globalThis.localStorage.setItem(
      layoutStorageKey,
      JSON.stringify(workspaceLayout),
    );
  } catch {
    // The workspace remains usable when storage is unavailable.
  }
}

function startPointerResize(
  handle: HTMLElement,
  start: PointerEvent,
  onMove: (event: PointerEvent) => void,
): void {
  start.preventDefault();
  handle.classList.add("dragging");
  document.body.style.cursor = getComputedStyle(handle).cursor;
  document.body.style.userSelect = "none";

  const move = (event: PointerEvent) => onMove(event);
  const finish = () => {
    globalThis.removeEventListener("pointermove", move);
    globalThis.removeEventListener("pointerup", finish);
    globalThis.removeEventListener("pointercancel", finish);
    handle.classList.remove("dragging");
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    persistWorkspaceLayout();
  };
  globalThis.addEventListener("pointermove", move);
  globalThis.addEventListener("pointerup", finish, { once: true });
  globalThis.addEventListener("pointercancel", finish, { once: true });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function restoreSessionToken(): string {
  try {
    return globalThis.sessionStorage.getItem(sessionStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistSessionToken(token: string): void {
  try {
    if (token) globalThis.sessionStorage.setItem(sessionStorageKey, token);
    else globalThis.sessionStorage.removeItem(sessionStorageKey);
  } catch {
    // A privacy mode may disable storage. The in-memory session still works.
  }
}

function tokenFromFragment(): string {
  const fragment = globalThis.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const token = params.get("token")?.trim() ?? "";
  if (token) {
    globalThis.history.replaceState(
      null,
      "",
      `${globalThis.location.pathname}${globalThis.location.search}`,
    );
  }
  return token;
}

function contextRequiredMessage(details: unknown): string {
  const parsed = parseContextRequiredDetails(details);
  if (parsed) {
    const choices = parsed.alternatives.map(alternativeLabel).join(" or ");
    return choices
      ? `The selected operation needs ${choices}.`
      : "The selected operation needs target context.";
  }
  return "The selected operation needs target credentials or invocation context.";
}

function parseContextRequiredDetails(
  value: unknown,
): ContextRequiredDetails | null {
  if (
    !isRecord(value) ||
    typeof value.target !== "string" ||
    !Array.isArray(value.alternatives)
  ) {
    return null;
  }
  const alternatives: ContextAlternative[] = [];
  for (const candidate of value.alternatives) {
    if (!isRecord(candidate) || !Array.isArray(candidate.requirements)) {
      return null;
    }
    const requirements: ContextRequirement[] = [];
    for (const requirement of candidate.requirements) {
      if (!isRecord(requirement) || typeof requirement.type !== "string") {
        return null;
      }
      requirements.push(requirement as ContextRequirement);
    }
    if (requirements.length > 0) alternatives.push({ requirements });
  }
  return alternatives.length > 0
    ? { target: value.target, alternatives }
    : null;
}

function displayTarget(target: string): string {
  try {
    const parsed = new URL(target);
    return parsed.host || target;
  } catch {
    return target;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredElement<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`missing required element: ${selector}`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A terminal error frame surfaced as a throwable, keeping the whole wire
 * shape — code, category, and details — instead of flattening to a string.
 * The message stays `CODE: text` so existing string-based presentation is
 * unchanged for callers that never look deeper.
 */
class WireCallError extends Error {
  constructor(readonly wire: OperationFrameError) {
    super(`${wire.code}: ${wire.message}`);
  }
}

const CALL_FAILURE_TEXT_CAP = 800;

/**
 * The text a failed call through ob should present. HTTP-transported
 * failures carry the service's own diagnostic in details.body (the invoker
 * contract: status line in message, response body in details) — that
 * diagnostic always beats the bare status line the transport saw, which is
 * how "HTTP 502 Bad Gateway" once hid an entire resolution trail explaining
 * exactly why a target didn't resolve.
 */
function callFailureText(error: unknown): string {
  if (error instanceof WireCallError) {
    const details = error.wire.details as { body?: unknown } | null | undefined;
    const body = typeof details?.body === "string" ? details.body.trim() : "";
    if (body) {
      let message = "";
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        for (const key of ["error", "message", "detail"]) {
          if (typeof parsed[key] === "string" && parsed[key]) {
            message = parsed[key] as string;
            break;
          }
        }
      } catch {
        // Not JSON — a short prose body is still better than a status line.
        if (!body.startsWith("<")) message = body;
      }
      if (message) {
        return message.length > CALL_FAILURE_TEXT_CAP
          ? `${message.slice(0, CALL_FAILURE_TEXT_CAP)}…`
          : message;
      }
    }
  }
  return errorText(error);
}
