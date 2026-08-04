import type { OBInterface, Operation } from "@openbindings/sdk";
import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
  reconcile,
  setTextIfChanged,
} from "@openbindings/ui-core";

export const OBI_EXPLORER_TAG = "ob-obi-explorer";

export interface OperationSelectDetail {
  operationKey: string;
  operation: Operation;
}

export interface FilterChangeDetail {
  filter: string;
  visibleCount: number;
  totalCount: number;
}

export interface OBIExplorerEventMap {
  "ob-operation-select": CustomEvent<OperationSelectDetail>;
  "ob-filter-change": CustomEvent<FilterChangeDetail>;
}

export class OBIExplorerElement extends OpenBindingsElement {
  static readonly observedAttributes = ["hide-identity", "flow-content"];

  #obi: OBInterface | null = null;
  #selectedOperation: string | null = null;
  #filter = "";
  #hideIdentity = false;
  #flowContent = false;
  #descriptionExpanded = false;
  #sortedFor: OBInterface | null = null;
  #sorted: [string, Operation][] = [];
  #haystacks = new Map<string, string>();
  #visible: [string, Operation][] = [];
  #aliasHits = new Map<string, string>();
  // Roving-tabindex state: the row that last held focus, and the row currently
  // carrying the single tabIndex=0 stop (they differ when the focused row is
  // filtered out of the visible set).
  #focusedKey: string | null = null;
  #rovingKey: string | null = null;
  // Detached row nodes kept per operation key so widening or clearing the
  // filter reuses nodes instead of recreating them. Cleared on document swap.
  #rowCache = new Map<string, HTMLElement>();
  #descriptionObserver: ResizeObserver | null = null;
  #announcedCount: number | null = null;
  #visibleSignature: string | null = null;
  #userFiltered = false;
  #pendingSelectionScroll = false;

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.#descriptionExpanded = false;
    if (
      this.#selectedOperation &&
      !Object.hasOwn(value?.operations ?? {}, this.#selectedOperation)
    ) {
      this.#selectedOperation = null;
    }
    this.requestRender();
  }

  get selectedOperation(): string | null {
    return this.#selectedOperation;
  }

  set selectedOperation(value: string | null) {
    if (value === this.#selectedOperation) return;
    this.#selectedOperation = value;
    // Programmatic selection (deep-link restore) may target a row far outside
    // the scroll viewport; user clicks are necessarily already in view, so the
    // click path sets the field directly and never schedules a scroll.
    this.#pendingSelectionScroll = value !== null;
    this.requestRender();
  }

  get filter(): string {
    return this.#filter;
  }

  set filter(value: string) {
    const normalized = value ?? "";
    if (normalized === this.#filter) return;
    this.#filter = normalized;
    this.requestRender();
  }

  /**
   * Hides the interface name/version identity row. For hosts that already
   * present the document's identity elsewhere (the workbench document bar),
   * so the same title is never painted twice. The description blurb and the
   * operation count badge are unaffected.
   */
  get hideIdentity(): boolean {
    return this.#hideIdentity;
  }

  set hideIdentity(value: boolean) {
    const next = Boolean(value);
    if (next === this.#hideIdentity) return;
    this.#hideIdentity = next;
    this.toggleAttribute("hide-identity", next);
    this.requestRender();
  }

  /**
   * Master-pane mode (rev 15.1, panjir's pattern): the element does not
   * scroll internally — its height is its content height, so a host-owned
   * rail scroller carries the scrolling. The filter row and an "Operations"
   * section heading become sticky and pin against that outer scroller. The
   * heading's offset stacks below the filter; both are tunable by the host
   * via --ob-rail-sticky-top (base offset, default 0) and
   * --ob-rail-filter-height (the filter row's pinned height).
   */
  get flowContent(): boolean {
    return this.#flowContent;
  }

  set flowContent(value: boolean) {
    const next = Boolean(value);
    if (next === this.#flowContent) return;
    this.#flowContent = next;
    this.toggleAttribute("flow-content", next);
    this.requestRender();
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    newValue: string | null,
  ): void {
    if (name === "hide-identity") this.hideIdentity = newValue !== null;
    if (name === "flow-content") this.flowContent = newValue !== null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The description observer is disconnected on disconnect; render() lazily
    // recreates it, and connectedCallback queues that render, so a re-inserted
    // element resumes measuring without any extra bookkeeping here.
  }

  disconnectedCallback(): void {
    this.#descriptionObserver?.disconnect();
    this.#descriptionObserver = null;
  }

  protected override bind(refs: Refs): void {
    const input = refs.require<HTMLInputElement>('input[type="search"]');
    input.addEventListener("input", () => {
      if (input.value === this.#filter) return;
      this.#filter = input.value;
      // Only user edits report outward; programmatic `filter` assignment is
      // the application talking to the element and must not echo back.
      this.#userFiltered = true;
      this.requestRender();
    });

    // The filter input is its own Tab stop immediately before the list;
    // ArrowDown hands focus to the list's single roving stop.
    input.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      this.#focusRow(this.#rovingKey);
    });

    refs.require(".description-toggle").addEventListener("click", () => {
      this.#descriptionExpanded = !this.#descriptionExpanded;
      this.requestRender();
    });

    // One delegated listener for the whole list, so the per-operation cost of
    // a render is a few attribute writes rather than a node plus a closure.
    const list = refs.require("ul");
    list.addEventListener("click", event => {
      const key = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "li[data-ob-key]",
      )?.dataset.obKey;
      const operation = key ? this.#obi?.operations[key] : undefined;
      if (!key || !operation) return;
      this.#selectedOperation = key;
      this.requestRender();
      this.emit<OperationSelectDetail>("ob-operation-select", {
        operationKey: key,
        operation,
      });
    });

    // APG listbox-style keyboard model over native buttons. The rows stay
    // real <button>s (no role="option" / aria-selected): native buttons give
    // activation semantics, correct accessible names and focusability for
    // free, and a roving tabindex is enough to collapse the list into one Tab
    // stop — a listbox role would instead force us to re-implement selection
    // and activation semantics by hand.
    list.addEventListener("keydown", event => this.#handleListKeydown(event));
    list.addEventListener("focusin", event => {
      const key = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "li[data-ob-key]",
      )?.dataset.obKey;
      if (key && key !== this.#focusedKey) {
        this.#focusedKey = key;
        this.#applyRoving();
      }
    });
  }

  protected render(): void {
    const refs = this.shell(SHELL, baseStyles, styles);
    if (!refs) return;

    const title = refs.require("h2");
    const version = refs.require(".version");
    const identity = refs.require<HTMLElement>(".identity");
    // Only the name/version row hides; the count badge and description stay.
    identity.hidden = this.#hideIdentity;
    const description = refs.require(".description");
    const descriptionBlock = refs.require(".description-block");
    const descriptionToggle = refs.require(".description-toggle");
    const count = refs.require(".count");
    const status = refs.require(".filter-status");
    const input = refs.require<HTMLInputElement>('input[type="search"]');
    const empty = refs.require(".empty");
    const list = refs.require("ul");

    const operationsHeading = refs.require<HTMLElement>(".operations-heading");
    const operationsCount = refs.require(".operations-count");

    if (!this.#obi) {
      setTextIfChanged(title, "No interface");
      setTextIfChanged(version, "");
      setTextIfChanged(count, "0");
      operationsHeading.hidden = true;
      setTextIfChanged(status, "");
      descriptionBlock.hidden = true;
      input.disabled = true;
      empty.hidden = false;
      setTextIfChanged(
        empty,
        "Assign an OBI document to explore its operations.",
      );
      list.hidden = true;
      reconcile(list, [], { key: () => "", create: () => document.createElement("li") });
      this.#visible = [];
      this.#rovingKey = null;
      return;
    }

    input.disabled = false;
    setTextIfChanged(title, this.#obi.name ?? "OpenBindings interface");
    setTextIfChanged(
      version,
      [
        this.#obi.version ? `v${this.#obi.version}` : "",
        `OBI ${this.#obi.openbindings}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );

    setTextIfChanged(description, this.#obi.description ?? "");
    description.classList.toggle("expanded", this.#descriptionExpanded);
    descriptionBlock.hidden = !this.#obi.description;
    setTextIfChanged(
      descriptionToggle,
      this.#descriptionExpanded ? "Show less" : "Show more",
    );
    descriptionToggle.setAttribute(
      "aria-label",
      this.#descriptionExpanded
        ? "Collapse interface description"
        : "Show full interface description",
    );
    this.#updateDescriptionToggle();
    // Re-measure on resize: a description that fits at one width can clamp at
    // another. Recreated lazily so a disconnect/reconnect cycle resumes
    // observing (disconnectedCallback tears the observer down).
    if (!this.#descriptionObserver && typeof ResizeObserver === "function") {
      this.#descriptionObserver = new ResizeObserver(() =>
        this.#updateDescriptionToggle(),
      );
      this.#descriptionObserver.observe(description);
    }

    // The sorted operation list only changes when the document does, so it is
    // computed once per document rather than once per selection change. The
    // row-node cache and keyboard focus memory are keyed to the document too.
    if (this.#obi !== this.#sortedFor) {
      this.#sortedFor = this.#obi;
      this.#sorted = Object.entries(this.#obi.operations).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      this.#haystacks = new Map(
        this.#sorted.map(([key, operation]) => [
          key,
          [
            key,
            operation.description ?? "",
            ...(operation.aliases ?? []),
            ...(operation.tags ?? []),
          ]
            .join("\n")
            .toLocaleLowerCase(),
        ]),
      );
      this.#rowCache.clear();
      this.#focusedKey = null;
    }

    const query = this.#filter.trim().toLocaleLowerCase();
    const visible = query
      ? this.#sorted.filter(([key]) =>
          (this.#haystacks.get(key) ?? "").includes(query),
        )
      : this.#sorted;
    this.#visible = visible;

    // A row that matches only through an alias gives no visible reason for
    // being in the results; surface the alias. Direct key/description/tag
    // matches need no hint.
    this.#aliasHits.clear();
    if (query) {
      for (const [key, operation] of visible) {
        const direct =
          key.toLocaleLowerCase().includes(query) ||
          (operation.description ?? "").toLocaleLowerCase().includes(query) ||
          (operation.tags ?? []).some(tag =>
            tag.toLocaleLowerCase().includes(query),
          );
        if (direct) continue;
        const alias = (operation.aliases ?? []).find(candidate =>
          candidate.toLocaleLowerCase().includes(query),
        );
        if (alias) this.#aliasHits.set(key, alias);
      }
    }

    const countText = query
      ? `${visible.length} / ${this.#sorted.length}`
      : String(this.#sorted.length);
    setTextIfChanged(count, countText);
    // The section heading only exists in master-pane (flowContent) mode; it
    // carries the same count honesty as the badge.
    operationsHeading.hidden = !this.#flowContent;
    setTextIfChanged(operationsCount, countText);
    // Screen readers announce this live region on mutation, so the text is
    // only rewritten when the visible count actually changes — a keystroke
    // that narrows the query without changing the result count stays silent.
    if (query) {
      if (this.#announcedCount !== visible.length) {
        this.#announcedCount = visible.length;
        setTextIfChanged(
          status,
          `${visible.length} of ${this.#sorted.length} operations shown`,
        );
      }
    } else {
      this.#announcedCount = null;
      setTextIfChanged(status, "");
    }
    if (input.value !== this.#filter) input.value = this.#filter;

    empty.hidden = visible.length > 0;
    setTextIfChanged(
      empty,
      this.#sorted.length === 0
        ? "This interface declares no operations."
        : "No operations match this filter.",
    );
    list.hidden = visible.length === 0;

    reconcile(list, visible, {
      key: ([key]) => key,
      create: (_item, key) => {
        const cached = this.#rowCache.get(key);
        if (cached) return cached;
        const node = createOperationItem();
        this.#rowCache.set(key, node);
        return node;
      },
      update: (node, [key, operation]) =>
        this.#updateOperationItem(node, key, operation),
    });

    // Roving tabindex is applied after reconcile so newly created rows are
    // included. This only writes attributes — it never moves focus, so a user
    // typing in the filter keeps their caret even as rows appear and vanish.
    this.#applyRoving();

    if (this.#userFiltered) {
      this.#userFiltered = false;
      const signature = visible.map(([key]) => key).join(" ");
      if (signature !== this.#visibleSignature) {
        this.emit<FilterChangeDetail>("ob-filter-change", {
          filter: this.#filter,
          visibleCount: visible.length,
          totalCount: this.#sorted.length,
        });
      }
    }
    this.#visibleSignature = visible.map(([key]) => key).join(" ");

    if (this.#pendingSelectionScroll) {
      this.#pendingSelectionScroll = false;
      if (this.#selectedOperation) {
        this.#buttonFor(this.#selectedOperation)?.scrollIntoView?.({
          block: "nearest",
        });
      }
    }
  }

  /**
   * Shows the description toggle only when the clamped text actually
   * overflows (or is currently expanded, so it can be collapsed again).
   * Measured rather than guessed from character count: a mid-length
   * description can clamp while a long one of short words may fit.
   */
  #updateDescriptionToggle(): void {
    const refs = this.shell(SHELL, baseStyles, styles);
    if (!refs) return;
    const description = refs.require(".description");
    const toggle = refs.require(".description-toggle");
    const overflows = description.scrollHeight > description.clientHeight;
    const show = this.#descriptionExpanded || overflows;
    // Written only on change so the ResizeObserver never loops on its own
    // layout mutation.
    if (toggle.hidden !== !show) toggle.hidden = !show;
  }

  #handleListKeydown(event: KeyboardEvent): void {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "li[data-ob-key]",
    )?.dataset.obKey;
    if (!key) return;
    const keys = this.#visible.map(([k]) => k);
    const index = keys.indexOf(key);
    if (index < 0) return;

    if (event.key === "Enter" || event.key === " ") {
      // Reuse the click path (which emits ob-operation-select). preventDefault
      // suppresses the native button activation so the event fires once.
      event.preventDefault();
      this.#buttonFor(key)?.click();
      return;
    }

    let target: number;
    if (event.key === "ArrowDown") target = Math.min(index + 1, keys.length - 1);
    else if (event.key === "ArrowUp") target = Math.max(index - 1, 0);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = keys.length - 1;
    else return;
    event.preventDefault();
    const nextKey = keys[target];
    if (nextKey && nextKey !== key) this.#focusRow(nextKey);
  }

  #focusRow(key: string | null): void {
    if (!key) return;
    const button = this.#buttonFor(key);
    if (!button) return;
    this.#focusedKey = key;
    this.#applyRoving();
    button.focus();
  }

  /**
   * Keeps exactly one visible row in the Tab sequence: the last-focused row
   * when it is still visible, otherwise the first visible row. Attribute
   * writes only — focus itself is never moved here.
   */
  #applyRoving(): void {
    const visibleKeys = this.#visible.map(([key]) => key);
    this.#rovingKey =
      this.#focusedKey && visibleKeys.includes(this.#focusedKey)
        ? this.#focusedKey
        : visibleKeys[0] ?? null;
    for (const item of this.#rowNodes()) {
      const button = item.querySelector("button");
      if (!button) continue;
      const stop = item.dataset.obKey === this.#rovingKey;
      if (button.tabIndex !== (stop ? 0 : -1)) button.tabIndex = stop ? 0 : -1;
    }
  }

  #rowNodes(): HTMLElement[] {
    return [
      ...(this.renderRoot?.querySelectorAll<HTMLElement>("ul > li[data-ob-key]") ??
        []),
    ];
  }

  #buttonFor(key: string): HTMLButtonElement | null {
    for (const item of this.#rowNodes()) {
      if (item.dataset.obKey === key) return item.querySelector("button");
    }
    return null;
  }

  #updateOperationItem(
    node: HTMLElement,
    key: string,
    operation: Operation,
  ): void {
    const button = node.querySelector<HTMLButtonElement>("button");
    if (!button) return;
    const selected = key === this.#selectedOperation;
    button.classList.toggle("selected", selected);
    // `operation-selected` is a dynamic part token so hosts can style the
    // selection with ::part alone, without reaching for internal classes.
    const part = selected ? "operation operation-selected" : "operation";
    if (button.getAttribute("part") !== part) button.setAttribute("part", part);
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");

    const deprecated = operation.deprecated === true;
    node.classList.toggle("deprecated", deprecated);
    const note = node.querySelector(".deprecated-note");
    if (note) setTextIfChanged(note, deprecated ? ", deprecated" : "");

    const keyNode = node.querySelector(".operation-key");
    if (keyNode) setTextIfChanged(keyNode, key);
    const summary = node.querySelector(".operation-summary");
    if (summary) {
      setTextIfChanged(summary, operation.description ?? "No description");
    }

    const hint = node.querySelector<HTMLElement>(".alias-hint");
    if (hint) {
      const alias = this.#aliasHits.get(key);
      setTextIfChanged(hint, alias ? `alias: ${alias}` : "");
      hint.hidden = !alias;
    }

    const tags = node.querySelector(".tags");
    if (!tags) return;
    const next = [deprecated ? "!deprecated" : "", ...(operation.tags ?? [])].join(
      " ",
    );
    if (tags.getAttribute("data-tags") === next) return;
    tags.setAttribute("data-tags", next);
    const chips: HTMLElement[] = [];
    if (deprecated) {
      const chip = document.createElement("span");
      chip.className = "deprecated-chip";
      chip.textContent = "deprecated";
      // Decorative: the sr-only ", deprecated" note carries the semantics, so
      // the chip is hidden from the accessible name to avoid double reading.
      chip.setAttribute("aria-hidden", "true");
      chips.push(chip);
    }
    for (const tag of operation.tags ?? []) {
      const token = document.createElement("span");
      token.textContent = tag;
      chips.push(token);
    }
    tags.replaceChildren(...chips);
  }
}

function createOperationItem(): HTMLElement {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("part", "operation");
  // Out of the Tab sequence until #applyRoving grants this row the single
  // roving stop.
  button.tabIndex = -1;

  const keyText = document.createElement("span");
  keyText.className = "operation-key";
  const note = document.createElement("span");
  note.className = "sr-only deprecated-note";
  const summary = document.createElement("span");
  summary.className = "operation-summary";
  const hint = document.createElement("span");
  hint.className = "alias-hint";
  hint.hidden = true;
  const tags = document.createElement("span");
  tags.className = "tags";

  button.append(keyText, note, summary, hint, tags);
  item.append(button);
  return item;
}

const SHELL = `
  <section class="container" part="container" aria-label="OpenBindings interface explorer">
    <header part="header">
      <div class="identity">
        <h2></h2>
        <p class="version"></p>
      </div>
      <span class="count" aria-label="Operation count"></span>
    </header>
    <div class="description-block">
      <p class="description"></p>
      <button class="description-toggle" type="button" hidden></button>
    </div>
    <label class="filter-label">
      <span class="sr-only">Filter operations</span>
      <input part="filter" type="search" placeholder="Filter operations" />
    </label>
    <span class="filter-status sr-only" role="status"></span>
    <div class="operations-heading" part="operations-heading" hidden>
      <h3>Operations</h3>
      <span class="operations-count"></span>
    </div>
    <div class="empty" part="empty"></div>
    <ul part="operation-list" aria-label="Operations"></ul>
  </section>
`;

export interface OBIExplorerElement {
  addEventListener<K extends keyof OBIExplorerEventMap>(
    type: K,
    listener: (
      this: OBIExplorerElement,
      event: OBIExplorerEventMap[K],
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
    "ob-obi-explorer": OBIExplorerElement;
  }
}

const styles = `
  .container {
    min-width: 13rem;
    height: 100%;
    overflow: auto;
    padding: calc(var(--_ob-space) * 1.25);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  header {
    display: flex;
    gap: var(--_ob-space);
    align-items: start;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.25;
  }

  .identity[hidden] {
    display: none;
  }

  .operations-heading {
    display: flex;
    gap: var(--_ob-space);
    align-items: baseline;
    justify-content: space-between;
    padding: 0.4rem 0 0.45rem;
    border-bottom: 1px solid var(--_ob-color-border);
  }

  .operations-heading[hidden] {
    display: none;
  }

  .operations-heading h3 {
    margin: 0;
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .operations-count {
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  /*
   * Master-pane mode (rev 15.1): the host rail owns the scrolling, so the
   * container flows to its content height and the filter row plus the
   * Operations heading pin against the outer scroller. Offsets stack
   * panjir-style — base (--ob-rail-sticky-top) → filter → heading — with the
   * filter's pinned height published as --ob-rail-filter-height so a sibling
   * section (interface-sources) can pin its own heading just below.
   */
  :host([flow-content]) .container {
    height: auto;
    overflow: visible;
  }

  :host([flow-content]) .filter-label {
    position: sticky;
    top: var(--ob-rail-sticky-top, 0px);
    z-index: 5;
    margin: 0;
    padding: 0.45rem 0;
    background: var(--_ob-color-background);
  }

  :host([flow-content]) .operations-heading {
    position: sticky;
    top: calc(var(--ob-rail-sticky-top, 0px) + var(--ob-rail-filter-height, 3.05rem));
    z-index: 4;
    background: var(--_ob-color-background);
  }

  .version, .description {
    color: var(--_ob-color-text-muted);
  }

  .version {
    margin: 0.2rem 0 0;
    font-family: var(--_ob-font-mono);
    font-size: 0.72rem;
  }

  .description-block {
    margin: var(--_ob-space) 0;
  }

  .description {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  }

  .description.expanded {
    display: block;
    overflow: visible;
  }

  .description-toggle {
    width: auto;
    margin-top: 0.25rem;
    padding: 0.1rem 0;
    color: var(--_ob-color-accent);
    font-size: 0.72rem;
    background: transparent;
    border: 0;
    border-radius: 0.2rem;
  }

  .description-toggle:hover {
    text-decoration: underline;
    background: transparent;
  }

  .count {
    min-width: 1.6rem;
    padding: 0.12rem 0.4rem;
    color: var(--_ob-color-text-muted);
    text-align: center;
    background: var(--_ob-color-surface);
    border-radius: 999px;
  }

  .filter-label {
    display: block;
    margin: var(--_ob-space) 0;
  }

  input {
    width: 100%;
    min-height: 2.25rem;
    padding: 0.4rem 0.65rem;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  ul {
    display: grid;
    gap: 0.35rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  button {
    display: grid;
    width: 100%;
    gap: 0.18rem;
    padding: 0.65rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--_ob-radius);
    cursor: pointer;
  }

  button:hover {
    background: var(--_ob-color-surface);
  }

  button.selected {
    background: color-mix(in srgb, var(--_ob-color-accent) 9%, var(--_ob-color-background));
    border-color: color-mix(in srgb, var(--_ob-color-accent) 35%, var(--_ob-color-border));
  }

  .operation-key {
    overflow-wrap: anywhere;
    font-family: var(--_ob-font-mono);
    font-size: 0.78rem;
    font-weight: 650;
  }

  .operation-summary {
    display: -webkit-box;
    overflow: hidden;
    color: var(--_ob-color-text-muted);
    font-size: 0.78rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  /* The key stays fully legible so a deprecated operation remains findable;
     only the supporting prose recedes. */
  li.deprecated .operation-summary {
    opacity: 0.55;
  }

  .alias-hint {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-style: italic;
  }

  .alias-hint[hidden] {
    display: none;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tags span {
    padding: 0.06rem 0.34rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.66rem;
    background: color-mix(in srgb, var(--_ob-color-surface-strong) 70%, transparent);
    border: 1px solid var(--_ob-color-border);
    border-radius: 999px;
  }

  .tags .deprecated-chip {
    color: var(--_ob-color-danger);
    background: color-mix(in srgb, var(--_ob-color-danger) 12%, var(--_ob-color-surface));
  }

  .empty {
    padding: calc(var(--_ob-space) * 2) var(--_ob-space);
    color: var(--_ob-color-text-muted);
    text-align: center;
  }

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
`;
