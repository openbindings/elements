import type { JSONEditorElement } from "@openbindings/json-editor";
import {
  resolveOperationRequirement,
  type BindingEntry,
  type Invocation,
  type OBInterface,
  type Operation,
  type OperationRequirementResolution,
} from "@openbindings/sdk";
import {
  OpenBindingsElement,
  Refs,
  adoptStyles,
  baseStyles,
  formatJSON,
  reconcile,
  type OperationSource,
} from "@openbindings/ui-core";
import type {
  OperationFrameError,
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";
import {
  analyzeInputSchema,
  appendArrayItemAtPath,
  buildPayloadFromDefaults,
  conformsToSchema,
  createSchemaFormModel,
  defaultForField,
  getValueAtPath,
  isArrayField,
  isObjectField,
  isPrimitiveField,
  parseJsonObjectInput,
  payloadToPrettyJson,
  removeArrayItemAtPath,
  setValueAtPath,
  unsetValueAtPath,
  type InputSchemaAnalysis,
  type SchemaField,
  type SchemaFormModel,
  type SchemaObjectField,
  type SchemaPrimitiveField,
} from "./input-model.js";
import { invokeOperationRequirement } from "./requirement.js";

export {
  analyzeInputSchema,
  createSchemaFormModel,
  resolveLocalSchemaRefs,
} from "./input-model.js";
export type {
  FormCapability,
  InputSchemaAnalysis,
  OneOfBranchInfo,
  SchemaArrayField,
  SchemaField,
  SchemaFormModel,
  SchemaObjectField,
  SchemaPrimitiveField,
} from "./input-model.js";

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
export type OperationInputView = "json" | "form";
export type OperationWorkbenchLayout = "stacked" | "split";

const SEQUENCE_FORM_REASON =
  'Form view edits one JSON value. Switch the cardinality to "One value" to use it.';

const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;
const SPLIT_RATIO_STEP = 0.02;
/** Below this container width, split presentation falls back to stacked. */
const NARROW_FALLBACK_REM = 36;

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

export interface InvocationInputChangeDetail {
  operationKey: string;
  text: string;
  mode: OperationInputMode;
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
  /** Wall-clock milliseconds from run start to the terminal frame. */
  durationMs: number;
}

/**
 * Same detail family as `operation-detail`'s `ob-binding-select`: the chosen
 * binding key and its interface entry. Emitted only for a user selection in
 * the binding selector — programmatic `bindingKey` assignment never echoes.
 */
export interface BindingSelectDetail {
  bindingKey: string;
  binding: BindingEntry;
}

/**
 * Emitted when the USER resizes the split layout — at drag end and after each
 * effective keyboard step. Programmatic `splitRatio` assignment never echoes;
 * persistence of the ratio is the host application's policy.
 */
export interface LayoutChangeDetail {
  splitRatio: number;
}

export interface OperationWorkbenchEventMap {
  "ob-dependency-state": CustomEvent<OperationDependencyStateDetail>;
  "ob-binding-select": CustomEvent<BindingSelectDetail>;
  "ob-layout-change": CustomEvent<LayoutChangeDetail>;
  "ob-invocation-start": CustomEvent<InvocationStartDetail>;
  "ob-output": CustomEvent<InvocationOutputDetail>;
  "ob-input-change": CustomEvent<InvocationInputChangeDetail>;
  "ob-input-closed": CustomEvent<InvocationInputClosedDetail>;
  "ob-context-required": CustomEvent<InvocationContextRequiredDetail>;
  "ob-invocation-complete": CustomEvent<InvocationCompleteDetail>;
  "ob-invocation-error": CustomEvent<InvocationErrorDetail>;
}

export class OperationWorkbenchElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #operationKey: string | null = null;
  #bindingKey: string | null = null;
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
  /**
   * Global index of the output the shared editor renders; null follows the
   * latest frame. A stream shows one value at a time through a real code
   * view (rev 17.4) — highlight, folding, search, and viewport-only
   * rendering — instead of one <pre> per frame.
   */
  #selectedOutputIndex: number | null = null;
  /** The global index the editor last rendered, to avoid rewrites. */
  #renderedOutputIndex: number | null = null;
  #outputs: unknown[] = [];
  /** performance.now() per retained output, sliced in lockstep with #outputs. */
  #outputTimes: number[] = [];
  #outputCount = 0;
  /** Timestamp of the run's FIRST output frame; offsets are measured from it. */
  #firstFrameTime: number | null = null;
  /** Run start → terminal, settled only by the run's own terminal (runID-fenced). */
  #totalDurationMs: number | null = null;
  #copied = false;
  #copyTimer: ReturnType<typeof setTimeout> | null = null;
  #frameError: OperationFrameError | null = null;
  #runtimeError: Error | null = null;
  #refs: Refs | null = null;
  #contentRoot: HTMLElement | null = null;
  #statusAnnouncer: HTMLElement | null = null;
  #outputAnnouncer: HTMLElement | null = null;
  #lastStatusAnnouncement = "";
  #lastAnnouncedOutputCount = 0;
  #bindingOptionsSignature = "";
  #inputView: OperationInputView = "json";
  #oneOfIndex = 0;
  #shapeOptionsSignature = "";
  /** Guard against form DOM rebuilds: set after a build, matched per render. */
  #formRendered: { signature: string; text: string } | null = null;
  /** The last capability-supported model, for payload defaults in handlers. */
  #formModel: SchemaFormModel | null = null;
  #layout: OperationWorkbenchLayout = "stacked";
  #splitRatio = 0.5;
  #narrow = false;
  #layoutObserver: ResizeObserver | null = null;
  #dragBounds: { left: number; width: number } | null = null;
  #dragChanged = false;

  static get observedAttributes(): string[] {
    return ["layout", "hide-identity"];
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    value: string | null,
  ): void {
    // The attribute is a parse-time convenience for the property; unknown
    // values normalize to the default rather than throwing mid-parse.
    if (name === "layout") {
      this.layout = value === "split" ? "split" : "stacked";
    }
    if (name === "hide-identity") this.hideIdentity = value !== null;
  }

  /**
   * Hides the header's identity block (eyebrow + operation key) for hosts
   * that already name the invocation — the workbench's rev-17 bottom sheet
   * strip. The functional header tools (binding select, status) stay.
   */
  get hideIdentity(): boolean {
    return this.hasAttribute("hide-identity");
  }

  set hideIdentity(value: boolean) {
    this.toggleAttribute("hide-identity", Boolean(value));
  }

  constructor() {
    super();
    const root = this.renderRoot;
    if (!root) return;
    // The shell is built once. Live regions in particular must be present in
    // the accessibility tree *before* their content changes, or assistive
    // technology announces nothing — rebuilding them on every render is why
    // status and output updates used to be silent.
    adoptStyles(root, baseStyles, styles);
    root.innerHTML = CONTENT_SHELL;
    this.#refs = new Refs(root);
    this.#contentRoot = this.#refs.find(".render-root");
    this.#statusAnnouncer = this.#refs.find(".status-announcer");
    this.#outputAnnouncer = this.#refs.find(".output-announcer");
    this.#bindContent();
  }

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.#inputTouched = false;
    this.#resetInputPresentation();
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
    this.#resetInputPresentation();
    this.#resetInput();
    this.#clearResult();
    void this.cancel();
    this.requestRender();
  }

  get bindingKey(): string | null {
    return this.#bindingKey;
  }

  set bindingKey(value: string | null) {
    if (value === this.#bindingKey) return;
    this.#bindingKey = value;
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

  get inputView(): OperationInputView {
    return this.#inputView;
  }

  set inputView(value: OperationInputView) {
    if (value !== "json" && value !== "form") {
      throw new TypeError('inputView must be "json" or "form"');
    }
    if (value === this.#inputView) return;
    this.#inputView = value;
    // Assignment is honest even when the form cannot render: the form pane
    // then shows its decline-with-reason banner rather than silently staying
    // on the JSON editor.
    this.requestRender();
  }

  get layout(): OperationWorkbenchLayout {
    return this.#layout;
  }

  set layout(value: OperationWorkbenchLayout) {
    if (value !== "stacked" && value !== "split") {
      throw new TypeError('layout must be "stacked" or "split"');
    }
    if (value === this.#layout) return;
    this.#layout = value;
    this.requestRender();
  }

  get splitRatio(): number {
    return this.#splitRatio;
  }

  set splitRatio(value: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("splitRatio must be a finite number");
    }
    const clamped = clampSplitRatio(value);
    if (clamped === this.#splitRatio) return;
    this.#splitRatio = clamped;
    // Assignment never echoes: ob-layout-change is user intent only.
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
      this.#outputTimes = this.#outputTimes.slice(-normalized);
    }
    this.requestRender();
  }

  resetInputToSchema(): boolean {
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    if (!operation || operation.input === undefined || operation.input === null) {
      return false;
    }
    // Starter generation targets the effective schema: local refs resolved,
    // and the currently selected oneOf branch when the input declares one.
    const effective = this.#analyzeInput(operation).effective;
    const sample = sampleFromSchema(effective, this.#obi);
    if (!sample.available) return false;
    this.#inputTouched = false;
    this.#inputText = JSON.stringify(sample.value, null, 2) ?? "";
    this.#runtimeError = null;
    this.#emitInputChange();
    this.requestRender();
    return true;
  }

  formatInput(): boolean {
    if (!this.#inputText.trim()) return false;
    try {
      const parsed = JSON.parse(this.#inputText) as unknown;
      this.#inputText = JSON.stringify(parsed, null, 2) ?? "";
      this.#runtimeError = null;
      this.#emitInputChange();
      this.requestRender();
      return true;
    } catch (error) {
      this.#runtimeError = new Error(
        `Input must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.requestRender();
      return false;
    }
  }

  clearOutput(): void {
    this.#clearResult();
    this.requestRender();
  }

  /**
   * Copies the retained output window as WYSIWYG-valid JSON: the bare value
   * for a single output, a JSON array of values for several — never index,
   * offset, or duration labels. Returns whether a clipboard write succeeded.
   */
  async copyOutput(): Promise<boolean> {
    if (this.#outputs.length === 0) return false;
    const payload =
      this.#outputs.length === 1 ? this.#outputs[0] : [...this.#outputs];
    const text = formatJSON(payload);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = copyThroughSelection(text);
    if (copied) {
      this.#copied = true;
      if (this.#copyTimer !== null) clearTimeout(this.#copyTimer);
      this.#copyTimer = setTimeout(() => {
        this.#copyTimer = null;
        this.#copied = false;
        this.requestRender();
      }, COPY_FEEDBACK_MS);
      this.requestRender();
    }
    return copied;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.#operationSource && !this.#unsubscribe) {
      this.#unsubscribe = this.#operationSource.subscribe(() =>
        this.#resolveDependency(),
      );
    }
    // Reconnect-safe narrow-width watcher: created and observing while
    // connected, disconnected on removal, recreated on reinsertion.
    if (typeof ResizeObserver === "function" && !this.#layoutObserver) {
      const workspace = this.#refs?.find(".workspace");
      if (workspace) {
        this.#layoutObserver = new ResizeObserver(entries => {
          const width = entries[entries.length - 1]?.contentRect.width;
          if (typeof width !== "number") return;
          const narrow =
            width > 0 && width < NARROW_FALLBACK_REM * rootFontSizePx();
          if (narrow !== this.#narrow) {
            this.#narrow = narrow;
            this.requestRender();
          }
        });
        this.#layoutObserver.observe(workspace);
      }
    }
    this.#resolveDependency();
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#layoutObserver?.disconnect();
    this.#layoutObserver = null;
    this.#resolutionController?.abort(
      new DOMException("element disconnected", "AbortError"),
    );
    this.#resolutionController = null;
    void this.cancel();
  }

  async run(): Promise<void> {
    const targetInterface = this.#obi;
    const targetOperationKey = this.#operationKey;
    const targetBindingKey = this.#bindingKey;
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
      this.#operationKey !== targetOperationKey ||
      this.#bindingKey !== targetBindingKey
    ) {
      return;
    }
    const dependency = this.#dependency;
    if (dependency.status !== "available") return;
    const resolution = dependency.resolution;
    if (resolution.status !== "available") return;
    const targetContext = this.#context;

    const runID = ++this.#runID;
    const runStart = performance.now();
    const call = resolution.match.invoke();
    this.#activeInvocation = call;
    this.#running = true;
    this.#outputs = [];
    this.#outputTimes = [];
    this.#outputCount = 0;
    this.#selectedOutputIndex = null;
    this.#renderedOutputIndex = null;
    this.#firstFrameTime = null;
    this.#totalDurationMs = null;
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
          case "output": {
            const receivedAt = performance.now();
            if (this.#firstFrameTime === null) {
              this.#firstFrameTime = receivedAt;
            }
            this.#outputs = [...this.#outputs, frame.value];
            this.#outputTimes = [...this.#outputTimes, receivedAt];
            this.#outputCount += 1;
            if (this.#outputs.length > this.#maxDisplayedOutputs) {
              this.#outputs = this.#outputs.slice(-this.#maxDisplayedOutputs);
              this.#outputTimes = this.#outputTimes.slice(
                -this.#maxDisplayedOutputs,
              );
            }
            this.emit<InvocationOutputDetail>("ob-output", {
              operationKey: targetOperationKey,
              value: frame.value,
              index: this.#outputCount - 1,
            });
            break;
          }
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
          ...(targetBindingKey
            ? { binding: targetBindingKey }
            : { operation: targetOperationKey }),
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
      const durationMs = performance.now() - runStart;
      this.#totalDurationMs = durationMs;
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
          durationMs,
        });
      }
    } catch (error) {
      if (runID !== this.#runID) return;
      this.#totalDurationMs = performance.now() - runStart;
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

  /**
   * Attaches every listener exactly once, against shell nodes that live for
   * the element's lifetime. Previously these were re-attached on each render,
   * which meant the cost of a render grew with the size of the UI and any
   * node the user was interacting with was destroyed underneath them.
   */
  #bindContent(): void {
    const refs = this.#refs;
    if (!refs) return;

    const outputEditor = refs.find<JSONEditorElement>(".output-editor");
    if (outputEditor) {
      outputEditor.readOnly = true;
      outputEditor.language = "json";
    }
    refs.find(".output-list")?.addEventListener("click", event => {
      const item = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".output-item",
      );
      if (!item?.dataset.globalIndex) return;
      this.#selectedOutputIndex = Number(item.dataset.globalIndex);
      this.requestRender();
    });

    refs.find(".input-editor")?.addEventListener("ob-json-input", event => {
      this.#inputTouched = true;
      this.#inputText = (event as CustomEvent<{ text: string }>).detail.text;
      this.#emitInputChange();
    });

    // Cmd/Ctrl+Enter runs from anywhere in the input surface.
    refs.find(".input-editor")?.addEventListener("keydown", event => {
      const key = event as KeyboardEvent;
      if (
        key.key === "Enter" &&
        (key.metaKey || key.ctrlKey) &&
        !this.#running
      ) {
        key.preventDefault();
        void this.run();
      }
    });

    refs.find<HTMLSelectElement>(".input-mode")?.addEventListener("change", event => {
      this.inputMode = (event.target as HTMLSelectElement)
        .value as OperationInputMode;
      this.#emitInputChange();
    });

    // User selection routes through the property setter (cancel + clear per
    // its documented semantics) and then emits intent. Programmatic
    // `bindingKey` assignment never reaches this handler, so it never echoes.
    refs
      .find<HTMLSelectElement>(".binding-select")
      ?.addEventListener("change", event => {
        const key = (event.target as HTMLSelectElement).value;
        const binding = key ? this.#obi?.bindings?.[key] : undefined;
        if (!key || !binding || key === this.#bindingKey) return;
        this.bindingKey = key;
        this.emit<BindingSelectDetail>("ob-binding-select", {
          bindingKey: key,
          binding,
        });
      });

    refs
      .find(".format-input")
      ?.addEventListener("click", () => this.formatInput());
    refs
      .find(".reset-input")
      ?.addEventListener("click", () => this.resetInputToSchema());

    refs.find(".view-json")?.addEventListener("click", () => {
      if (this.#inputView !== "json") this.inputView = "json";
    });
    refs.find(".view-form")?.addEventListener("click", () => {
      if (this.#inputView === "form") return;
      this.inputView = "form";
      // Entering form mode with an empty editor seeds the schema defaults so
      // the form starts from a committed payload (benchmark behavior).
      if (!parseJsonObjectInput(this.#inputText).empty) return;
      const operation =
        this.#obi && this.#operationKey
          ? this.#obi.operations[this.#operationKey]
          : undefined;
      if (!operation || operation.input === undefined || operation.input === null) {
        return;
      }
      const { capability, model } = createSchemaFormModel(
        this.#analyzeInput(operation).effective,
      );
      if (!capability.supported || !model) return;
      this.#inputTouched = true;
      this.#inputText = payloadToPrettyJson(buildPayloadFromDefaults(model));
      this.#emitInputChange();
      this.requestRender();
    });

    refs
      .find<HTMLSelectElement>(".input-shape")
      ?.addEventListener("change", event => {
        const index = Number((event.target as HTMLSelectElement).value);
        if (!Number.isInteger(index)) return;
        this.#selectOneOfBranch(index);
      });

    refs.find(".form-banner-json")?.addEventListener("click", () => {
      if (this.#inputView !== "json") this.inputView = "json";
    });
    refs
      .find(".form-banner-reset")
      ?.addEventListener("click", () => this.resetInputToSchema());

    // Cmd/Ctrl+Enter runs from the form surface too.
    refs.find(".form-view")?.addEventListener("keydown", event => {
      const key = event as KeyboardEvent;
      if (
        key.key === "Enter" &&
        (key.metaKey || key.ctrlKey) &&
        !this.#running
      ) {
        key.preventDefault();
        void this.run();
      }
    });
    refs.find(".run")?.addEventListener("click", () => void this.run());
    refs.find(".cancel")?.addEventListener("click", () => void this.cancel());
    refs
      .find(".clear-output")
      ?.addEventListener("click", () => this.clearOutput());
    refs
      .find(".copy-output")
      ?.addEventListener("click", () => void this.copyOutput());

    const gutter = refs.find(".layout-gutter");
    if (gutter) this.#bindLayoutGutter(gutter);
  }

  /**
   * Pointer and keyboard resize for the split gutter. The pointer path uses
   * pointer capture so a fast drag that leaves the 8px hit zone keeps
   * resizing; movement mutates state silently and ob-layout-change fires
   * once, at drag end. Keyboard steps emit per effective change.
   */
  #bindLayoutGutter(gutter: HTMLElement): void {
    const endDrag = (event: Event) => {
      if (this.#dragBounds === null) return;
      this.#dragBounds = null;
      gutter.classList.remove("dragging");
      const pointerID = (event as PointerEvent).pointerId;
      try {
        gutter.releasePointerCapture?.(pointerID);
      } catch {
        // The capture may already be gone (pointercancel, jsdom).
      }
      if (this.#dragChanged) {
        this.#dragChanged = false;
        this.emit<LayoutChangeDetail>("ob-layout-change", {
          splitRatio: this.#splitRatio,
        });
      }
    };

    gutter.addEventListener("pointerdown", event => {
      const pointer = event as PointerEvent;
      if (pointer.button !== 0) return;
      const workspace = this.#refs?.find(".workspace");
      if (!workspace) return;
      const bounds = workspace.getBoundingClientRect();
      if (bounds.width <= 0) return;
      this.#dragBounds = { left: bounds.left, width: bounds.width };
      this.#dragChanged = false;
      gutter.classList.add("dragging");
      try {
        gutter.setPointerCapture?.(pointer.pointerId);
      } catch {
        // jsdom tracks no pointers; capture is progressive enhancement there.
      }
      pointer.preventDefault();
    });

    gutter.addEventListener("pointermove", event => {
      const bounds = this.#dragBounds;
      if (bounds === null) return;
      const pointer = event as PointerEvent;
      const next = clampSplitRatio(
        (pointer.clientX - bounds.left) / bounds.width,
      );
      if (next === this.#splitRatio) return;
      this.#splitRatio = next;
      this.#dragChanged = true;
      this.requestRender();
    });

    gutter.addEventListener("pointerup", endDrag);
    gutter.addEventListener("pointercancel", endDrag);

    gutter.addEventListener("keydown", event => {
      const key = (event as KeyboardEvent).key;
      let target: number | null = null;
      if (key === "ArrowLeft") target = this.#splitRatio - SPLIT_RATIO_STEP;
      else if (key === "ArrowRight") {
        target = this.#splitRatio + SPLIT_RATIO_STEP;
      } else if (key === "Home") target = SPLIT_RATIO_MIN;
      else if (key === "End") target = SPLIT_RATIO_MAX;
      if (target === null) return;
      event.preventDefault();
      const next = clampSplitRatio(target);
      if (next === this.#splitRatio) return;
      this.#splitRatio = next;
      this.requestRender();
      this.emit<LayoutChangeDetail>("ob-layout-change", {
        splitRatio: next,
      });
    });
  }

  protected render(): void {
    const refs = this.#refs;
    if (!refs || !this.#contentRoot) return;
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    const heading = refs.find("h2");
    const status = refs.find(".status");
    const empty = refs.find(".empty");
    const workspace = refs.find(".workspace");
    const editor = refs.find<JSONEditorElement>(".input-editor");
    const inputHint = refs.find(".input-hint");
    const inputMode = refs.find<HTMLSelectElement>(".input-mode");
    const formatInput = refs.find<HTMLButtonElement>(".format-input");
    const resetInput = refs.find<HTMLButtonElement>(".reset-input");
    const runButton = refs.find<HTMLButtonElement>(".run");
    const cancelButton = refs.find<HTMLButtonElement>(".cancel");
    const outputNotice = refs.find(".output-notice");
    const outputList = refs.find(".output-list");
    const outputCount = refs.find(".output-count");
    const outputTiming = refs.find(".output-timing");
    const copyOutput = refs.find<HTMLButtonElement>(".copy-output");
    const clearOutput = refs.find<HTMLButtonElement>(".clear-output");
    const error = refs.find(".error");
    const errorSummary = refs.find(".error-summary");
    const errorDetail = refs.find(".error-detail");
    const errorDetails = refs.find<HTMLDetailsElement>(".error details");
    const bindingBar = refs.find(".binding-bar");
    const bindingSelect = refs.find<HTMLSelectElement>(".binding-select");
    const statusMessage = this.#running
      ? "Running"
      : this.#bindingKey && this.#dependency.status === "available"
        ? `Ready · ${this.#bindingKey}`
        : this.#dependency.message;
    // The visible pill carries the routed binding key, but the live region
    // must not re-announce a programmatic bindingKey reflection — it speaks
    // only dependency and run state.
    const announcedStatus = this.#running
      ? "Running"
      : this.#dependency.message;

    if (heading) heading.textContent = this.#operationKey ?? "No operation";
    if (status) {
      status.textContent = statusMessage;
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
      // No cockpit without an operation: drop the fill chain so the empty
      // state renders at natural document height.
      refs.find(".container")?.classList.remove("split");
      if (bindingBar) bindingBar.hidden = true;
      this.#announceStatus(announcedStatus);
      this.#announceOutputCount();
      return;
    }

    this.#syncBindingSelector(bindingBar, bindingSelect, operation);

    if (empty) empty.hidden = true;
    // The no-operation branch above hides the workspace; an operation that
    // arrives later (e.g. assigned after the element is already connected)
    // must un-hide it in the same render path, or the workbench stays blank
    // forever.
    if (workspace) workspace.hidden = false;
    // Layout is geometry only — classes and grid custom properties on shell
    // nodes, never markup replacement — so toggling it preserves the editor
    // and every output block by identity. Below the narrow threshold split
    // presentation falls back to stacked while the property keeps its value.
    const effectiveSplit = this.#layout === "split" && !this.#narrow;
    // The container joins the fill chain in split mode: it flexes the
    // workspace to all height the host grants, so the editor and output view
    // scroll internally instead of leaving dead space below.
    refs.find(".container")?.classList.toggle("split", effectiveSplit);
    if (workspace) {
      workspace.classList.toggle("split", effectiveSplit);
      workspace.classList.toggle("narrow", this.#narrow);
      workspace.style.setProperty(
        "--_ob-split-input",
        `${this.#splitRatio}fr`,
      );
      workspace.style.setProperty(
        "--_ob-split-output",
        `${roundRatio(1 - this.#splitRatio)}fr`,
      );
    }
    const layoutGutter = refs.find(".layout-gutter");
    if (layoutGutter) {
      layoutGutter.hidden = !effectiveSplit;
      layoutGutter.setAttribute(
        "aria-valuenow",
        String(Math.round(this.#splitRatio * 100)),
      );
    }
    const hasInput =
      operation.input !== undefined && operation.input !== null;
    const analysis = hasInput ? this.#analyzeInput(operation) : null;
    const form = hasInput
      ? createSchemaFormModel(analysis?.effective)
      : { capability: { supported: false as const }, model: null };
    this.#formModel = form.capability.supported ? form.model : null;
    const starterAvailable = hasInput
      ? sampleFromSchema(analysis?.effective, this.#obi).available
      : false;
    const showForm = hasInput && this.#inputView === "form";
    this.#syncInputPanel(refs, analysis, form, hasInput, showForm, starterAvailable);
    if (editor) {
      editor.hidden = !hasInput || showForm;
      editor.readOnly = this.#running;
      editor.text = this.#inputText;
      editor.label = `Input for ${this.#operationKey ?? "operation"} as JSON`;
      editor.placeholder =
        this.#inputMode === "single"
          ? "Enter one JSON input value"
          : "Enter a JSON array; each member is one input value";
    }
    if (inputMode) {
      inputMode.hidden = !hasInput;
      inputMode.disabled = this.#running;
      inputMode.value = this.#inputMode;
    }
    if (formatInput) {
      formatInput.hidden = !hasInput;
      formatInput.disabled = this.#running || !this.#inputText.trim();
    }
    if (resetInput) {
      resetInput.hidden = !hasInput;
      resetInput.disabled = this.#running || !starterAvailable;
    }
    if (inputHint) {
      inputHint.textContent = hasInput
        ? !form.capability.supported && form.capability.reason
          ? `Form view unavailable: ${form.capability.reason}`
          : this.#inputMode === "single"
            ? "One JSON value"
            : "JSON array → input values"
        : "This operation declares no input";
    }

    const available = this.#dependency.status === "available";
    if (runButton) {
      runButton.disabled = !available || this.#running;
    }
    if (cancelButton) {
      cancelButton.hidden = !this.#running;
    }

    if (outputNotice) {
      const notice =
        this.#outputCount === 0
          ? this.#running
            ? "Waiting for output…"
            : "No output yet."
          : this.#outputCount > this.#outputs.length
            ? `Showing the last ${this.#outputs.length} of ${this.#outputCount} values.`
            : "";
      outputNotice.textContent = notice;
      outputNotice.hidden = !notice;
    }
    if (outputList) {
      // The strip is a selector, one row per retained output (created once
      // per frame); the SHARED read-only editor below renders the selected
      // value — a real code view (highlight, folding, search, viewport-only
      // rendering) instead of one <pre> per frame (rev 17.4).
      const startIndex = this.#outputCount - this.#outputs.length;
      const firstFrameAt = this.#firstFrameTime;
      const solo = this.#outputCount === 1;
      const items = this.#outputs.map((value, position) => ({
        value,
        globalIndex: startIndex + position,
        at: this.#outputTimes[position] ?? firstFrameAt ?? 0,
      }));
      // Selection: an explicit pick holds while retained; otherwise (or when
      // the pick scrolled out of the retention window) follow the latest.
      const latestIndex = this.#outputCount - 1;
      const selectedIndex =
        this.#selectedOutputIndex !== null &&
        this.#selectedOutputIndex >= startIndex &&
        this.#selectedOutputIndex <= latestIndex
          ? this.#selectedOutputIndex
          : latestIndex;
      reconcile(outputList, items, {
        key: item => String(item.globalIndex),
        create: item =>
          createOutputItem(
            item.value,
            item.globalIndex,
            item.at - (firstFrameAt ?? item.at),
          ),
        update: (node, item) => {
          const selected = item.globalIndex === selectedIndex;
          node.classList.toggle("selected", selected);
          node.setAttribute("aria-selected", String(selected));
        },
      });
      // A run's sole value needs no selector chrome.
      outputList.hidden = solo || items.length === 0;

      const outputEditor = refs.find<JSONEditorElement>(".output-editor");
      if (outputEditor) {
        outputEditor.hidden = this.#outputs.length === 0;
        const position = selectedIndex - startIndex;
        const value = this.#outputs[position];
        if (
          this.#outputs.length > 0 &&
          this.#renderedOutputIndex !== selectedIndex
        ) {
          this.#renderedOutputIndex = selectedIndex;
          outputEditor.text = formatJSON(value);
        }
        if (this.#outputs.length === 0) this.#renderedOutputIndex = null;
      }
    }
    if (outputCount) {
      const plural = this.#outputCount === 1 ? "value" : "values";
      outputCount.textContent =
        this.#outputCount === 0
          ? ""
          : this.#running
            ? `${this.#outputCount} ${plural} · streaming…`
            : `${this.#outputCount} ${plural}`;
    }
    if (outputTiming) {
      const showTiming =
        this.#outputCount > 0 &&
        !this.#running &&
        this.#totalDurationMs !== null;
      outputTiming.hidden = !showTiming;
      outputTiming.textContent =
        showTiming && this.#totalDurationMs !== null
          ? formatDuration(this.#totalDurationMs)
          : "";
    }
    if (copyOutput) {
      copyOutput.hidden = this.#outputCount === 0;
      copyOutput.textContent = this.#copied ? "Copied" : "Copy";
      copyOutput.setAttribute(
        "aria-label",
        this.#copied ? "Copied" : "Copy output as JSON",
      );
    }
    if (clearOutput) {
      clearOutput.hidden =
        this.#outputCount === 0 && !this.#frameError && !this.#runtimeError;
      clearOutput.disabled = this.#running;
    }
    if (error) {
      const currentError = this.#frameError ?? this.#runtimeError;
      error.hidden = !currentError;
      const presentation = currentError
        ? presentInvocationError(currentError)
        : null;
      if (errorSummary) {
        errorSummary.textContent = presentation?.summary ?? "";
      }
      if (errorDetail) {
        errorDetail.textContent = presentation?.detail ?? "";
      }
      if (errorDetails) {
        errorDetails.hidden = !presentation?.detail;
      }
      this.#announceStatus(
        currentError && presentation
          ? `Invocation failed. ${presentation.summary}`
          : this.#running
            ? this.#outputCount > 0
              ? `Invocation running. ${this.#outputCount} value${
                  this.#outputCount === 1 ? "" : "s"
                } so far.`
              : "Invocation running."
            : this.#outputCount > 0
              ? `Invocation complete. ${this.#outputCount} output ${
                  this.#outputCount === 1 ? "value" : "values"
                } received.`
              : announcedStatus,
      );
    }
    this.#announceOutputCount();
  }

  /**
   * Mutates the binding selector to mirror the contract: one option per
   * binding of the current operation, shown only when there is a real choice
   * (two or more). Ordering is presentation only — descending declared
   * preference, entries without one last, ties lexicographic — and never
   * selects anything by itself: choosing a binding is the host's policy,
   * expressed through `bindingKey`.
   */
  #syncBindingSelector(
    bar: HTMLElement | null,
    select: HTMLSelectElement | null,
    operation: Operation,
  ): void {
    if (!bar || !select) return;
    const entries = operationBindingEntries(
      this.#obi,
      this.#operationKey,
      operation,
    );
    const show = entries.length >= 2;
    bar.hidden = !show;
    if (!show) return;

    const known =
      this.#bindingKey !== null &&
      entries.some(([key]) => key === this.#bindingKey);
    const placeholder = !known;
    const signature = [
      placeholder ? "\u0000placeholder" : "",
      ...entries.map(
        ([key, entry]) => `${key}\u0000${entry.deprecated ? "1" : "0"}`,
      ),
    ].join("\u0001");
    if (signature !== this.#bindingOptionsSignature) {
      this.#bindingOptionsSignature = signature;
      const options: HTMLOptionElement[] = [];
      if (placeholder) {
        const option = document.createElement("option");
        option.value = "";
        option.disabled = true;
        option.selected = true;
        option.textContent = "choose a binding…";
        options.push(option);
      }
      for (const [key, entry] of entries) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = entry.deprecated ? `${key} · deprecated` : key;
        options.push(option);
      }
      select.replaceChildren(...options);
    }
    select.value = known && this.#bindingKey !== null ? this.#bindingKey : "";
    select.disabled = this.#running;
    select.setAttribute(
      "aria-label",
      `Binding for ${this.#operationKey ?? "operation"}`,
    );
  }

  /** Dereferenced input schema analysis for the current oneOf selection. */
  #analyzeInput(operation: Operation): InputSchemaAnalysis {
    const schemas = this.#obi?.schemas as Record<string, unknown> | undefined;
    return analyzeInputSchema(operation.input, schemas, this.#oneOfIndex);
  }

  /** Input presentation state that must not leak across operations. */
  #resetInputPresentation(): void {
    this.#oneOfIndex = 0;
    this.#inputView = "json";
    this.#formRendered = null;
    this.#formModel = null;
    this.#shapeOptionsSignature = "";
  }

  #selectOneOfBranch(index: number): void {
    if (index === this.#oneOfIndex) return;
    this.#oneOfIndex = index;
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    if (operation && operation.input !== undefined && operation.input !== null) {
      // Switching shapes regenerates the starter for the chosen branch; the
      // previous branch's value cannot be assumed meaningful for this one.
      const sample = sampleFromSchema(
        this.#analyzeInput(operation).effective,
        this.#obi,
      );
      this.#inputTouched = false;
      this.#inputText = sample.available
        ? (JSON.stringify(sample.value, null, 2) ?? "")
        : "";
      this.#runtimeError = null;
      this.#emitInputChange();
    }
    this.requestRender();
  }

  /**
   * The input surface: Source/Form toggle, oneOf shape picker, and the two
   * panes. Form and JSON share `inputText` as the single source of truth —
   * form edits patch the JSON text through the same change pipeline the
   * editor uses, so `run()` and `ob-input-change` see one input path.
   */
  #syncInputPanel(
    refs: Refs,
    analysis: InputSchemaAnalysis | null,
    form: { capability: { supported: boolean; reason?: string }; model: SchemaFormModel | null },
    hasInput: boolean,
    showForm: boolean,
    starterAvailable: boolean,
  ): void {
    const toggle = refs.find(".input-view-toggle");
    const viewJson = refs.find<HTMLButtonElement>(".view-json");
    const viewForm = refs.find<HTMLButtonElement>(".view-form");
    const shapeBar = refs.find(".input-shape-bar");
    const shape = refs.find<HTMLSelectElement>(".input-shape");
    const formView = refs.find(".form-view");
    const formFields = refs.find<HTMLFieldSetElement>(".form-fields");
    const formStatus = refs.find(".form-status");
    const formStatusText = refs.find(".form-status-text");
    const bannerReset = refs.find<HTMLButtonElement>(".form-banner-reset");

    const sequence = this.#inputMode === "sequence";
    const blockedReason = sequence
      ? SEQUENCE_FORM_REASON
      : !form.capability.supported
        ? (form.capability.reason ?? "Form view is unavailable for this schema.")
        : null;

    if (toggle) toggle.hidden = !hasInput;
    if (viewJson) {
      viewJson.setAttribute("aria-pressed", String(!showForm));
    }
    if (viewForm) {
      viewForm.setAttribute("aria-pressed", String(showForm));
      viewForm.disabled = this.#running || blockedReason !== null;
      viewForm.title = blockedReason ?? "Edit as a schema-driven form";
    }

    if (shapeBar && shape) {
      const branches = analysis?.oneOfBranches ?? null;
      shapeBar.hidden = !hasInput || !branches;
      if (branches) {
        const signature = branches.map(branch => branch.label).join("");
        if (signature !== this.#shapeOptionsSignature) {
          this.#shapeOptionsSignature = signature;
          shape.replaceChildren(
            ...branches.map((branch, index) => {
              const option = document.createElement("option");
              option.value = String(index);
              option.textContent = branch.label;
              return option;
            }),
          );
        }
        shape.value = String(analysis?.clampedOneOfIndex ?? 0);
        shape.disabled = this.#running;
      }
    }

    if (formView) formView.hidden = !showForm;
    if (!showForm || !formView || !formFields || !formStatus || !formStatusText) {
      return;
    }

    // Decline-with-reason doctrine: every state where the form cannot render
    // is a visible banner with a way out, never a silent fallback.
    const banner = (message: string, offerReset: boolean): void => {
      formStatus.hidden = false;
      formStatusText.textContent = message;
      if (bannerReset) bannerReset.hidden = !offerReset || !starterAvailable;
      formFields.hidden = true;
      this.#formRendered = null;
    };

    if (blockedReason !== null) {
      banner(blockedReason, false);
      return;
    }
    const model = form.model;
    if (!model) {
      banner("Form view is unavailable for this schema.", false);
      return;
    }
    const parsed = parseJsonObjectInput(this.#inputText);
    if (parsed.error) {
      banner(
        `${parsed.error} Edit it as JSON or reset to the schema starter.`,
        true,
      );
      return;
    }
    if (parsed.payload && !conformsToSchema(parsed.payload, analysis?.effective)) {
      banner(
        "Current input doesn't match the operation's input schema, so it " +
          "can't be shown as a form. Edit it as JSON or reset to the schema starter.",
        true,
      );
      return;
    }

    formStatus.hidden = true;
    formFields.hidden = false;
    formFields.disabled = this.#running;
    const payload = parsed.payload ?? buildPayloadFromDefaults(model);
    const signature = `${this.#operationKey ?? ""}${
      analysis?.clampedOneOfIndex ?? 0
    }`;
    if (
      !this.#formRendered ||
      this.#formRendered.signature !== signature ||
      this.#formRendered.text !== this.#inputText
    ) {
      this.#rebuildForm(formFields, model, payload);
      this.#formRendered = { signature, text: this.#inputText };
    }
  }

  #rebuildForm(
    container: HTMLElement,
    model: SchemaFormModel,
    payload: Record<string, unknown>,
  ): void {
    if (model.fields.length === 0) {
      const none = document.createElement("p");
      none.className = "form-empty";
      none.textContent = "This operation's input declares no fields.";
      container.replaceChildren(none);
      return;
    }
    container.replaceChildren(
      ...model.fields.map(field =>
        this.#buildFieldRow(field, payload, field.path),
      ),
    );
  }

  #buildFieldRow(
    field: SchemaField,
    payload: Record<string, unknown>,
    path: Array<string | number>,
  ): HTMLElement {
    if (isPrimitiveField(field)) {
      return this.#buildPrimitiveRow(field, payload, path);
    }
    if (isObjectField(field)) {
      return this.#buildObjectRow(field, payload, path);
    }
    return this.#buildArrayRow(field, payload, path);
  }

  #buildPrimitiveRow(
    field: SchemaPrimitiveField,
    payload: Record<string, unknown>,
    path: Array<string | number>,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "form-row";
    row.setAttribute("part", "form-row");
    const id = fieldID(path);
    row.append(buildFieldLabel(field.label, field.required, id));
    if (field.description) row.append(buildFieldHelp(field.description));

    const current = getValueAtPath(payload, path);
    if (field.enumValues && field.enumValues.length > 0) {
      const select = document.createElement("select");
      select.id = id;
      if (!field.required) {
        const unset = document.createElement("option");
        unset.value = "";
        unset.textContent = "(unset)";
        select.append(unset);
      }
      for (const choice of field.enumValues) {
        const option = document.createElement("option");
        option.value = String(choice);
        option.textContent = String(choice);
        select.append(option);
      }
      select.value = current === undefined || current === null ? "" : String(current);
      select.addEventListener("change", () =>
        this.#applyPrimitive(field, path, select.value),
      );
      row.append(select);
      return row;
    }
    if (field.valueType === "boolean") {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.id = id;
      check.checked = Boolean(current);
      check.addEventListener("change", () =>
        this.#applyPrimitive(field, path, check.checked),
      );
      row.append(check);
      return row;
    }
    const input = document.createElement("input");
    input.id = id;
    input.type = field.valueType === "string" ? "text" : "number";
    if (field.valueType === "integer") input.step = "1";
    input.value = current === undefined || current === null ? "" : String(current);
    input.addEventListener("input", () =>
      this.#applyPrimitive(field, path, input.value),
    );
    row.append(input);
    return row;
  }

  #buildObjectRow(
    field: SchemaObjectField,
    payload: Record<string, unknown>,
    path: Array<string | number>,
  ): HTMLElement {
    const group = document.createElement("fieldset");
    group.className = "form-group";
    group.setAttribute("part", "form-row");
    const legend = document.createElement("legend");
    legend.append(field.label);
    if (field.required) legend.append(buildRequiredMark());
    group.append(legend);
    if (field.description) group.append(buildFieldHelp(field.description));
    if (field.fields.length === 0) {
      const none = document.createElement("p");
      none.className = "form-empty";
      none.textContent = "No nested fields.";
      group.append(none);
      return group;
    }
    for (const child of field.fields) {
      group.append(this.#buildFieldRow(child, payload, [...path, child.key]));
    }
    return group;
  }

  #buildArrayRow(
    field: SchemaField & { kind: "array" },
    payload: Record<string, unknown>,
    path: Array<string | number>,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "form-row form-array";
    row.setAttribute("part", "form-row");
    const header = document.createElement("div");
    header.className = "form-array-header";
    header.append(buildFieldLabel(field.label, field.required, null));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "form-add subtle";
    add.setAttribute("part", "form-add");
    add.textContent = "Add";
    add.setAttribute("aria-label", `Add ${field.label} item`);
    add.addEventListener("click", () => {
      const base = this.#formPayloadBase();
      let item = defaultForField(field.item);
      if (item === undefined) {
        item = isObjectField(field.item)
          ? {}
          : field.item.valueType === "boolean"
            ? false
            : field.item.valueType === "string"
              ? ""
              : 0;
      }
      this.#commitFormPayload(appendArrayItemAtPath(base, path, item), true);
    });
    header.append(add);
    row.append(header);
    if (field.description) row.append(buildFieldHelp(field.description));

    const items = getValueAtPath(payload, path);
    const entries = Array.isArray(items) ? items : [];
    if (entries.length === 0) {
      const none = document.createElement("p");
      none.className = "form-empty";
      none.textContent = "No items.";
      row.append(none);
      return row;
    }
    entries.forEach((_, index) => {
      const item = document.createElement("div");
      item.className = "form-array-item";
      const body = document.createElement("div");
      body.className = "item-body";
      if (isPrimitiveField(field.item)) {
        body.append(
          this.#buildFieldRow(field.item, payload, [...path, index]),
        );
      } else {
        const group = document.createElement("fieldset");
        group.className = "form-group";
        const legend = document.createElement("legend");
        legend.textContent = `Item ${index + 1}`;
        group.append(legend);
        for (const child of field.item.fields) {
          group.append(
            this.#buildFieldRow(child, payload, [...path, index, child.key]),
          );
        }
        body.append(group);
      }
      item.append(body);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "form-remove subtle";
      remove.setAttribute("part", "form-remove");
      remove.textContent = "Remove";
      remove.setAttribute(
        "aria-label",
        `Remove ${field.label} item ${index + 1}`,
      );
      remove.addEventListener("click", () => {
        this.#commitFormPayload(
          removeArrayItemAtPath(this.#formPayloadBase(), path, index),
          true,
        );
      });
      item.append(remove);
      row.append(item);
    });
    return row;
  }

  /** Panjir's primitive write semantics: empty clears optional, floors required. */
  #applyPrimitive(
    field: SchemaPrimitiveField,
    path: Array<string | number>,
    raw: string | boolean,
  ): void {
    const base = this.#formPayloadBase();
    if (field.valueType === "boolean") {
      this.#commitFormPayload(setValueAtPath(base, path, Boolean(raw)), false);
      return;
    }
    const text = String(raw);
    if (text === "") {
      if (field.required) {
        const fallback = field.valueType === "string" ? "" : 0;
        this.#commitFormPayload(setValueAtPath(base, path, fallback), false);
      } else {
        this.#commitFormPayload(unsetValueAtPath(base, path), false);
      }
      return;
    }
    if (field.valueType === "string") {
      this.#commitFormPayload(setValueAtPath(base, path, text), false);
      return;
    }
    const numeric = Number(text);
    if (Number.isNaN(numeric)) return;
    const value = field.valueType === "integer" ? Math.trunc(numeric) : numeric;
    this.#commitFormPayload(setValueAtPath(base, path, value), false);
  }

  #formPayloadBase(): Record<string, unknown> {
    const parsed = parseJsonObjectInput(this.#inputText);
    if (parsed.payload) return parsed.payload;
    if (this.#formModel) return buildPayloadFromDefaults(this.#formModel);
    return {};
  }

  /**
   * Every form edit lands in `inputText` — the same pipeline as typed JSON.
   * Value edits pre-sync the rebuild guard so the control keeps focus;
   * structural edits (array add/remove) leave it stale so the rows rebuild.
   */
  #commitFormPayload(
    next: Record<string, unknown>,
    structural: boolean,
  ): void {
    const text = payloadToPrettyJson(next);
    this.#inputTouched = true;
    this.#inputText = text;
    this.#runtimeError = null;
    if (!structural && this.#formRendered) {
      this.#formRendered = { ...this.#formRendered, text };
    }
    this.#emitInputChange();
    this.requestRender();
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
    if (!this.#inputTouched) {
      const sample = sampleFromSchema(operation.input, this.#obi);
      this.#inputText =
        sample.available ? (JSON.stringify(sample.value, null, 2) ?? "") : "";
    }
  }

  #clearResult(): void {
    this.#outputs = [];
    this.#outputTimes = [];
    this.#outputCount = 0;
    this.#selectedOutputIndex = null;
    this.#renderedOutputIndex = null;
    this.#firstFrameTime = null;
    this.#totalDurationMs = null;
    this.#lastAnnouncedOutputCount = 0;
    this.#frameError = null;
    this.#runtimeError = null;
    this.#copied = false;
    if (this.#copyTimer !== null) {
      clearTimeout(this.#copyTimer);
      this.#copyTimer = null;
    }
  }

  #announceStatus(message: string): void {
    if (!this.#statusAnnouncer || message === this.#lastStatusAnnouncement) {
      return;
    }
    this.#lastStatusAnnouncement = message;
    this.#statusAnnouncer.textContent = message;
  }

  #announceOutputCount(): void {
    if (
      !this.#outputAnnouncer ||
      this.#outputCount === this.#lastAnnouncedOutputCount
    ) {
      return;
    }
    this.#lastAnnouncedOutputCount = this.#outputCount;
    this.#outputAnnouncer.textContent =
      this.#outputCount === 0
        ? ""
        : `${this.#outputCount} output ${
            this.#outputCount === 1 ? "value" : "values"
          } received.`;
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

  #emitInputChange(): void {
    if (!this.#operationKey) return;
    this.emit<InvocationInputChangeDetail>("ob-input-change", {
      operationKey: this.#operationKey,
      text: this.#inputText,
      mode: this.#inputMode,
    });
  }
}

/**
 * The bindings of one operation in display order. A binding belongs to the
 * operation when its `operation` field names the operation key or any alias —
 * the key plus aliases form one flat namespace (OBI-T-12). Order: descending
 * numeric `preference`, entries without a preference last, ties broken
 * lexicographically by binding key. This order is presentation only; it is
 * not a selection policy.
 */
function operationBindingEntries(
  obi: OBInterface | null,
  operationKey: string | null,
  operation: Operation | undefined,
): Array<[string, BindingEntry]> {
  if (!obi?.bindings || !operationKey) return [];
  const names = new Set<string>([operationKey]);
  if (Array.isArray(operation?.aliases)) {
    for (const alias of operation.aliases) {
      if (typeof alias === "string") names.add(alias);
    }
  }
  const entries = Object.entries(obi.bindings).filter(([, entry]) =>
    names.has(entry.operation),
  );
  entries.sort(([keyA, entryA], [keyB, entryB]) => {
    const preferenceA =
      typeof entryA.preference === "number"
        ? entryA.preference
        : Number.NEGATIVE_INFINITY;
    const preferenceB =
      typeof entryB.preference === "number"
        ? entryB.preference
        : Number.NEGATIVE_INFINITY;
    if (preferenceA !== preferenceB) return preferenceB - preferenceA;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return entries;
}

const COPY_FEEDBACK_MS = 1600;
const PREVIEW_LIMIT = 80;

/** Stable, shadow-scoped control id for a payload path. */
function fieldID(path: Array<string | number>): string {
  return `f-${path.map(String).join("-")}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

function buildRequiredMark(): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "required";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "*";
  return mark;
}

function buildFieldLabel(
  text: string,
  required: boolean,
  forID: string | null,
): HTMLElement {
  const label = document.createElement(forID ? "label" : "span");
  label.className = "form-label";
  if (forID) (label as HTMLLabelElement).htmlFor = forID;
  label.append(text);
  if (required) label.append(buildRequiredMark());
  return label;
}

function buildFieldHelp(text: string): HTMLElement {
  const help = document.createElement("p");
  help.className = "form-help";
  help.textContent = text;
  return help;
}

/** Rounds a ratio to 0.1% so keyboard steps stay exact decimals. */
function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampSplitRatio(value: number): number {
  return roundRatio(
    Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value)),
  );
}

/** The document's root font size in px, for the rem-based narrow threshold. */
function rootFontSizePx(): number {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return 16;
  }
  const size = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * Devtools-style duration scaling: whole milliseconds under a second, seconds
 * to one decimal (trailing .0 trimmed) under a minute, then "1m 23s". The
 * branch is chosen after rounding at each granularity, so 999.6ms reads "1s"
 * (never "1000ms") and 59.96s reads "1m 0s" (never "60s"). Non-finite and
 * negative input clamp to "0ms".
 */
export function formatDuration(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const wholeMs = Math.round(clamped);
  if (wholeMs < 1000) return `${wholeMs}ms`;
  const deciseconds = Math.round(clamped / 100);
  if (deciseconds < 600) {
    const text = (deciseconds / 10).toFixed(1);
    return `${text.endsWith(".0") ? text.slice(0, -2) : text}s`;
  }
  const totalSeconds = Math.round(clamped / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/** One line of compact JSON for a block's summary, truncated with an ellipsis. */
function previewValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT - 1)}…`
    : text;
}

/**
 * Builds one selector row for the output strip. Runs exactly once per
 * received frame — the preview is stringified here and never re-rendered —
 * which keeps a stream's per-frame cost independent of how much output is
 * already retained. The value itself renders in the shared output editor.
 */
function createOutputItem(
  value: unknown,
  globalIndex: number,
  offsetMs: number,
): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "output-item";
  item.setAttribute("part", "output-item");
  item.setAttribute("role", "option");
  item.dataset.globalIndex = String(globalIndex);
  const index = document.createElement("span");
  index.className = "output-item-index";
  index.textContent = `#${globalIndex + 1}`;
  const offset = document.createElement("span");
  offset.className = "output-item-offset";
  offset.textContent = `+${formatDuration(offsetMs)}`;
  const preview = document.createElement("span");
  preview.className = "output-item-preview";
  preview.textContent = previewValue(value);
  item.append(index, offset, preview);
  return item;
}

/** Selection-based clipboard fallback for engines without navigator.clipboard. */
function copyThroughSelection(text: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.append(scratch);
  scratch.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  scratch.remove();
  return copied;
}

const UNDESCRIBED_ERROR_SUMMARY =
  "The invoker reported an error it did not describe.";

/**
 * ERR_CONNECT_FAILED is the invoker transport failing, not the target: the
 * workbench never reached the point of talking to the target, and from a
 * browser a rejected or expired session credential produces exactly the same
 * failed fetch. The copy therefore names the invoker and hints at both causes
 * instead of blaming "the target".
 */
const CONNECT_FAILED_SUMMARY =
  "Could not reach the operation invoker. From the browser, a rejected " +
  "session credential looks identical to a network failure, so check the " +
  "invoker connection and its credentials.";

/**
 * Copy keyed by the contract's classification axis — `category` on
 * InvocationError (see requirements/operation-invoker.json), which consumers
 * branch on before any error code. The contract spells the caller-ended
 * category "cancelled"; the American spelling is accepted defensively, as is
 * the conventional "unsupported". `context` is deliberately absent here: it
 * is the resolve-and-retry hinge and reads best through its normative code,
 * CONTEXT_REQUIRED, in the code map below.
 */
const CATEGORY_SUMMARIES: Record<string, string> = {
  auth: "The target rejected the supplied credentials.",
  service: "The target returned an error.",
  transient: "The target or invoker could not be reached — retrying may help.",
  validation: "A value did not match the operation contract.",
  protocol: "The invocation violated the invoker protocol contract.",
  permanent: "The operation failed permanently — retrying will not help.",
  unsupported: "The invoker does not support this operation.",
  cancelled: "The operation was cancelled.",
  canceled: "The operation was cancelled.",
};

/** Fallback copy for well-known codes when the category does not decide. */
const CODE_SUMMARIES: Record<string, string> = {
  CONTEXT_REQUIRED:
    "This operation needs credentials or other invocation context.",
  ERR_VALIDATION_FAILED: "A value did not match the operation contract.",
  ERR_TIMEOUT: "The operation timed out.",
  ERR_CANCELLED: "The operation was cancelled.",
  ERR_CONNECT_FAILED: CONNECT_FAILED_SUMMARY,
  ERR_UNAVAILABLE: "The target could not be reached.",
};

export function presentInvocationError(
  error: OperationFrameError | Error,
): { summary: string; detail: string } {
  const frame = error as Partial<OperationFrameError>;
  const code = typeof frame.code === "string" ? frame.code : "";
  const category = typeof frame.category === "string" ? frame.category : "";
  const message = typeof frame.message === "string" ? frame.message.trim() : "";

  if (!code && !category) {
    // Plain runtime Errors and malformed frame errors alike: the message is
    // all there is, and an empty one must never leave the summary blank.
    return { summary: message || UNDESCRIBED_ERROR_SUMMARY, detail: "" };
  }

  const classification =
    code === "ERR_CONNECT_FAILED"
      ? CONNECT_FAILED_SUMMARY
      : (CATEGORY_SUMMARIES[category] ??
        CODE_SUMMARIES[code] ??
        "The operation could not be completed.");
  // The server's human-readable message is part of the visible summary, not
  // something buried behind the details disclosure.
  const summary = message ? `${classification} ${message}` : classification;
  return {
    summary,
    detail: `${code || "(no code)"}: ${message || "(no message)"}`,
  };
}

type SchemaSample =
  | { available: true; value: unknown }
  | { available: false };

function sampleFromSchema(
  schema: unknown,
  root: OBInterface | null,
  seen = new Set<unknown>(),
  depth = 0,
): SchemaSample {
  if (schema === true) return { available: true, value: null };
  if (
    schema === false ||
    schema === null ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    depth > 12 ||
    seen.has(schema)
  ) {
    return { available: false };
  }
  seen.add(schema);
  const value = schema as Record<string, unknown>;

  if (Object.hasOwn(value, "const")) {
    return { available: true, value: structuredClone(value.const) };
  }
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    return { available: true, value: structuredClone(value.enum[0]) };
  }
  if (Object.hasOwn(value, "default")) {
    return { available: true, value: structuredClone(value.default) };
  }
  if (Array.isArray(value.examples) && value.examples.length > 0) {
    return { available: true, value: structuredClone(value.examples[0]) };
  }
  if (typeof value.$ref === "string") {
    const resolved = resolveLocalReference(root, value.$ref);
    if (resolved !== undefined) {
      return sampleFromSchema(resolved, root, seen, depth + 1);
    }
  }
  if (Array.isArray(value.allOf)) {
    let combined: unknown;
    let hasCombined = false;
    for (const alternative of value.allOf) {
      const sample = sampleFromSchema(
        alternative,
        root,
        new Set(seen),
        depth + 1,
      );
      if (!sample.available) return { available: false };
      if (!hasCombined) {
        combined = structuredClone(sample.value);
        hasCombined = true;
      } else if (isRecord(combined) && isRecord(sample.value)) {
        combined = { ...combined, ...sample.value };
      } else if (JSON.stringify(combined) !== JSON.stringify(sample.value)) {
        return { available: false };
      }
    }
    // An empty allOf imposes no constraint, so null is a valid conservative
    // starter. A non-empty allOf must produce compatible evidence above.
    return { available: true, value: hasCombined ? combined : null };
  }
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const alternatives = value[keyword];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) {
      const sample = sampleFromSchema(alternative, root, seen, depth + 1);
      if (sample.available) return sample;
    }
  }

  const types = Array.isArray(value.type) ? value.type : [value.type];
  if (
    [
      "not",
      "if",
      "dependentSchemas",
      "dependentRequired",
      "patternProperties",
      "propertyNames",
      "contains",
    ].some(keyword => Object.hasOwn(value, keyword))
  ) {
    return { available: false };
  }
  if (types.includes("object") || isRecord(value.properties)) {
    const properties = isRecord(value.properties) ? value.properties : {};
    const required = new Set(
      Array.isArray(value.required)
        ? value.required.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    );
    const result: Record<string, unknown> = {};
    for (const key of required) {
      if (!Object.hasOwn(properties, key)) return { available: false };
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      const sample = sampleFromSchema(
        propertySchema,
        root,
        new Set(seen),
        depth + 1,
      );
      if (required.has(key) && !sample.available) {
        return { available: false };
      }
      if (sample.available && (required.has(key) || hasSuggestedValue(propertySchema))) {
        result[key] = sample.value;
      }
    }
    return { available: true, value: result };
  }
  if (types.includes("array")) {
    const minimum =
      typeof value.minItems === "number" && value.minItems > 0
        ? Math.ceil(value.minItems)
        : 0;
    if (minimum === 0) return { available: true, value: [] };
    const itemSchema = value.items;
    if (itemSchema === undefined) return { available: false };
    const item = sampleFromSchema(itemSchema, root, new Set(seen), depth + 1);
    return item.available
      ? {
          available: true,
          value: Array.from({ length: minimum }, () =>
            structuredClone(item.value),
          ),
        }
      : { available: false };
  }
  if (types.includes("string")) {
    if (typeof value.pattern === "string") return { available: false };
    const minimum =
      typeof value.minLength === "number" && value.minLength > 0
        ? Math.ceil(value.minLength)
        : 0;
    if (
      typeof value.maxLength === "number" &&
      minimum > Math.floor(value.maxLength)
    ) {
      return { available: false };
    }
    return { available: true, value: "x".repeat(minimum) };
  }
  if (types.includes("integer")) {
    const floor =
      typeof value.exclusiveMinimum === "number"
        ? Math.floor(value.exclusiveMinimum) + 1
        : typeof value.minimum === "number"
          ? Math.ceil(value.minimum)
          : 0;
    const ceiling =
      typeof value.exclusiveMaximum === "number"
        ? Math.ceil(value.exclusiveMaximum) - 1
        : typeof value.maximum === "number"
          ? Math.floor(value.maximum)
          : Number.POSITIVE_INFINITY;
    return floor <= ceiling
      ? { available: true, value: floor }
      : { available: false };
  }
  if (types.includes("number")) {
    const exclusiveMinimum =
      typeof value.exclusiveMinimum === "number"
        ? value.exclusiveMinimum
        : null;
    const floor =
      exclusiveMinimum !== null
        ? exclusiveMinimum +
          Math.max(1, Math.abs(exclusiveMinimum)) * Number.EPSILON
        : typeof value.minimum === "number"
          ? value.minimum
          : 0;
    const maximum =
      typeof value.exclusiveMaximum === "number"
        ? value.exclusiveMaximum
        : typeof value.maximum === "number"
          ? value.maximum
          : Number.POSITIVE_INFINITY;
    const validMaximum =
      typeof value.exclusiveMaximum === "number"
        ? floor < maximum
        : floor <= maximum;
    return validMaximum
      ? { available: true, value: floor }
      : { available: false };
  }
  if (types.includes("boolean")) return { available: true, value: false };
  if (types.includes("null")) return { available: true, value: null };
  return { available: false };
}

function hasSuggestedValue(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  return (
    Object.hasOwn(schema, "default") ||
    Object.hasOwn(schema, "const") ||
    (Array.isArray(schema.examples) && schema.examples.length > 0) ||
    (Array.isArray(schema.enum) && schema.enum.length > 0)
  );
}

function resolveLocalReference(
  root: OBInterface | null,
  ref: string,
): unknown {
  if (!root || !ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const rawToken of ref.slice(2).split("/")) {
    if (!isRecord(current)) return undefined;
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    current = current[token];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

/**
 * The workbench shell, parsed once. Every subsequent render mutates these
 * nodes rather than replacing them, so the input editor keeps its caret,
 * selection and scroll position while output streams in beside it.
 */
const CONTENT_SHELL = `
  <div class="render-root"><section class="container" part="container" aria-label="Operation invocation workbench">
         <header>
           <div class="identity">
             <p class="eyebrow">Invocation</p>
             <h2></h2>
           </div>
           <div class="header-tools">
             <span class="binding-bar" part="binding-bar" hidden>
               <span aria-hidden="true">via</span>
               <select class="binding-select" part="binding-select"></select>
             </span>
             <span class="status" part="status"></span>
           </div>
         </header>
         <div class="empty" part="empty"></div>
         <div class="workspace">
           <section class="input-column">
             <div class="section-heading">
               <h3>Input</h3>
               <div class="input-options">
                 <span class="input-hint"></span>
                 <span class="input-view-toggle" part="input-mode-toggle" role="group" aria-label="Input editing view" hidden>
                   <button class="view-json subtle" type="button" aria-pressed="true">Source</button>
                   <button class="view-form subtle" type="button" aria-pressed="false">Form</button>
                 </span>
                 <button class="format-input subtle" part="format-input" type="button">Format JSON</button>
                 <button class="reset-input subtle" part="reset-input" type="button">Reset starter</button>
                 <label>
                   <span class="sr-only">Input cardinality</span>
                   <select class="input-mode" part="input-mode" aria-label="Input cardinality">
                     <option value="single">One value</option>
                     <option value="sequence">Value sequence</option>
                   </select>
                 </label>
               </div>
             </div>
             <div class="input-shape-bar" hidden>
               <label class="input-shape-row">
                 <span class="input-shape-label">Input shape</span>
                 <select class="input-shape" part="input-shape"></select>
               </label>
             </div>
             <ob-json-editor part="input" class="input-editor"></ob-json-editor>
             <div class="form-view" hidden>
               <div class="form-status" hidden>
                 <p class="form-status-text"></p>
                 <div class="form-status-actions">
                   <button class="form-banner-json subtle" type="button">Edit as JSON</button>
                   <button class="form-banner-reset subtle" type="button">Reset starter</button>
                 </div>
               </div>
               <fieldset class="form-fields"></fieldset>
             </div>
             <div class="actions">
               <button class="run" part="run" type="button">Run</button>
               <button class="cancel" part="cancel" type="button">Cancel</button>
             </div>
           </section>
           <div class="layout-gutter" part="layout-gutter" role="separator" aria-orientation="vertical" aria-label="Resize input and output" aria-valuemin="20" aria-valuemax="80" tabindex="0" hidden>
             <span class="layout-gutter-handle" aria-hidden="true"></span>
           </div>
           <section class="output-column">
             <div class="section-heading">
               <h3>Output</h3>
               <div class="output-options">
                 <span class="output-count"></span>
                 <span class="output-timing" part="output-timing" hidden></span>
                 <button class="copy-output subtle" part="copy-output" type="button" aria-label="Copy output as JSON" hidden>Copy</button>
                 <button class="clear-output subtle" part="clear-output" type="button">Clear</button>
               </div>
             </div>
             <div class="output-view" part="output-view">
               <p class="output-notice">No output yet.</p>
               <div class="output-list" role="listbox" aria-label="Output values" hidden></div>
               <ob-json-editor class="output-editor" part="output" hidden></ob-json-editor>
             </div>
             <div class="error" part="error" role="alert">
               <p class="error-summary"></p>
               <details>
                 <summary>Technical details</summary>
                 <pre class="error-detail"></pre>
               </details>
             </div>
           </section>
         </div>
       </section></div>
  <div class="live-announcers">
    <span class="status-announcer" role="status" aria-live="polite" aria-atomic="true"></span>
    <span class="output-announcer" aria-live="polite" aria-atomic="true"></span>
  </div>
`;

const styles = `
  .render-root {
    height: 100%;
    min-height: 0;
  }

  .live-announcers,
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .container {
    min-height: 18rem;
    padding: calc(var(--_ob-space) * 1.5);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  /* Split mode is a non-scrolling cockpit: header rows keep natural height,
     the exec grid takes ALL remaining height, and only the input editor and
     the output view scroll internally. Without a definite host height every
     percentage resolves to auto and the min-height floors below keep the
     cockpit usable instead of collapsing. */
  .container.split {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  :host([hide-identity]) header > .identity,
  :host([hide-identity]) header .status {
    display: none;
  }

  /* With the identity hidden the header row is just the tools; right-align
     them without the vanished block's flex partner — and when the binding
     bar is hidden too (single-binding operations) the row vanishes rather
     than reserving an empty band. The host strip carries the status. */
  :host([hide-identity]) header {
    justify-content: flex-end;
  }

  :host([hide-identity]) header:not(:has(.binding-bar:not([hidden]))) {
    display: none;
  }

  header, .section-heading, .actions, .input-options, .output-options {
    display: flex;
    gap: var(--_ob-space);
    align-items: center;
    justify-content: space-between;
  }

  .eyebrow, h2, h3 {
    margin: 0;
  }

  .eyebrow {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2 {
    overflow-wrap: anywhere;
    font: 650 1rem / 1.3 var(--_ob-font-mono);
  }

  h3 {
    font-size: 0.78rem;
  }

  .status {
    padding: 0.18rem 0.48rem;
    color: var(--_ob-color-text-muted);
    background: var(--_ob-color-surface);
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .status.available {
    color: var(--_ob-color-success);
  }

  .status.ambiguous,
  .status.failed {
    color: var(--_ob-color-danger);
  }

  .workspace {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
    gap: var(--_ob-space);
    margin-top: calc(var(--_ob-space) * 1.5);
  }

  .workspace.split {
    flex: 1 1 0;
    min-height: 22rem;
    grid-template-columns:
      minmax(0, var(--_ob-split-input, 1fr))
      auto
      minmax(0, var(--_ob-split-output, 1fr));
    grid-template-rows: minmax(0, 1fr);
  }

  .workspace.split .input-column,
  .workspace.split .output-column {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .workspace.split .input-editor {
    display: block;
    flex: 1 1 0;
    min-height: 13rem;
  }

  .workspace.split .form-view {
    flex: 1 1 0;
    min-height: 13rem;
    max-height: none;
  }

  .workspace.split .output-view {
    flex: 1 1 0;
    min-height: 13rem;
    max-height: none;
  }

  .input-column, .output-column {
    min-width: 0;
  }

  .layout-gutter {
    display: flex;
    align-items: stretch;
    justify-content: center;
    width: 0.65rem;
    cursor: col-resize;
    touch-action: none;
    border-radius: 999px;
  }

  .layout-gutter-handle {
    width: 3px;
    background: transparent;
    border-radius: 999px;
  }

  .layout-gutter:hover .layout-gutter-handle,
  .layout-gutter:focus-visible .layout-gutter-handle,
  .layout-gutter.dragging .layout-gutter-handle {
    background: var(--_ob-color-border);
  }

  .layout-gutter:focus-visible {
    outline: none;
    box-shadow: var(--_ob-focus-ring);
  }

  .section-heading {
    margin-bottom: 0.45rem;
  }

  .input-hint, .output-count {
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
  }

  .input-options {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .output-options {
    justify-content: flex-end;
  }

  .header-tools {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--_ob-space) * 0.75);
    align-items: center;
    justify-content: flex-end;
  }

  .binding-bar {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
  }

  .input-mode,
  .binding-select,
  .input-shape {
    min-height: 1.8rem;
    padding: 0.2rem 0.35rem;
    color: var(--_ob-color-text);
    font: inherit;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .input-view-toggle {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .input-view-toggle button {
    min-height: 1.8rem;
    padding: 0.2rem 0.5rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    background: var(--_ob-color-background);
    border: 0;
    border-radius: 0;
  }

  .input-view-toggle button + button {
    border-left: 1px solid var(--_ob-color-border);
  }

  .input-view-toggle button[aria-pressed="true"] {
    color: var(--_ob-color-accent-contrast);
    background: var(--_ob-color-accent);
  }

  .input-shape-bar {
    margin-bottom: 0.45rem;
  }

  .input-shape-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
  }

  .input-shape {
    flex: 1;
    min-width: 0;
    font-family: var(--_ob-font-mono);
  }

  .form-view {
    min-height: 13rem;
    max-height: 26rem;
    padding: var(--_ob-space);
    overflow: auto;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .form-fields {
    min-width: 0;
    padding: 0;
    margin: 0;
    border: 0;
  }

  .form-row {
    min-width: 0;
    margin-bottom: 0.6rem;
  }

  .form-row:last-child {
    margin-bottom: 0;
  }

  .form-label {
    display: block;
    margin-bottom: 0.2rem;
    color: var(--_ob-color-text);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .required {
    margin-left: 0.15rem;
    color: var(--_ob-color-danger);
  }

  .form-help {
    display: -webkit-box;
    margin: 0 0 0.25rem;
    overflow: hidden;
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .form-row input[type="text"],
  .form-row input[type="number"],
  .form-row select {
    width: 100%;
    min-height: 1.8rem;
    padding: 0.2rem 0.35rem;
    color: var(--_ob-color-text);
    font: inherit;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .form-group {
    min-width: 0;
    margin: 0 0 0.6rem;
    padding: 0.45rem 0.55rem;
    border: 1px dashed var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.8);
  }

  .form-group legend {
    padding: 0 0.25rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
  }

  .form-array-header {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    justify-content: space-between;
  }

  .form-array-item {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    margin-top: 0.4rem;
  }

  .form-array-item > .item-body {
    flex: 1;
    min-width: 0;
  }

  .form-empty {
    margin: 0.15rem 0 0;
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
    font-style: italic;
  }

  .form-status {
    padding: 0.65rem 0.75rem;
    margin-bottom: 0.6rem;
    color: var(--_ob-color-text);
    font-size: 0.74rem;
    background: var(--_ob-color-surface-strong);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .form-status-text {
    margin: 0 0 0.4rem;
  }

  .form-status-actions {
    display: flex;
    gap: 0.4rem;
  }

  .binding-select {
    max-width: 16rem;
    font-family: var(--_ob-font-mono);
  }

  .binding-select:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  pre {
    margin: 0;
    overflow: auto;
    color: var(--_ob-color-text);
    font: 0.76rem / 1.5 var(--_ob-font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Selector strip above, one shared code view below (rev 17.4). */
  .output-view {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 13rem;
    max-height: 26rem;
    overflow: hidden;
    background: var(--_ob-code-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .output-notice {
    margin: 0;
    padding: var(--_ob-space);
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
  }

  .output-notice:empty,
  .output-notice[hidden] {
    display: none;
  }

  .output-list {
    max-height: 9rem;
    overflow: auto;
    border-bottom: 1px solid var(--_ob-color-border);
  }

  .output-list[hidden] {
    display: none;
  }

  .output-item {
    display: flex;
    width: 100%;
    gap: 0.45rem;
    align-items: center;
    min-height: 0;
    padding: 0.3rem 0.5rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.7rem;
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--_ob-color-border);
    border-radius: 0;
    cursor: pointer;
  }

  .output-item:last-child {
    border-bottom: 0;
  }

  .output-item.selected {
    color: var(--_ob-color-text);
    background: var(--_ob-color-background);
    box-shadow: inset 2px 0 var(--_ob-color-accent);
  }

  .output-item-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-family: var(--_ob-font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .output-item-offset,
  .output-timing {
    padding: 0.05rem 0.4rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.66rem;
    white-space: nowrap;
    border: 1px solid var(--_ob-color-border);
    border-radius: 999px;
  }

  .output-editor {
    display: block;
    min-width: 0;
    min-height: 0;
  }

  .output-editor::part(container) {
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .output-editor[hidden] {
    display: none;
  }

  .actions {
    justify-content: flex-start;
    margin-top: var(--_ob-space);
  }

  button {
    min-height: 2.25rem;
    padding: 0.42rem 0.8rem;
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
    cursor: pointer;
  }

  button.subtle {
    min-height: 1.8rem;
    padding: 0.2rem 0.42rem;
    color: var(--_ob-color-text-muted);
    background: var(--_ob-color-background);
    font-size: 0.68rem;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .run {
    color: var(--_ob-color-accent-contrast);
    background: var(--_ob-color-accent);
    border-color: var(--_ob-color-accent);
  }

  .cancel {
    color: var(--_ob-color-danger);
    background: var(--_ob-color-background);
  }

  .error {
    padding: 0.65rem 0.75rem;
    margin-top: var(--_ob-space);
    color: var(--_ob-color-danger);
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--_ob-color-danger) 7%, var(--_ob-color-background));
    border: 1px solid color-mix(in srgb, var(--_ob-color-danger) 22%, var(--_ob-color-border));
    border-radius: var(--_ob-radius);
  }

  .error-summary {
    margin: 0;
    font-weight: 600;
  }

  .error details {
    margin-top: 0.4rem;
    color: var(--_ob-color-text-muted);
  }

  .error summary {
    cursor: pointer;
    font-size: 0.72rem;
  }

  .error-detail {
    max-height: 10rem;
    min-height: 0;
    padding: 0.55rem;
    margin: 0.4rem 0 0;
    overflow: auto;
    color: var(--_ob-color-text);
    white-space: pre-wrap;
    background: var(--_ob-code-surface);
    border-radius: calc(var(--_ob-radius) * 0.8);
  }

  .empty {
    display: grid;
    min-height: 12rem;
    place-items: center;
    color: var(--_ob-color-text-muted);
    text-align: center;
  }
`;
