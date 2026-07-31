import "@openbindings/interface-sources/define";
import "@openbindings/obi-editor/define";
import "@openbindings/obi-explorer/define";
import "@openbindings/operation-detail/define";
import "@openbindings/operation-graph-editor/define";
import {
  applyOperationGraphPatches,
  isOperationGraph,
  type OperationGraph,
} from "@openbindings/operation-graph-model";
import "@openbindings/operation-graph-viewer/define";
import "@openbindings/operation-tabs/define";
import {
  OPERATION_INVOKER_OPERATION,
  type OperationInvokerInputFrame,
  type OperationInvokerOutputFrame,
} from "@openbindings/operation-workbench";
import "@openbindings/operation-workbench/define";
import {
  fetchInterface,
  OperationInvoker,
  operationSignature,
  type ContextAlternative,
  type ContextRequiredDetails,
  type ContextRequirement,
  type OBInterface,
} from "@openbindings/sdk";
import { OperationEnvironment } from "@openbindings/ui-core";
import type { InterfaceSourcesElement } from "@openbindings/interface-sources";
import type { OBIEditorElement } from "@openbindings/obi-editor";
import type { OBIExplorerElement } from "@openbindings/obi-explorer";
import type { OperationDetailElement } from "@openbindings/operation-detail";
import type {
  OperationGraphEditorElement,
  OperationGraphPatchDetail,
} from "@openbindings/operation-graph-editor";
import type { OperationGraphViewerElement } from "@openbindings/operation-graph-viewer";
import type { OperationTabsElement } from "@openbindings/operation-tabs";
import type { OperationWorkbenchElement } from "@openbindings/operation-workbench";
import {
  adaptOBStartFrameBindings,
  OBStartFrameInvoker,
} from "./ob-start-frame-invoker.js";
import "./styles.css";

interface ResolveInterfaceOutput {
  interface: OBInterface;
  synthesizedFrom?: string;
  resolvedUrl?: string;
}

interface GraphSelection {
  graph: OperationGraph;
  bindingKey: string;
  sourceKey: string;
  ref: string;
  sourceContentWasText: boolean;
}

const explorer = requiredElement<OBIExplorerElement>("ob-obi-explorer");
const interfaceEditor =
  requiredElement<OBIEditorElement>("ob-obi-editor");
const interfaceSources = requiredElement<InterfaceSourcesElement>(
  "ob-interface-sources",
);
const detail = requiredElement<OperationDetailElement>("ob-operation-detail");
const graphViewer = requiredElement<OperationGraphViewerElement>(
  "ob-operation-graph-viewer",
);
const graphEditor = requiredElement<OperationGraphEditorElement>(
  "ob-operation-graph-editor",
);
const operationTabs =
  requiredElement<OperationTabsElement>("ob-operation-tabs");
const invocationSessions = requiredElement<HTMLElement>(
  "#invocation-sessions",
);
const connectionStatus = requiredElement<HTMLElement>("#connection-status");
const connectionStatusText = requiredElement<HTMLElement>(
  "#connection-status-text",
);
const bootstrapMessage = requiredElement<HTMLElement>("#bootstrap-message");
const targetForm = requiredElement<HTMLFormElement>("#target-form");
const targetURL = requiredElement<HTMLInputElement>("#target-url");
const resolveTargetButton =
  requiredElement<HTMLButtonElement>("#resolve-target");
const useLocalTargetButton =
  requiredElement<HTMLButtonElement>("#use-local-target");
const connectionToggle =
  requiredElement<HTMLButtonElement>("#connection-toggle");
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
const currentTargetLabel = requiredElement<HTMLElement>(
  "#current-target-label",
);
const currentTargetMeta = requiredElement<HTMLElement>("#current-target-meta");
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
const layoutMenu = requiredElement<HTMLDetailsElement>(".layout-menu");
const workbenchGrid = requiredElement<HTMLElement>(".workbench-grid");
const operationColumn = requiredElement<HTMLElement>(".operation-column");
const railGutter = requiredElement<HTMLElement>("#rail-gutter");
const detailGutter = requiredElement<HTMLElement>("#detail-gutter");
const sourceGutter = requiredElement<HTMLElement>("#source-gutter");
const showExplorer =
  requiredElement<HTMLInputElement>("#show-explorer");
const showDetail = requiredElement<HTMLInputElement>("#show-detail");
const showInvocation =
  requiredElement<HTMLInputElement>("#show-invocation");
const showSource = requiredElement<HTMLInputElement>("#show-source");
const resetLayoutButton =
  requiredElement<HTMLButtonElement>("#reset-layout");
const applyInterfaceDraft = requiredElement<HTMLButtonElement>(
  "#apply-interface-draft",
);
const documentPaneButton = requiredElement<HTMLButtonElement>(
  "#show-document-pane",
);
const sourcesPaneButton = requiredElement<HTMLButtonElement>(
  "#show-sources-pane",
);
const graphPaneButton =
  requiredElement<HTMLButtonElement>("#show-graph-pane");
const documentPane = requiredElement<HTMLElement>("#document-pane");
const sourcesPane = requiredElement<HTMLElement>("#sources-pane");
const graphPane = requiredElement<HTMLElement>("#graph-pane");
const graphStatus = requiredElement<HTMLElement>("#graph-status");
const toggleGraphEdit = requiredElement<HTMLButtonElement>(
  "#toggle-graph-edit",
);
const discardGraphDraft = requiredElement<HTMLButtonElement>(
  "#discard-graph-draft",
);
const applyGraphDraft = requiredElement<HTMLButtonElement>(
  "#apply-graph-draft",
);
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
const tabsStoragePrefix = "openbindings.ob-start.operation-tabs.v1.";
const defaultWorkspaceLayout: WorkspaceLayout = {
  explorer: true,
  detail: true,
  invocation: true,
  source: true,
  railWidth: 352,
  detailRatio: 0.45,
  sourceWidth: 420,
  execSplit: 0.5,
};
let sessionToken = tokenFromFragment() || restoreSessionToken();
let obInterface: OBInterface | null = null;
let obImplementationInterface: OBInterface | null = null;
let obInvoker: OperationInvoker | null = null;
let targetInterface: OBInterface | null = null;
let targetLabel = "";
let targetContext: Record<string, unknown> | null = null;
let pendingInterfaceDraft: OBInterface | null = null;
let selectedOperationKey: string | null = null;
let targetSessionID = "";
let openOperationKeys: string[] = [];
const invocationByOperation = new Map<string, OperationWorkbenchElement>();
const runningOperations = new Set<string>();
const graphDraftByBinding = new Map<string, OperationGraph>();
let activeGraphSelection: GraphSelection | null = null;
let editingGraph = false;
let contextChallenge: ContextRequiredDetails | null = null;
let retryAfterContext = false;
let resolveAttempt = 0;
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
let workspaceLayout = restoreWorkspaceLayout();
if (
  !workspaceLayout.explorer &&
  !workspaceLayout.detail &&
  !workspaceLayout.invocation &&
  !workspaceLayout.source
) {
  workspaceLayout.invocation = true;
}

persistSessionToken(sessionToken);
setTheme(restoreTheme());
renderSessionState();
applyWorkspaceLayout();

explorer.addEventListener("ob-operation-select", event => {
  activateOperation(event.detail.operationKey);
});

detail.addEventListener("ob-binding-select", event => {
  const invocation = activeInvocation();
  if (!invocation) return;
  invocation.bindingKey = event.detail.bindingKey;
  detail.selectedBindingKey = event.detail.bindingKey;
  bootstrapMessage.textContent = `Using binding ${event.detail.bindingKey}.`;
  refreshGraphSurface();
  schedulePreflight();
});

// One shared exec split across sessions: any session's resize becomes the
// workspace ratio, applied everywhere and persisted with the rest of the
// layout (the element never persists; that policy lives here).
invocationSessions.addEventListener("ob-layout-change", event => {
  const layoutEvent = event as CustomEvent<{ splitRatio: number }>;
  workspaceLayout.execSplit = layoutEvent.detail.splitRatio;
  for (const invocation of invocationByOperation.values()) {
    invocation.splitRatio = workspaceLayout.execSplit;
  }
  persistWorkspaceLayout();
});

// The invocation element's own compact selector emits the same intent event;
// keep the contract view and graph surface in sync with it.
invocationSessions.addEventListener("ob-binding-select", event => {
  const detailEvent = event as CustomEvent<{ bindingKey: string }>;
  detail.selectedBindingKey = detailEvent.detail.bindingKey;
  bootstrapMessage.textContent = `Using binding ${detailEvent.detail.bindingKey}.`;
  refreshGraphSurface();
  schedulePreflight();
});

operationTabs.addEventListener("ob-tab-activate", event => {
  activateOperation(event.detail.key);
});

operationTabs.addEventListener("ob-tab-close", event => {
  closeOperation(event.detail.key);
});

operationTabs.addEventListener("ob-tab-reorder", event => {
  const proposed = event.detail.keys;
  if (
    proposed.length !== openOperationKeys.length ||
    proposed.some(key => !openOperationKeys.includes(key))
  ) {
    return;
  }
  openOperationKeys = [...proposed];
  renderOperationTabs();
  persistOperationTabs();
});

operationTabs.addEventListener("ob-tabs-close-unselected", () => {
  for (const key of [...openOperationKeys]) {
    if (key !== selectedOperationKey) removeOperationSession(key);
  }
  openOperationKeys = selectedOperationKey ? [selectedOperationKey] : [];
  renderOperationTabs();
  persistOperationTabs();
});

operationTabs.addEventListener("ob-tabs-close-all", () => {
  for (const key of [...openOperationKeys]) removeOperationSession(key);
  openOperationKeys = [];
  showNoActiveOperation();
  renderOperationTabs();
  persistOperationTabs();
});

interfaceEditor.addEventListener("ob-interface-edit", event => {
  pendingInterfaceDraft =
    event.detail.valid && event.detail.dirty ? event.detail.value : null;
  applyInterfaceDraft.disabled = !pendingInterfaceDraft;
  if (!event.detail.valid) {
    bootstrapMessage.textContent =
      "The interface draft is not valid yet. The active workspace is unchanged.";
  } else if (event.detail.dirty) {
    bootstrapMessage.textContent =
      "Valid local draft. Apply it to inspect and invoke this edited interface.";
  } else {
    bootstrapMessage.textContent = "";
  }
});

applyInterfaceDraft.addEventListener("click", () => {
  const draft = pendingInterfaceDraft;
  if (!draft) return;
  const previousOperation = selectedOperationKey;
  const draftIdentity = `draft:${stableHash(interfaceEditor.text)}`;
  setTarget(draft, `${draft.name?.trim() || "Interface"} · local draft`, draftIdentity);
  const preferred =
    (previousOperation && draft.operations[previousOperation]
      ? previousOperation
      : null) ?? Object.keys(draft.operations)[0];
  if (!selectedOperationKey && preferred) activateOperation(preferred);
  bootstrapMessage.textContent =
    "Local draft applied to the workspace. The source artifact has not been saved.";
});

for (const [button, pane] of [
  [documentPaneButton, "document"],
  [sourcesPaneButton, "sources"],
  [graphPaneButton, "graph"],
] as const) {
  button.addEventListener("click", () => setArtifactPane(pane));
}

interfaceSources.addEventListener("ob-source-select", event => {
  interfaceSources.selectedSourceKey = event.detail.sourceKey;
});

interfaceSources.addEventListener("ob-binding-select", event => {
  interfaceSources.selectedSourceKey = event.detail.sourceKey;
  interfaceSources.selectedBindingKey = event.detail.bindingKey;
  activateOperation(event.detail.operationKey);
  const invocation = activeInvocation();
  if (invocation) invocation.bindingKey = event.detail.bindingKey;
  detail.selectedBindingKey = event.detail.bindingKey;
  refreshGraphSurface();
  schedulePreflight();
});

interfaceSources.addEventListener("ob-source-refresh", event => {
  void refreshSource(event.detail.sourceKey);
});

interfaceSources.addEventListener("ob-source-remove", event => {
  void removeSource(event.detail.sourceKey);
});

interfaceSources.addEventListener("ob-binding-remove", event => {
  void removeBinding(
    event.detail.bindingKey,
    event.detail.operationKey,
    event.detail.sourceKey,
  );
});

graphViewer.addEventListener("ob-graph-node-select", event => {
  graphViewer.selectedNodeKey = event.detail.nodeKey;
  graphEditor.selectedNodeKey = event.detail.nodeKey;
});

graphEditor.addEventListener("ob-graph-node-select", event => {
  const nodeKey = (event as CustomEvent<{ nodeKey: string }>).detail.nodeKey;
  graphViewer.selectedNodeKey = nodeKey;
  graphEditor.selectedNodeKey = nodeKey;
});

graphEditor.addEventListener("ob-graph-patch", event => {
  void applyGraphPatchIntent(event.detail);
});

toggleGraphEdit.addEventListener("click", () => {
  if (!activeGraphSelection) return;
  editingGraph = !editingGraph;
  renderGraphMode();
});

discardGraphDraft.addEventListener("click", async () => {
  const selection = activeGraphSelection;
  if (!selection) return;
  const key = graphDraftKey(selection);
  if (
    graphDraftByBinding.has(key) &&
    !(await confirmChange(
      "Discard graph draft?",
      "The unapplied graph changes for this operation will be lost.",
      "Discard draft",
    ))
  ) {
    return;
  }
  graphDraftByBinding.delete(key);
  refreshGraphSurface();
});

applyGraphDraft.addEventListener("click", () => {
  applyActiveGraphDraft();
});

targetForm.addEventListener("submit", event => {
  event.preventDefault();
  const address = targetURL.value.trim();
  if (address) void resolveTarget(address);
});

useLocalTargetButton.addEventListener("click", () => {
  if (!obInterface) return;
  resolveAttempt += 1;
  targetURL.value = "";
  setTarget(
    obInterface,
    "This ob start instance",
    `local:${globalThis.location.origin}`,
  );
  const preferred =
    obInterface.operations["openbindings.ob.describe"]
      ? "openbindings.ob.describe"
      : Object.keys(obInterface.operations)[0];
  if (!selectedOperationKey && preferred) activateOperation(preferred);
  bootstrapMessage.textContent =
    "Using this ob start instance through its published OpenBindings interface.";
});

connectionToggle.addEventListener("click", () => {
  setConnectionPanel(connectionPanel.hidden);
});

connectionClose.addEventListener("click", () => {
  setConnectionPanel(false);
  connectionToggle.focus();
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
  renderSessionState();
  applyTargetContext();
  publishOBImplementation();
  schedulePreflight();
  bootstrapMessage.textContent = sessionToken
    ? "Workbench session connected. The credential will not be forwarded to targets."
    : "No session token is configured.";
});

clearSessionTokenButton.addEventListener("click", () => {
  sessionToken = "";
  persistSessionToken("");
  tokenInput.value = "";
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
  const dark = !document.documentElement.hasAttribute("data-dark");
  setTheme(dark);
  try {
    globalThis.localStorage.setItem(themeStorageKey, dark ? "dark" : "light");
  } catch {
    // The selected theme still applies for the current page.
  }
});

document.addEventListener("pointerdown", event => {
  if (
    layoutMenu.open &&
    event.target instanceof Node &&
    !layoutMenu.contains(event.target)
  ) {
    layoutMenu.open = false;
  }
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !layoutMenu.open) return;
  layoutMenu.open = false;
  layoutMenu.querySelector<HTMLElement>("summary")?.focus();
});

for (const control of [showExplorer, showDetail, showInvocation, showSource]) {
  control.addEventListener("change", () => {
    if (
      !showExplorer.checked &&
      !showDetail.checked &&
      !showInvocation.checked &&
      !showSource.checked
    ) {
      control.checked = true;
    }
    workspaceLayout = {
      ...workspaceLayout,
      explorer: showExplorer.checked,
      detail: showDetail.checked,
      invocation: showInvocation.checked,
      source: showSource.checked,
    };
    applyWorkspaceLayout();
    persistWorkspaceLayout();
  });
}

resetLayoutButton.addEventListener("click", () => {
  workspaceLayout = { ...defaultWorkspaceLayout };
  for (const invocation of invocationByOperation.values()) {
    invocation.splitRatio = workspaceLayout.execSplit;
  }
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

detailGutter.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const bounds = operationColumn.getBoundingClientRect();
  startPointerResize(detailGutter, event, move => {
    workspaceLayout.detailRatio = clamp(
      (move.clientY - bounds.top) / bounds.height,
      0.2,
      0.75,
    );
    applyWorkspaceLayout();
  });
});

detailGutter.addEventListener("keydown", event => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  workspaceLayout.detailRatio = clamp(
    workspaceLayout.detailRatio + (event.key === "ArrowUp" ? -0.04 : 0.04),
    0.2,
    0.75,
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
    setConnectionStatus(
      sessionToken ? "Ready" : "Session credential needed",
      sessionToken ? "ready" : "attention",
    );

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
    if (!selectedOperationKey && preferred) activateOperation(preferred);
  } catch (error) {
    setConnectionStatus("Connection failed", "failed");
    bootstrapMessage.textContent = errorText(error);
  }
}

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

async function resolveTarget(address: string): Promise<void> {
  if (!obInterface || !obInvoker) {
    bootstrapMessage.textContent = "The ob start interface is not ready.";
    return;
  }
  const attempt = ++resolveAttempt;
  resolveTargetButton.disabled = true;
  resolveTargetButton.textContent = "Connecting…";
  bootstrapMessage.textContent = `Resolving ${address} through OpenBindings…`;

  try {
    const result = await invokeThroughOB<{ address: string }, ResolveInterfaceOutput>(
      obInterface,
      "openbindings.ob.resolveInterface",
      { address },
    );
    if (attempt !== resolveAttempt) return;
    const resolvedAddress = result.resolvedUrl ?? address;
    setTarget(result.interface, resolvedAddress, resolvedAddress);
    const first = Object.keys(result.interface.operations)[0];
    if (!selectedOperationKey && first) activateOperation(first);
    bootstrapMessage.textContent = result.synthesizedFrom
      ? `Synthesized ${result.interface.name ?? "interface"} from ${result.synthesizedFrom}.`
      : `Loaded ${result.interface.name ?? "interface"}.`;
  } catch (error) {
    if (attempt !== resolveAttempt) return;
    bootstrapMessage.textContent = errorText(error);
  } finally {
    if (attempt === resolveAttempt) {
      resolveTargetButton.disabled = false;
      resolveTargetButton.textContent = "Connect";
    }
  }
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
  const terminalErrors: Array<{ code: string; message: string }> = [];

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
    throw new Error(`${terminalError.code}: ${terminalError.message}`);
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
  hideContextChallenge();
  for (const key of [...openOperationKeys]) removeOperationSession(key);
  openOperationKeys = [];
  selectedOperationKey = null;
  targetSessionID = sessionID;
  targetLabel = label;
  graphDraftByBinding.clear();
  activeGraphSelection = null;
  editingGraph = false;
  // Context belongs to one selected target. Carrying it across a target
  // switch could disclose one service's credentials to another service.
  targetContext = null;
  targetContextInput.value = "";
  targetInterface = obi;
  explorer.obi = obi;
  explorer.selectedOperation = null;
  interfaceSources.obi = obi;
  interfaceSources.selectedSourceKey =
    Object.keys(obi.sources ?? {})[0] ?? null;
  interfaceSources.selectedBindingKey = null;
  detail.obi = obi;
  detail.operationKey = null;
  detail.selectedBindingKey = null;
  interfaceEditor.value = obi;
  pendingInterfaceDraft = null;
  applyInterfaceDraft.disabled = true;
  applyTargetContext();
  renderTargetContextState();
  currentTargetLabel.textContent = label;
  const operationCount = Object.keys(obi.operations).length;
  currentTargetMeta.textContent = `${operationCount} operation${
    operationCount === 1 ? "" : "s"
  }`;
  restoreOperationTabs();
  refreshGraphSurface();
}

/**
 * Reconcile a new document for the target already open in the workbench.
 *
 * This deliberately differs from setTarget: an edit, source refresh, or
 * binding removal is not navigation. Surviving operation sessions keep their
 * input/output history, while sessions and selections whose keys disappeared
 * are removed.
 */
function updateCurrentTarget(obi: OBInterface, label: string): void {
  const previous = targetInterface;
  const previousOperation = selectedOperationKey;
  const previousSource = interfaceSources.selectedSourceKey;
  const previousBinding = interfaceSources.selectedBindingKey;

  for (const key of [...invocationByOperation.keys()]) {
    if (!obi.operations[key]) removeOperationSession(key);
  }
  openOperationKeys = openOperationKeys.filter(key => Boolean(obi.operations[key]));

  for (const [key, invocation] of invocationByOperation) {
    invocation.obi = obi;
    invocation.operationKey = key;
    invocation.operationSource = operationEnvironment;
    invocation.context = effectiveTargetContext();
    const bindingKey = invocation.bindingKey;
    const binding = bindingKey ? obi.bindings?.[bindingKey] : null;
    if (!binding || binding.operation !== key) {
      invocation.bindingKey = preferredBindingKey(obi, key);
    }
  }

  for (const key of [...graphDraftByBinding.keys()]) {
    const bindingKey = key.split("\u0000", 1)[0]!;
    const beforeBinding = previous?.bindings?.[bindingKey];
    const afterBinding = obi.bindings?.[bindingKey];
    const beforeSource = beforeBinding
      ? previous?.sources?.[beforeBinding.source]
      : null;
    const afterSource = afterBinding ? obi.sources?.[afterBinding.source] : null;
    if (
      !beforeBinding ||
      !afterBinding ||
      beforeBinding.operation !== afterBinding.operation ||
      beforeBinding.source !== afterBinding.source ||
      beforeBinding.ref !== afterBinding.ref ||
      JSON.stringify(beforeSource?.content) !== JSON.stringify(afterSource?.content)
    ) {
      graphDraftByBinding.delete(key);
    }
  }

  targetInterface = obi;
  targetLabel = label;
  explorer.obi = obi;
  interfaceSources.obi = obi;
  interfaceSources.selectedSourceKey =
    (previousSource && obi.sources?.[previousSource] ? previousSource : null) ??
    Object.keys(obi.sources ?? {})[0] ??
    null;
  interfaceSources.selectedBindingKey =
    previousBinding && obi.bindings?.[previousBinding] ? previousBinding : null;
  detail.obi = obi;
  interfaceEditor.value = obi;
  pendingInterfaceDraft = null;
  applyInterfaceDraft.disabled = true;
  currentTargetLabel.textContent = label;
  const operationCount = Object.keys(obi.operations).length;
  currentTargetMeta.textContent = `${operationCount} operation${
    operationCount === 1 ? "" : "s"
  }`;

  if (previousOperation && obi.operations[previousOperation]) {
    activateOperation(previousOperation);
  } else {
    showNoActiveOperation();
    renderOperationTabs();
    persistOperationTabs();
  }
  refreshGraphSurface();
}

function activateOperation(operationKey: string): void {
  if (!targetInterface?.operations[operationKey]) return;

  // Selecting an operation that is already open focuses its existing tab and
  // its existing session — input text, output, binding choice and any running
  // invocation are all keyed by operation, so a second tab for the same
  // operation would alias the same state rather than give you a second draft.
  // Re-running the activation path here also meant a redundant preflight
  // round trip on every click, which is most of why switching felt slow.
  if (selectedOperationKey === operationKey && openOperationKeys.includes(operationKey)) {
    focusOperationTab(operationKey);
    return;
  }


  const invocation = ensureOperationSession(operationKey);
  if (!openOperationKeys.includes(operationKey)) {
    openOperationKeys.push(operationKey);
  }
  for (const [key, candidate] of invocationByOperation) {
    candidate.hidden = key !== operationKey;
  }
  explorer.selectedOperation = operationKey;
  detail.operationKey = operationKey;
  detail.selectedBindingKey = invocation.bindingKey;
  selectedOperationKey = operationKey;
  renderOperationTabs();
  persistOperationTabs();
  updateOperationDeepLink(operationKey);
  describeBindingChoices(operationKey);
  refreshGraphSurface();
  schedulePreflight();
}

function ensureOperationSession(
  operationKey: string,
): OperationWorkbenchElement {
  const existing = invocationByOperation.get(operationKey);
  if (existing) return existing;
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
  invocation.dataset.operationKey = operationKey;
  invocation.addEventListener("ob-invocation-start", () => {
    runningOperations.add(operationKey);
    renderOperationTabs();
  });
  const markSettled = () => {
    runningOperations.delete(operationKey);
    renderOperationTabs();
  };
  invocation.addEventListener("ob-invocation-complete", markSettled);
  invocation.addEventListener("ob-invocation-error", markSettled);
  invocation.addEventListener("ob-context-required", event => {
    if (operationKey !== selectedOperationKey) activateOperation(operationKey);
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
  invocationByOperation.set(operationKey, invocation);
  invocationSessions.append(invocation);
  return invocation;
}

function closeOperation(operationKey: string): void {
  const index = openOperationKeys.indexOf(operationKey);
  if (index < 0) return;
  const wasActive = selectedOperationKey === operationKey;
  removeOperationSession(operationKey);
  openOperationKeys.splice(index, 1);

  if (wasActive) {
    // Prefer the tab that slid into this slot, else the new last tab.
    const neighbor =
      openOperationKeys[Math.min(index, openOperationKeys.length - 1)] ?? null;
    if (neighbor) {
      // activateOperation renders and persists on its own.
      activateOperation(neighbor);
      return;
    }
    showNoActiveOperation();
  }

  // Closing the final tab took the `wasActive` branch with no neighbor, which
  // used to fall out of the function without redrawing the strip or updating
  // storage — so the last tab appeared to be unclosable, and reloading
  // brought it back.
  renderOperationTabs();
  persistOperationTabs();
}

function removeOperationSession(operationKey: string): void {
  const invocation = invocationByOperation.get(operationKey);
  if (!invocation) return;
  void invocation.cancel();
  invocation.remove();
  invocationByOperation.delete(operationKey);
  runningOperations.delete(operationKey);
}

function showNoActiveOperation(): void {
  selectedOperationKey = null;
  explorer.selectedOperation = null;
  detail.operationKey = null;
  detail.selectedBindingKey = null;
  hideContextChallenge();
  updateOperationDeepLink(null);
  refreshGraphSurface();
}

function activeInvocation(): OperationWorkbenchElement | null {
  return selectedOperationKey
    ? invocationByOperation.get(selectedOperationKey) ?? null
    : null;
}

function focusOperationTab(operationKey: string): void {
  operationTabs.shadowRoot
    ?.querySelector<HTMLElement>(
      `.tab-shell[data-tab-key="${CSS.escape(operationKey)}"] .tab-button`,
    )
    ?.focus();
}

function renderOperationTabs(): void {
  operationTabs.tabs = openOperationKeys.map(key => ({
    key,
    running: runningOperations.has(key),
  }));
  operationTabs.activeKey = selectedOperationKey;
}

function restoreOperationTabs(): void {
  const available = targetInterface?.operations ?? {};
  let restoredKeys: string[] = [];
  let restoredActive: string | null = null;
  try {
    const raw = globalThis.localStorage.getItem(operationTabsStorageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (isRecord(parsed) && Array.isArray(parsed.keys)) {
      restoredKeys = parsed.keys
        .filter(
          (key): key is string =>
            typeof key === "string" && Boolean(available[key]),
        )
        .filter((key, index, keys) => keys.indexOf(key) === index)
        .slice(0, 30);
      restoredActive =
        typeof parsed.activeKey === "string" &&
        restoredKeys.includes(parsed.activeKey)
          ? parsed.activeKey
          : restoredKeys[0] ?? null;
    }
  } catch {
    // A malformed or unavailable local store must not block the workbench.
  }
  const deepLinked = operationFromDeepLink();
  if (deepLinked && available[deepLinked]) {
    if (!restoredKeys.includes(deepLinked)) restoredKeys.push(deepLinked);
    restoredActive = deepLinked;
  }
  openOperationKeys = restoredKeys;
  for (const key of restoredKeys) ensureOperationSession(key);
  if (restoredActive) activateOperation(restoredActive);
  else {
    showNoActiveOperation();
    renderOperationTabs();
  }
}

function persistOperationTabs(): void {
  if (!targetSessionID) return;
  try {
    globalThis.localStorage.setItem(
      operationTabsStorageKey(),
      JSON.stringify({
        keys: openOperationKeys,
        activeKey: selectedOperationKey,
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

function setArtifactPane(pane: "document" | "sources" | "graph"): void {
  const entries = [
    [documentPaneButton, documentPane, "document"],
    [sourcesPaneButton, sourcesPane, "sources"],
    [graphPaneButton, graphPane, "graph"],
  ] as const;
  for (const [button, panel, name] of entries) {
    const active = pane === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
  if (pane === "graph") refreshGraphSurface();
}

function refreshGraphSurface(): void {
  const resolved = resolveActiveGraph();
  activeGraphSelection = resolved.selection;
  const selection = resolved.selection;
  const draft = selection
    ? graphDraftByBinding.get(graphDraftKey(selection)) ?? null
    : null;
  const graph = draft ?? selection?.graph ?? null;
  graphViewer.graph = graph;
  graphEditor.graph = graph;
  graphEditor.operationKeys = Object.keys(targetInterface?.operations ?? {});
  graphViewer.selectedNodeKey = null;
  graphEditor.selectedNodeKey = null;
  graphStatus.textContent = draft
    ? `${selection?.bindingKey ?? "Graph"} · unapplied local changes`
    : resolved.message;
  toggleGraphEdit.disabled = !selection;
  if (!selection) editingGraph = false;
  renderGraphMode();
}

function renderGraphMode(): void {
  const selection = activeGraphSelection;
  const dirty = Boolean(
    selection && graphDraftByBinding.has(graphDraftKey(selection)),
  );
  graphViewer.hidden = editingGraph;
  graphEditor.hidden = !editingGraph;
  toggleGraphEdit.textContent = editingGraph ? "View graph" : "Edit graph";
  discardGraphDraft.hidden = !dirty;
  applyGraphDraft.hidden = !dirty;
}

function resolveActiveGraph(): {
  selection: GraphSelection | null;
  message: string;
} {
  const obi = targetInterface;
  const operationKey = selectedOperationKey;
  if (!obi || !operationKey) {
    return {
      selection: null,
      message: "Select an operation with an embedded operation-graph binding.",
    };
  }
  const activeBindingKey = activeInvocation()?.bindingKey ?? null;
  if (activeBindingKey) {
    const activeBinding = obi.bindings?.[activeBindingKey];
    const activeSource = activeBinding
      ? obi.sources?.[activeBinding.source]
      : null;
    if (
      !activeBinding ||
      !activeSource ||
      activeSource.bindingSpec !== "openbindings.operation-graph@1"
    ) {
      return {
        selection: null,
        message: `Selected binding ${activeBindingKey} is not an operation graph.`,
      };
    }
    return resolveGraphBinding(activeBindingKey, activeBinding);
  }
  const candidates = Object.entries(obi.bindings ?? {}).filter(
    ([, binding]) =>
      binding.operation === operationKey &&
      obi.sources?.[binding.source]?.bindingSpec ===
        "openbindings.operation-graph@1",
  );
  if (candidates.length === 0) {
    return {
      selection: null,
      message: "This operation has no operation-graph binding.",
    };
  }
  if (candidates.length > 1) {
    return {
      selection: null,
      message:
        "Several operation-graph bindings are available. Choose one in the operation detail.",
    };
  }
  return resolveGraphBinding(candidates[0]![0], candidates[0]![1]);
}

function resolveGraphBinding(
  bindingKey: string,
  binding: NonNullable<OBInterface["bindings"]>[string],
): { selection: GraphSelection | null; message: string } {
  const source = targetInterface?.sources?.[binding.source];
  if (!source) {
    return {
      selection: null,
      message: `Binding ${bindingKey} references a missing source.`,
    };
  }
  if (!binding.ref) {
    return {
      selection: null,
      message: `Binding ${bindingKey} has no graph JSON Pointer.`,
    };
  }
  if (source.content === undefined) {
    return {
      selection: null,
      message:
        "The graph source is location-only. Refresh it through the Sources pane to embed an inspectable artifact.",
    };
  }
  try {
    const sourceContentWasText = typeof source.content === "string";
    const document = sourceContentWasText
      ? (JSON.parse(source.content as string) as unknown)
      : source.content;
    const value = resolveJSONPointer(document, binding.ref);
    if (!isOperationGraph(value)) {
      return {
        selection: null,
        message: `Binding ${bindingKey} does not resolve to a structurally readable graph.`,
      };
    }
    return {
      selection: {
        graph: value,
        bindingKey,
        sourceKey: binding.source,
        ref: binding.ref,
        sourceContentWasText,
      },
      message: `${bindingKey} · ${binding.ref}`,
    };
  } catch (error) {
    return {
      selection: null,
      message: `Graph unavailable: ${errorText(error)}`,
    };
  }
}

function graphDraftKey(selection: GraphSelection): string {
  return `${selection.bindingKey}\u0000${selection.ref}`;
}

async function applyGraphPatchIntent(
  detail: OperationGraphPatchDetail,
): Promise<void> {
  const selection = activeGraphSelection;
  if (!selection) return;
  if (
    detail.requiresConfirmation &&
    !(await confirmChange(
      "Confirm graph change?",
      detail.reason,
      "Apply change",
    ))
  ) {
    return;
  }
  const key = graphDraftKey(selection);
  const current = graphDraftByBinding.get(key) ?? selection.graph;
  try {
    const next = applyOperationGraphPatches(current, detail.patches);
    graphDraftByBinding.set(key, next);
    graphViewer.graph = next;
    graphEditor.graph = next;
    graphStatus.textContent = `${selection.bindingKey} · unapplied local changes`;
    renderGraphMode();
  } catch (error) {
    graphStatus.textContent = `Graph change refused: ${errorText(error)}`;
  }
}

function applyActiveGraphDraft(): void {
  const selection = activeGraphSelection;
  const obi = targetInterface;
  if (!selection || !obi) return;
  const draft = graphDraftByBinding.get(graphDraftKey(selection));
  if (!draft) return;
  try {
    const next = structuredClone(obi);
    const source = next.sources?.[selection.sourceKey];
    if (!source || source.content === undefined) {
      throw new Error("the selected graph source is no longer embedded");
    }
    const document =
      typeof source.content === "string"
        ? (JSON.parse(source.content) as unknown)
        : source.content;
    const replaced = replaceJSONPointer(document, selection.ref, draft);
    source.content = selection.sourceContentWasText
      ? `${JSON.stringify(replaced, null, 2)}\n`
      : replaced;
    const label = `${targetLabel.replace(/ · local draft$/, "")} · local draft`;
    updateCurrentTarget(next, label);
    setArtifactPane("graph");
    bootstrapMessage.textContent =
      "Graph draft applied to the local interface document. No source file was saved.";
  } catch (error) {
    graphStatus.textContent = `Could not apply graph draft: ${errorText(error)}`;
  }
}

async function refreshSource(sourceKey: string): Promise<void> {
  const obi = targetInterface;
  if (!obi || !ensureWorkbenchSession()) return;
  bootstrapMessage.textContent = `Refreshing source ${sourceKey} through ob…`;
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
        ? `Source refreshed in the local workspace with ${output.warnings.length} warning${output.warnings.length === 1 ? "" : "s"}. No interface file was saved.`
        : `Source ${sourceKey} refreshed in the local workspace. No interface file was saved.`,
    );
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
  for (const invocation of invocationByOperation.values()) {
    invocation.context = context;
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
  const operation = selectedOperationKey;
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
  const operation = selectedOperationKey;
  const invocation = activeInvocation();
  const binding = invocation?.bindingKey ?? null;
  if (!target || !operation || !obInterface || !obInvoker || !sessionToken) {
    hideContextChallenge();
    return;
  }

  const key = currentPreflightKey();
  if (key !== null && key === preflightKey) return;
  if (key !== null && preflightCache.has(key)) {
    preflightKey = key;
    const cached = preflightCache.get(key) ?? null;
    if (cached) showContextChallenge(cached);
    else hideContextChallenge();
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
      operation !== selectedOperationKey ||
      binding !== activeInvocation()?.bindingKey
    ) {
      return;
    }
    const parsed = parseContextRequiredDetails(details);
    if (key !== null) {
      preflightKey = key;
      preflightCache.set(key, parsed);
    }
    if (parsed) {
      retryAfterContext = false;
      showContextChallenge(parsed);
    } else {
      hideContextChallenge();
    }
  } catch {
    // Preflight is advisory. Invocation remains authoritative and will emit
    // a structured CONTEXT_REQUIRED challenge when context is truly needed.
    if (attempt === preflightAttempt) hideContextChallenge();
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
  const connected = Boolean(sessionToken);
  sessionStatus.textContent = connected
    ? "Authenticated for this browser tab."
    : "No local session credential is configured.";
  sessionBadge.textContent = connected ? "Connected" : "Not connected";
  sessionBadge.className = `badge ${connected ? "connected" : "attention"}`;
  tokenInput.placeholder = connected
    ? "Replace the current token"
    : "Paste a session token";
  setConnectionStatus(
    connected
      ? obInterface
        ? "Ready"
        : "Connecting…"
      : "Session credential needed",
    connected ? (obInterface ? "ready" : "connecting") : "attention",
  );
}

function setConnectionPanel(open: boolean): void {
  connectionPanel.hidden = !open;
  connectionToggle.setAttribute("aria-expanded", String(open));
}

function setConnectionStatus(
  message: string,
  state: "connecting" | "ready" | "attention" | "failed",
): void {
  connectionStatusText.textContent = message;
  connectionStatus.dataset.state = state;
}

function setTheme(dark: boolean): void {
  document.documentElement.toggleAttribute("data-dark", dark);
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.textContent = dark ? "Light theme" : "Dark theme";
}

function restoreTheme(): boolean {
  try {
    return globalThis.localStorage.getItem(themeStorageKey) === "dark";
  } catch {
    return false;
  }
}

interface WorkspaceLayout {
  explorer: boolean;
  detail: boolean;
  invocation: boolean;
  source: boolean;
  railWidth: number;
  detailRatio: number;
  sourceWidth: number;
  execSplit: number;
}

function applyWorkspaceLayout(): void {
  showExplorer.checked = workspaceLayout.explorer;
  showDetail.checked = workspaceLayout.detail;
  showInvocation.checked = workspaceLayout.invocation;
  showSource.checked = workspaceLayout.source;

  const railOnly =
    workspaceLayout.explorer &&
    !workspaceLayout.detail &&
    !workspaceLayout.invocation &&
    !workspaceLayout.source;
  const operationVisible =
    workspaceLayout.detail || workspaceLayout.invocation;
  workbenchGrid.classList.toggle(
    "hide-explorer",
    !workspaceLayout.explorer,
  );
  workbenchGrid.classList.toggle("rail-only", railOnly);
  workbenchGrid.classList.toggle("hide-source", !workspaceLayout.source);
  workbenchGrid.classList.toggle("hide-operation", !operationVisible);
  operationColumn.classList.toggle("hide-detail", !workspaceLayout.detail);
  operationColumn.classList.toggle(
    "hide-invocation",
    !workspaceLayout.invocation,
  );
  workbenchGrid.style.setProperty(
    "--rail-width",
    `${workspaceLayout.railWidth}px`,
  );
  operationColumn.style.setProperty(
    "--detail-size",
    `${workspaceLayout.detailRatio * 100}%`,
  );
  workbenchGrid.style.setProperty(
    "--source-width",
    `${workspaceLayout.sourceWidth}px`,
  );
  railGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(workspaceLayout.railWidth)),
  );
  detailGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(workspaceLayout.detailRatio * 100)),
  );
  detailGutter.setAttribute(
    "aria-valuetext",
    `${Math.round(workspaceLayout.detailRatio * 100)}% to operation detail`,
  );
  sourceGutter.setAttribute(
    "aria-valuenow",
    String(Math.round(workspaceLayout.sourceWidth)),
  );
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
      detail:
        typeof parsed.detail === "boolean"
          ? parsed.detail
          : defaultWorkspaceLayout.detail,
      invocation:
        typeof parsed.invocation === "boolean"
          ? parsed.invocation
          : defaultWorkspaceLayout.invocation,
      source:
        typeof parsed.source === "boolean"
          ? parsed.source
          : defaultWorkspaceLayout.source,
      railWidth:
        typeof parsed.railWidth === "number"
          ? clamp(parsed.railWidth, 240, 560)
          : defaultWorkspaceLayout.railWidth,
      detailRatio:
        typeof parsed.detailRatio === "number"
          ? clamp(parsed.detailRatio, 0.2, 0.75)
          : defaultWorkspaceLayout.detailRatio,
      sourceWidth:
        typeof parsed.sourceWidth === "number"
          ? clamp(parsed.sourceWidth, 300, 720)
          : defaultWorkspaceLayout.sourceWidth,
      execSplit:
        typeof parsed.execSplit === "number"
          ? clamp(parsed.execSplit, 0.2, 0.8)
          : defaultWorkspaceLayout.execSplit,
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
