import {
  resolveOperationRequirement,
  type Invocation,
  type OBInterface,
  type OperationRequirementResolution,
} from "@openbindings/sdk";
import {
  OpenBindingsElement,
  baseStyles,
  formatJSON,
  renderStatic,
  type OperationSource,
} from "@openbindings/ui-core";
import type {
  OperationFrameError,
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";
import { invokeOperationRequirement } from "./requirement.js";

export {
  invokeOperationRequirement,
  operationInvokerInterface,
  OPERATION_INVOKER_OPERATION,
} from "./requirement.js";
export type {
  OperationFrameError,
  OperationInvocationInput,
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";

export const OPERATION_WORKBENCH_TAG = "ob-operation-workbench";
export const DEFAULT_MAX_DISPLAYED_OUTPUTS = 100;
export type OperationInputMode = "single" | "sequence";

type DependencyResolution = OperationRequirementResolution<
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame
>;

type DependencyState =
  | { status: "unavailable"; message: string }
  | { status: "resolving"; message: string }
  | { status: "available"; message: string; resolution: DependencyResolution }
  | { status: "ambiguous"; message: string; resolution: DependencyResolution }
  | { status: "failed"; message: string; error: Error };

export interface InvocationErrorDetail {
  error: OperationFrameError | Error;
}

export type OperationDependencyStatus =
  | "unavailable"
  | "resolving"
  | "available"
  | "ambiguous"
  | "failed";

export interface OperationDependencyStateDetail {
  status: OperationDependencyStatus;
  message: string;
}

export interface InvocationStartDetail {
  interface: OBInterface;
  operationKey: string;
}

export interface InvocationOutputDetail {
  operationKey: string;
  value: unknown;
  index: number;
}

export interface InvocationInputClosedDetail {
  operationKey: string;
}

export interface InvocationContextRequiredDetail {
  operationKey: string;
  details?: unknown;
  error: OperationFrameError;
}

export interface InvocationCompleteDetail {
  operationKey: string;
  /** Retained display window, never more than maxDisplayedOutputs. */
  outputs: unknown[];
  outputCount: number;
  truncated: boolean;
}

export interface OperationWorkbenchEventMap {
  "ob-dependency-state": CustomEvent<OperationDependencyStateDetail>;
  "ob-invocation-start": CustomEvent<InvocationStartDetail>;
  "ob-output": CustomEvent<InvocationOutputDetail>;
  "ob-input-closed": CustomEvent<InvocationInputClosedDetail>;
  "ob-context-required": CustomEvent<InvocationContextRequiredDetail>;
  "ob-invocation-complete": CustomEvent<InvocationCompleteDetail>;
  "ob-invocation-error": CustomEvent<InvocationErrorDetail>;
}

export class OperationWorkbenchElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #operationKey: string | null = null;
  #operationSource: OperationSource | null = null;
  #context: Record<string, unknown> | null = null;
  #inputText = "";
  #inputMode: OperationInputMode = "single";
  #inputTouched = false;
  #dependency: DependencyState = {
    status: "unavailable",
    message: "No operation implementation source is connected.",
  };
  #unsubscribe: (() => void) | null = null;
  #resolutionController: AbortController | null = null;
  #activeInvocation:
    | Invocation<OperationInvokerInputFrame, OperationInvokerOutputFrame>
    | null = null;
  #runID = 0;
  #running = false;
  #maxDisplayedOutputs = DEFAULT_MAX_DISPLAYED_OUTPUTS;
  #outputs: unknown[] = [];
  #outputCount = 0;
  #frameError: OperationFrameError | null = null;
  #runtimeError: Error | null = null;

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.#inputTouched = false;
    this.#resetInput();
    this.#clearResult();
    void this.cancel();
    this.requestRender();
  }

  get operationKey(): string | null {
    return this.#operationKey;
  }

  set operationKey(value: string | null) {
    if (value === this.#operationKey) return;
    this.#operationKey = value;
    this.#inputTouched = false;
    this.#resetInput();
    this.#clearResult();
    void this.cancel();
    this.requestRender();
  }

  get operationSource(): OperationSource | null {
    return this.#operationSource;
  }

  set operationSource(value: OperationSource | null) {
    if (value === this.#operationSource) return;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#operationSource = value;
    if (this.isConnected && value) {
      this.#unsubscribe = value.subscribe(() => this.#resolveDependency());
    }
    this.#resolveDependency();
  }

  get context(): Record<string, unknown> | null {
    return this.#context;
  }

  set context(value: Record<string, unknown> | null) {
    this.#context = value;
  }

  get inputText(): string {
    return this.#inputText;
  }

  set inputText(value: string) {
    this.#inputTouched = true;
    this.#inputText = value ?? "";
    this.requestRender();
  }

  get inputMode(): OperationInputMode {
    return this.#inputMode;
  }

  set inputMode(value: OperationInputMode) {
    if (value !== "single" && value !== "sequence") {
      throw new TypeError('inputMode must be "single" or "sequence"');
    }
    if (value === this.#inputMode) return;
    this.#inputMode = value;
    this.#runtimeError = null;
    this.requestRender();
  }

  get maxDisplayedOutputs(): number {
    return this.#maxDisplayedOutputs;
  }

  set maxDisplayedOutputs(value: number) {
    if (!Number.isFinite(value) || value < 1) {
      throw new TypeError("maxDisplayedOutputs must be a positive number");
    }
    const normalized = Math.floor(value);
    if (normalized === this.#maxDisplayedOutputs) return;
    this.#maxDisplayedOutputs = normalized;
    if (this.#outputs.length > normalized) {
      this.#outputs = this.#outputs.slice(-normalized);
    }
    this.requestRender();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.#operationSource && !this.#unsubscribe) {
      this.#unsubscribe = this.#operationSource.subscribe(() =>
        this.#resolveDependency(),
      );
    }
    this.#resolveDependency();
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#resolutionController?.abort(
      new DOMException("element disconnected", "AbortError"),
    );
    this.#resolutionController = null;
    void this.cancel();
  }

  async run(): Promise<void> {
    const targetInterface = this.#obi;
    const targetOperationKey = this.#operationKey;
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    if (!targetInterface || !targetOperationKey || !operation) return;
    if (this.#dependency.status !== "available") return;

    let inputValues: unknown[] = [];
    if (operation.input !== undefined && operation.input !== null) {
      if (!this.#inputText.trim()) {
        this.#runtimeError = new Error("Enter one JSON input value.");
        this.requestRender();
        return;
      }
      try {
        const parsed = JSON.parse(this.#inputText) as unknown;
        if (this.#inputMode === "sequence") {
          if (!Array.isArray(parsed)) {
            throw new Error(
              "Sequence mode requires one JSON array whose members are input values.",
            );
          }
          inputValues = parsed;
        } else {
          inputValues = [parsed];
        }
      } catch (error) {
        const prefix =
          this.#inputMode === "sequence"
            ? "Input sequence is invalid"
            : "Input must be valid JSON";
        this.#runtimeError = new Error(
          `${prefix}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.requestRender();
        return;
      }
    }

    await this.cancel();
    if (
      this.#obi !== targetInterface ||
      this.#operationKey !== targetOperationKey
    ) {
      return;
    }
    const dependency = this.#dependency;
    if (dependency.status !== "available") return;
    const resolution = dependency.resolution;
    if (resolution.status !== "available") return;
    const targetContext = this.#context;

    const runID = ++this.#runID;
    const call = resolution.match.invoke();
    this.#activeInvocation = call;
    this.#running = true;
    this.#outputs = [];
    this.#outputCount = 0;
    this.#frameError = null;
    this.#runtimeError = null;
    this.emit<InvocationStartDetail>("ob-invocation-start", {
      interface: targetInterface,
      operationKey: targetOperationKey,
    });
    this.requestRender();

    const drain = async () => {
      for await (const frame of call.outputs) {
        if (runID !== this.#runID) return;
        switch (frame.kind) {
          case "output":
            this.#outputs = [...this.#outputs, frame.value];
            this.#outputCount += 1;
            if (this.#outputs.length > this.#maxDisplayedOutputs) {
              this.#outputs = this.#outputs.slice(-this.#maxDisplayedOutputs);
            }
            this.emit<InvocationOutputDetail>("ob-output", {
              operationKey: targetOperationKey,
              value: frame.value,
              index: this.#outputCount - 1,
            });
            break;
          case "input_closed":
            this.emit<InvocationInputClosedDetail>("ob-input-closed", {
              operationKey: targetOperationKey,
            });
            break;
          case "complete":
            break;
          case "error":
            this.#frameError = frame.error;
            if (frame.error.code === "CONTEXT_REQUIRED") {
              this.emit<InvocationContextRequiredDetail>(
                "ob-context-required",
                {
                  operationKey: targetOperationKey,
                  details: frame.error.details,
                  error: frame.error,
                },
              );
            }
            break;
        }
        this.requestRender();
      }
    };

    const pump = async () => {
      const open: OperationInvokerInputFrame = {
        kind: "open",
        input: {
          interface: targetInterface,
          operation: targetOperationKey,
          ...(targetContext ? { context: targetContext } : {}),
        },
      };
      await call.write(open);
      if (operation.input !== undefined && operation.input !== null) {
        for (const value of inputValues) {
          await call.write({ kind: "input", value });
        }
      }
      await call.write({ kind: "close" });
      await call.close();
    };

    try {
      await Promise.all([pump(), drain()]);
      await call.closed;
      if (runID !== this.#runID) return;
      if (this.#frameError) {
        this.emit<InvocationErrorDetail>("ob-invocation-error", {
          error: this.#frameError,
        });
      } else {
        this.emit<InvocationCompleteDetail>("ob-invocation-complete", {
          operationKey: targetOperationKey,
          outputs: [...this.#outputs],
          outputCount: this.#outputCount,
          truncated: this.#outputCount > this.#outputs.length,
        });
      }
    } catch (error) {
      if (runID !== this.#runID) return;
      this.#runtimeError =
        error instanceof Error ? error : new Error(String(error));
      this.emit<InvocationErrorDetail>("ob-invocation-error", {
        error: this.#runtimeError,
      });
    } finally {
      if (runID === this.#runID) {
        this.#activeInvocation = null;
        this.#running = false;
        this.requestRender();
      }
    }
  }

  async cancel(): Promise<void> {
    const active = this.#activeInvocation;
    if (!active) return;
    this.#runID += 1;
    this.#activeInvocation = null;
    this.#running = false;
    await active.cancel();
    this.requestRender();
  }

  protected render(): void {
    const root = this.renderRoot;
    if (!root) return;
    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <section class="container" part="container" aria-label="Operation invocation workbench">
         <header>
           <div>
             <p class="eyebrow">Invocation</p>
             <h2></h2>
           </div>
           <span class="status" part="status" role="status"></span>
         </header>
         <div class="empty" part="empty"></div>
         <div class="workspace">
           <section class="input-column">
             <div class="section-heading">
               <h3>Input</h3>
               <div class="input-options">
                 <span class="input-hint"></span>
                 <label>
                   <span class="sr-only">Input cardinality</span>
                   <select class="input-mode" part="input-mode" aria-label="Input cardinality">
                     <option value="single">One value</option>
                     <option value="sequence">Value sequence</option>
                   </select>
                 </label>
               </div>
             </div>
             <textarea part="input" spellcheck="false" aria-label="Operation input as JSON"></textarea>
             <div class="actions">
               <button class="run" part="run" type="button">Run</button>
               <button class="cancel" part="cancel" type="button">Cancel</button>
             </div>
           </section>
           <section class="output-column">
             <div class="section-heading">
               <h3>Output</h3>
               <span class="output-count"></span>
             </div>
             <pre part="output" aria-live="polite"></pre>
             <div class="error" part="error" role="alert"></div>
           </section>
         </div>
       </section>`,
    );

    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    const heading = root.querySelector("h2");
    const status = root.querySelector(".status");
    const empty = root.querySelector(".empty") as HTMLElement | null;
    const workspace = root.querySelector(".workspace") as HTMLElement | null;
    const textarea = root.querySelector("textarea");
    const inputHint = root.querySelector(".input-hint");
    const inputMode = root.querySelector(
      ".input-mode",
    ) as HTMLSelectElement | null;
    const runButton = root.querySelector(".run") as HTMLButtonElement | null;
    const cancelButton = root.querySelector(
      ".cancel",
    ) as HTMLButtonElement | null;
    const output = root.querySelector("pre");
    const outputCount = root.querySelector(".output-count");
    const error = root.querySelector(".error") as HTMLElement | null;

    if (heading) heading.textContent = this.#operationKey ?? "No operation";
    if (status) {
      status.textContent = this.#running
        ? "Running"
        : this.#dependency.message;
      status.className = `status ${this.#dependency.status}`;
    }

    if (!this.#obi || !this.#operationKey || !operation) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = this.#obi
          ? "Select an operation to invoke it."
          : "Assign an OBI document and operation key.";
      }
      if (workspace) workspace.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    const hasInput =
      operation.input !== undefined && operation.input !== null;
    if (textarea) {
      textarea.hidden = !hasInput;
      textarea.disabled = this.#running;
      textarea.value = this.#inputText;
      textarea.placeholder =
        this.#inputMode === "single"
          ? "Enter one JSON input value"
          : "Enter a JSON array; each member is one input value";
      textarea.addEventListener("input", () => {
        this.#inputTouched = true;
        this.#inputText = textarea.value;
      });
    }
    if (inputMode) {
      inputMode.hidden = !hasInput;
      inputMode.disabled = this.#running;
      inputMode.value = this.#inputMode;
      inputMode.addEventListener("change", () => {
        this.inputMode = inputMode.value as OperationInputMode;
      });
    }
    if (inputHint) {
      inputHint.textContent = hasInput
        ? this.#inputMode === "single"
          ? "One JSON value"
          : "JSON array → input values"
        : "This operation declares no input";
    }

    const available = this.#dependency.status === "available";
    if (runButton) {
      runButton.disabled = !available || this.#running;
      runButton.addEventListener("click", () => void this.run());
    }
    if (cancelButton) {
      cancelButton.hidden = !this.#running;
      cancelButton.addEventListener("click", () => void this.cancel());
    }

    if (output) {
      const rendered =
        this.#outputs.length === 1 ? this.#outputs[0] : this.#outputs;
      output.textContent =
        this.#outputCount > 0
          ? `${
              this.#outputCount > this.#outputs.length
                ? `Showing the last ${this.#outputs.length} of ${this.#outputCount} values.\n\n`
                : ""
            }${formatJSON(rendered)}`
          : this.#running
            ? "Waiting for output…"
            : "No output yet.";
    }
    if (outputCount) {
      outputCount.textContent =
        this.#outputCount === 0
          ? ""
          : `${this.#outputCount} value${this.#outputCount === 1 ? "" : "s"}`;
    }
    if (error) {
      const currentError = this.#frameError ?? this.#runtimeError;
      error.hidden = !currentError;
      error.textContent = currentError
        ? "code" in currentError
          ? `${currentError.code}: ${currentError.message}`
          : currentError.message
        : "";
    }
  }

  #resetInput(): void {
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    if (!operation || operation.input === undefined || operation.input === null) {
      this.#inputText = "";
      return;
    }
    if (!this.#inputTouched) this.#inputText = "";
  }

  #clearResult(): void {
    this.#outputs = [];
    this.#outputCount = 0;
    this.#frameError = null;
    this.#runtimeError = null;
  }

  #resolveDependency(): void {
    this.#resolutionController?.abort(
      new DOMException("implementation source changed", "AbortError"),
    );
    this.#resolutionController = null;

    const source = this.#operationSource;
    if (!source) {
      this.#dependency = {
        status: "unavailable",
        message: "Invocation unavailable",
      };
      this.#emitDependencyState();
      this.requestRender();
      return;
    }

    const controller = new AbortController();
    this.#resolutionController = controller;
    this.#dependency = {
      status: "resolving",
      message: "Resolving invocation capability",
    };
    this.#emitDependencyState();
    this.requestRender();

    void resolveOperationRequirement(
      invokeOperationRequirement,
      source.snapshot(),
      { signal: controller.signal },
    ).then(
      resolution => {
        if (controller.signal.aborted) return;
        this.#resolutionController = null;
        if (resolution.status === "available") {
          this.#dependency = {
            status: "available",
            message: "Ready",
            resolution,
          };
        } else if (resolution.status === "ambiguous") {
          this.#dependency = {
            status: "ambiguous",
            message: `${resolution.matches.length} invocation implementations match`,
            resolution,
          };
        } else {
          this.#dependency = {
            status: "unavailable",
            message: "No compatible Operation Invoker is available",
          };
        }
        this.#emitDependencyState();
        this.requestRender();
      },
      failure => {
        if (controller.signal.aborted) return;
        const error =
          failure instanceof Error ? failure : new Error(String(failure));
        this.#resolutionController = null;
        this.#dependency = {
          status: "failed",
          message: "Invocation dependency failed",
          error,
        };
        this.#emitDependencyState();
        this.requestRender();
      },
    );
  }

  #emitDependencyState(): void {
    this.emit<OperationDependencyStateDetail>("ob-dependency-state", {
      status: this.#dependency.status,
      message: this.#dependency.message,
    });
  }
}

export interface OperationWorkbenchElement {
  addEventListener<K extends keyof OperationWorkbenchEventMap>(
    type: K,
    listener: (
      this: OperationWorkbenchElement,
      event: OperationWorkbenchEventMap[K],
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "ob-operation-workbench": OperationWorkbenchElement;
  }
}

const styles = `
  .container {
    min-height: 18rem;
    padding: calc(var(--ob-space) * 1.5);
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  header, .section-heading, .actions, .input-options {
    display: flex;
    gap: var(--ob-space);
    align-items: center;
    justify-content: space-between;
  }

  .eyebrow, h2, h3 {
    margin: 0;
  }

  .eyebrow {
    color: var(--ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2 {
    overflow-wrap: anywhere;
    font: 650 1rem / 1.3 var(--ob-font-mono);
  }

  h3 {
    font-size: 0.78rem;
  }

  .status {
    padding: 0.18rem 0.48rem;
    color: var(--ob-color-text-muted);
    background: var(--ob-color-surface);
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .status.available {
    color: var(--ob-color-success);
  }

  .status.ambiguous,
  .status.failed {
    color: var(--ob-color-danger);
  }

  .workspace {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
    gap: var(--ob-space);
    margin-top: calc(var(--ob-space) * 1.5);
  }

  .input-column, .output-column {
    min-width: 0;
  }

  .section-heading {
    margin-bottom: 0.45rem;
  }

  .input-hint, .output-count {
    color: var(--ob-color-text-muted);
    font-size: 0.7rem;
  }

  .input-options {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .input-mode {
    min-height: 1.8rem;
    padding: 0.2rem 0.35rem;
    color: var(--ob-color-text);
    font: inherit;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  textarea, pre {
    width: 100%;
    min-height: 13rem;
    padding: var(--ob-space);
    margin: 0;
    overflow: auto;
    color: var(--ob-color-text);
    font: 0.76rem / 1.5 var(--ob-font-mono);
    background: var(--ob-color-surface);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
    resize: vertical;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .actions {
    justify-content: flex-start;
    margin-top: var(--ob-space);
  }

  button {
    min-height: 2.25rem;
    padding: 0.42rem 0.8rem;
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .run {
    color: var(--ob-color-accent-contrast);
    background: var(--ob-color-accent);
    border-color: var(--ob-color-accent);
  }

  .cancel {
    color: var(--ob-color-danger);
    background: var(--ob-color-background);
  }

  .error {
    padding: 0.55rem 0;
    color: var(--ob-color-danger);
    font-size: 0.78rem;
  }

  .empty {
    display: grid;
    min-height: 12rem;
    place-items: center;
    color: var(--ob-color-text-muted);
    text-align: center;
  }
`;
