import "@openbindings/obi-explorer/define";
import "@openbindings/operation-detail/define";
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
  type OBInterface,
} from "@openbindings/sdk";
import { OperationEnvironment } from "@openbindings/ui-core";
import type { OBIExplorerElement } from "@openbindings/obi-explorer";
import type { OperationDetailElement } from "@openbindings/operation-detail";
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

const explorer = requiredElement<OBIExplorerElement>("ob-obi-explorer");
const detail = requiredElement<OperationDetailElement>("ob-operation-detail");
const invocation = requiredElement<OperationWorkbenchElement>(
  "ob-operation-workbench",
);
const connectionStatus = requiredElement<HTMLElement>("#connection-status");
const bootstrapMessage = requiredElement<HTMLElement>("#bootstrap-message");
const targetForm = requiredElement<HTMLFormElement>("#target-form");
const targetURL = requiredElement<HTMLInputElement>("#target-url");
const tokenForm = requiredElement<HTMLFormElement>("#token-form");
const tokenInput = requiredElement<HTMLInputElement>("#session-token");
const targetContextForm = requiredElement<HTMLFormElement>(
  "#target-context-form",
);
const targetContextInput = requiredElement<HTMLTextAreaElement>(
  "#target-context",
);
const themeToggle = requiredElement<HTMLButtonElement>("#theme-toggle");

const operationEnvironment = new OperationEnvironment();
invocation.operationSource = operationEnvironment;

let sessionToken = tokenFromFragment();
let obInterface: OBInterface | null = null;
let obImplementationInterface: OBInterface | null = null;
let obInvoker: OperationInvoker | null = null;
let targetInterface: OBInterface | null = null;
let targetContext: Record<string, unknown> | null = null;

if (sessionToken) tokenInput.placeholder = "Configured for this page";

explorer.addEventListener("ob-operation-select", event => {
  const operationKey = event.detail.operationKey;
  detail.operationKey = operationKey;
  invocation.operationKey = operationKey;
});

targetForm.addEventListener("submit", event => {
  event.preventDefault();
  const address = targetURL.value.trim();
  if (address) void resolveTarget(address);
});

tokenForm.addEventListener("submit", event => {
  event.preventDefault();
  sessionToken = tokenInput.value.trim();
  tokenInput.value = "";
  tokenInput.placeholder = sessionToken
    ? "Configured for this page"
    : "Paste the token printed by ob start";
  applyTargetContext();
  publishOBImplementation();
  bootstrapMessage.textContent = sessionToken
    ? "The ob start token is held in memory and is not forwarded to other targets."
    : "No session token is configured.";
});

targetContextForm.addEventListener("submit", event => {
  event.preventDefault();
  const raw = targetContextInput.value.trim();
  if (!raw) {
    targetContext = null;
    applyTargetContext();
    bootstrapMessage.textContent = "No target invocation context is configured.";
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
    bootstrapMessage.textContent =
      "Target invocation context is held in memory for this page.";
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
    targetContextInput.focus();
  }
});

themeToggle.addEventListener("click", () => {
  const dark = document.documentElement.toggleAttribute("data-dark");
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.textContent = dark ? "Light theme" : "Dark theme";
});

invocation.addEventListener("ob-context-required", () => {
  if (!sessionToken) {
    bootstrapMessage.textContent =
      "Invocation requires context. Add the ob start session token, or supply target context programmatically.";
    tokenInput.focus();
  }
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
    connectionStatus.textContent = "Connected through OpenBindings";

    // The server's own OBI is a useful zero-configuration target and proves
    // that the workbench can invoke ob through ob's published interface.
    setTarget(obInterface, "This ob start instance");
    const preferred =
      obInterface.operations["openbindings.ob.describe"]
        ? "openbindings.ob.describe"
        : Object.keys(obInterface.operations)[0];
    if (preferred) selectOperation(preferred);
  } catch (error) {
    connectionStatus.textContent = "Connection failed";
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
  bootstrapMessage.textContent = `Resolving ${address} through ob…`;

  try {
    const result = await invokeThroughOB<{ address: string }, ResolveInterfaceOutput>(
      obInterface,
      "openbindings.ob.resolveInterface",
      { address },
    );
    setTarget(result.interface, result.resolvedUrl ?? address);
    const first = Object.keys(result.interface.operations)[0];
    if (first) selectOperation(first);
    bootstrapMessage.textContent = result.synthesizedFrom
      ? `Synthesized ${result.interface.name ?? "interface"} from ${result.synthesizedFrom}.`
      : `Loaded ${result.interface.name ?? "interface"}.`;
  } catch (error) {
    bootstrapMessage.textContent = errorText(error);
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

function setTarget(obi: OBInterface, label: string): void {
  targetInterface = obi;
  explorer.obi = obi;
  detail.obi = obi;
  invocation.obi = obi;
  applyTargetContext();
  targetURL.placeholder = label;
}

function selectOperation(operationKey: string): void {
  explorer.selectedOperation = operationKey;
  detail.operationKey = operationKey;
  invocation.operationKey = operationKey;
}

function applyTargetContext(): void {
  // The local session token authenticates this ob start process. It must
  // never become an arbitrary remote target's bearer token. It is supplied
  // as target context only when the selected target is the server itself.
  invocation.context =
    targetInterface === obInterface && sessionToken
      ? { ...(targetContext ?? {}), bearerToken: sessionToken }
      : targetContext;
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

function requiredElement<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`missing required element: ${selector}`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
