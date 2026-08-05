import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
  reconcile,
  setTextIfChanged,
} from "@openbindings/ui-core";

export const OPERATION_TABS_TAG = "ob-operation-tabs";

export interface OperationTab {
  key: string;
  label?: string;
  /**
   * Workspace-item kind (rev 16; rev 17.1 form): rendered as a small inline
   * chip after the label — a token, not a color code. Hosts typically mark
   * only non-default kinds. The element stays generic: any string renders;
   * it knows nothing about what the kinds mean.
   */
  kind?: string;
  dirty?: boolean;
  running?: boolean;
}

export interface OperationTabKeyDetail {
  key: string;
}

export interface OperationTabRenameDetail {
  key: string;
  label: string;
}

export interface OperationTabReorderDetail {
  keys: string[];
}

export interface OperationTabsEventMap {
  "ob-tab-activate": CustomEvent<OperationTabKeyDetail>;
  "ob-tab-close": CustomEvent<OperationTabKeyDetail>;
  "ob-tab-rename": CustomEvent<OperationTabRenameDetail>;
  "ob-tab-duplicate": CustomEvent<OperationTabKeyDetail>;
  "ob-tab-reorder": CustomEvent<OperationTabReorderDetail>;
  "ob-tabs-close-unselected": CustomEvent<Record<string, never>>;
  "ob-tabs-close-all": CustomEvent<Record<string, never>>;
}

/**
 * The open-operation tab strip.
 *
 * Tabs are reconciled by key rather than rebuilt, so a tab that survives a
 * state change keeps its DOM node — and with it focus, scroll offset within
 * the strip, and any in-flight drag. Rebuilding the strip on every unrelated
 * state change used to reset all three, which reads as "the tab was re-added"
 * even when the model never changed.
 *
 * Pointer and keyboard handling is delegated from the container, so listener
 * count is constant regardless of how many tabs are open.
 */
export class OperationTabsElement extends OpenBindingsElement {
  #tabs: OperationTab[] = [];
  #activeKey: string | null = null;
  #renamingKey: string | null = null;
  #dragKey: string | null = null;
  #scrolledKey: string | null = null;
  #resizeObserver: ResizeObserver | null = null;
  // Bound by the shell wiring; closes the action menu in whichever
  // presentation mode (top-layer popover or fallback) is active.
  #closeMenu: () => void = () => {};

  get tabs(): readonly OperationTab[] {
    return this.#tabs;
  }

  set tabs(value: readonly OperationTab[]) {
    const seen = new Set<string>();
    const next = (value ?? []).flatMap(tab => {
      const key = tab.key?.trim();
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [
        {
          key,
          ...(tab.label?.trim() ? { label: tab.label.trim() } : {}),
          ...(tab.kind?.trim() ? { kind: tab.kind.trim() } : {}),
          ...(tab.dirty ? { dirty: true } : {}),
          ...(tab.running ? { running: true } : {}),
        },
      ];
    });
    // The application rebuilds this array on every state change, so compare
    // contents: an unchanged model must not cost a render.
    if (sameTabs(next, this.#tabs)) return;
    this.#tabs = next;
    this.requestRender();
  }

  get activeKey(): string | null {
    return this.#activeKey;
  }

  set activeKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#activeKey) return;
    this.#activeKey = normalized;
    this.requestRender();
  }

  protected override bind(refs: Refs): void {
    const list = refs.require(".tab-list");

    list.addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const key = target?.closest<HTMLElement>(".tab-shell")?.dataset.tabKey;
      if (!key) return;
      if (target?.closest(".close")) {
        event.stopPropagation();
        this.emit("ob-tab-close", { key });
        return;
      }
      if (target?.closest(".tab-button")) this.emit("ob-tab-activate", { key });
    });

    list.addEventListener("keydown", event => {
      // Keys typed into an inline rename belong to the rename, not the strip.
      if ((event.target as HTMLElement | null)?.closest(".rename-input")) return;
      const key = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".tab-shell",
      )?.dataset.tabKey;
      if (key) this.#handleTabKeydown(event, key);
    });

    // Rename intent: double-click on the tab's label area (F2 from the
    // focused tab reaches the same inline edit through #handleTabKeydown).
    list.addEventListener("dblclick", event => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".tab-button")) return;
      const key = target.closest<HTMLElement>(".tab-shell")?.dataset.tabKey;
      if (key) this.#beginRename(key);
    });

    list.addEventListener("dragstart", event => {
      const shell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".tab-shell",
      );
      const key = shell?.dataset.tabKey;
      if (!shell || !key) return;
      this.#dragKey = key;
      shell.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    list.addEventListener("dragend", () => {
      this.#dragKey = null;
      for (const shell of list.querySelectorAll(".tab-shell")) {
        shell.classList.remove("dragging", "drop-target");
      }
    });

    list.addEventListener("dragover", event => {
      const shell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".tab-shell",
      );
      const key = shell?.dataset.tabKey;
      if (!shell || !key || !this.#dragKey || this.#dragKey === key) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      shell.classList.add("drop-target");
    });

    list.addEventListener("dragleave", event => {
      (event.target as HTMLElement | null)
        ?.closest<HTMLElement>(".tab-shell")
        ?.classList.remove("drop-target");
    });

    list.addEventListener("drop", event => {
      const shell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".tab-shell",
      );
      const key = shell?.dataset.tabKey;
      if (!shell || !key) return;
      event.preventDefault();
      shell.classList.remove("drop-target");
      const source =
        this.#dragKey || event.dataTransfer?.getData("text/plain") || "";
      this.#requestMove(source, key);
    });

    // A horizontally overflowing strip has no affordance on its own: macOS
    // hides overlay scrollbars at rest, and a vertical wheel does nothing over
    // a horizontal scroller. Translate wheel delta, and mark which edges have
    // more content so the fades can show it.
    list.addEventListener(
      "wheel",
      event => {
        if (list.scrollWidth <= list.clientWidth) return;
        // Respect genuine horizontal intent (trackpad swipe, shift+wheel).
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        if (event.deltaY === 0) return;
        event.preventDefault();
        list.scrollLeft += event.deltaY;
      },
      { passive: false },
    );

    list.addEventListener("scroll", () => this.#updateOverflow(), {
      passive: true,
    });

    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.#updateOverflow());
      this.#resizeObserver.observe(list);
    }

    // The action popover renders in the TOP LAYER via the native Popover API.
    // Hosts routinely clip the strip (the reference app guards grid blowout
    // with `overflow: hidden` on the element) and an absolutely-positioned
    // popover dies invisibly inside that clip — the menu "opened" under the
    // panel below the strip and every click fell through (rev 13.4). The top
    // layer escapes every ancestor clip and stacking context by definition,
    // and popover="auto" brings light dismiss and Esc for free. Where the
    // API is missing the popover falls back to the clippable absolute
    // presentation — degraded, never dead.
    const menuToggle = refs.require<HTMLButtonElement>(".menu-toggle");
    const menuPopover = refs.require<HTMLElement>(".menu-popover");
    const popoverSupported = typeof (menuPopover as HTMLElement & {
      togglePopover?: () => void;
    }).togglePopover === "function";
    if (popoverSupported) {
      // The button's popovertarget does the toggling — the UA's invoker
      // relationship is what stops light-dismiss-then-reopen on the same
      // click, which a manual togglePopover() call reintroduces.
      // Everything hangs off beforetoggle alone: Safari does not fire the
      // popover `toggle` event (dogfood, rev 13.5 — a two-stage
      // position-then-refine split left Safari holding the unrefined stage
      // forever). Geometry is measured one frame later, when the top-layer
      // box has real layout; until then CSS parks the box off-screen, so
      // there is no misplaced first paint to flicker.
      menuPopover.addEventListener("beforetoggle", event => {
        const open =
          (event as Event & { newState?: string }).newState === "open";
        menuToggle.setAttribute("aria-expanded", String(open));
        if (!open) return;
        requestAnimationFrame(() => {
          if (!menuPopover.matches(":popover-open")) return;
          const anchor = menuToggle.getBoundingClientRect();
          const box = menuPopover.getBoundingClientRect();
          const below = anchor.bottom + 4;
          // A strip near the viewport bottom flips the menu above its
          // anchor — "below the button" past the fold is the clipped-popover
          // bug in a new costume.
          const flip =
            below + box.height > window.innerHeight &&
            anchor.top - 4 - box.height >= 0;
          menuPopover.style.top = flip
            ? `${anchor.top - 4 - box.height}px`
            : `${below}px`;
          menuPopover.style.left = `${Math.max(8, anchor.right - box.width)}px`;
        });
      });
    } else {
      menuPopover.removeAttribute("popover");
      menuPopover.classList.add("fallback");
      menuPopover.hidden = true;
      menuToggle.addEventListener("click", () => {
        menuPopover.hidden = !menuPopover.hidden;
        menuToggle.setAttribute("aria-expanded", String(!menuPopover.hidden));
      });
    }
    this.#closeMenu = () => {
      if (popoverSupported) {
        (menuPopover as HTMLElement & { hidePopover: () => void }).hidePopover();
      } else {
        menuPopover.hidden = true;
        menuToggle.setAttribute("aria-expanded", "false");
      }
    };

    menuPopover.addEventListener("click", event => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-action]",
      )?.dataset.action;
      if (!action) return;
      this.#closeMenu();
      if (action === "move-left") this.#requestActiveMove(-1);
      else if (action === "move-right") this.#requestActiveMove(1);
      else if (action === "duplicate") {
        if (this.#activeKey) this.emit("ob-tab-duplicate", { key: this.#activeKey });
      } else if (action === "close-unselected") {
        this.emit("ob-tabs-close-unselected", {});
      } else if (action === "close-all") this.emit("ob-tabs-close-all", {});
    });
  }

  protected override render(): void {
    const refs = this.shell(SHELL, baseStyles, styles);
    if (!refs) return;

    const list = refs.require(".tab-list");
    refs.require(".empty").hidden = this.#tabs.length > 0;

    // Computed once per render: when activeKey is stale (set, but matching no
    // tab), the first tab must still take the tab stop — otherwise every
    // button is tabIndex=-1 and the strip is unreachable by keyboard.
    const hasActive =
      this.#activeKey !== null &&
      this.#tabs.some(tab => tab.key === this.#activeKey);
    reconcile(list, this.#tabs, {
      key: tab => tab.key,
      create: tab => createTab(tab.key),
      update: (node, tab) => this.#updateTab(node, tab, hasActive),
    });

    refs.require(".menu").hidden = this.#tabs.length === 0;
    setDisabled(refs, '[data-action="move-left"]', !this.#canMoveActive(-1));
    setDisabled(refs, '[data-action="move-right"]', !this.#canMoveActive(1));
    setDisabled(refs, '[data-action="duplicate"]', !hasActive);
    setDisabled(refs, '[data-action="close-unselected"]', this.#tabs.length < 2);

    // scrollIntoView forces a synchronous layout, so it runs only when the
    // selection actually moved — not on every unrelated state change such as
    // an invocation starting or finishing.
    if (this.#activeKey !== this.#scrolledKey) {
      this.#scrolledKey = this.#activeKey;
      list
        .querySelector<HTMLElement>(".tab-shell.active")
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }

    this.#updateOverflow();
  }

  /**
   * Records which edges have hidden tabs, so the strip can dissolve them.
   * Reading scroll geometry forces layout, so this runs on render, scroll and
   * resize only — never per tab.
   */
  #updateOverflow(): void {
    const refs = this.shell(SHELL, baseStyles, styles);
    const list = refs?.find(".tab-list");
    const container = refs?.find(".container");
    if (!list || !container) return;
    const max = list.scrollWidth - list.clientWidth;
    // Sub-pixel layout means the end is never exactly reached.
    const start = list.scrollLeft > 1;
    const end = list.scrollLeft < max - 1;
    const state = start && end ? "both" : start ? "start" : end ? "end" : "none";
    if (container.getAttribute("data-overflow") !== state) {
      container.setAttribute("data-overflow", state);
    }
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
  }

  #updateTab(node: HTMLElement, tab: OperationTab, hasActive: boolean): void {
    const active = tab.key === this.#activeKey;
    const label = tab.label || tab.key;

    node.dataset.tabKey = tab.key;
    node.classList.toggle("active", active);
    node.setAttribute("part", active ? "tab active-tab" : "tab");

    const button = node.querySelector<HTMLButtonElement>(".tab-button");
    if (button) {
      button.setAttribute("aria-selected", String(active));
      // Exactly one tab sits in the tab sequence; the rest are reached with
      // arrow keys, per the WAI-ARIA tabs pattern. Whenever no tab matches
      // activeKey — null or stale — tab 0 takes the stop.
      button.tabIndex =
        active || (!hasActive && this.#tabs[0]?.key === tab.key) ? 0 : -1;
      button.title = label;
    }

    const head = node.querySelector(".label-head");
    const tail = node.querySelector(".label-tail");
    if (head && tail) {
      const TAIL = 8;
      const split = label.length > TAIL + 4 ? label.length - TAIL : label.length;
      setTextIfChanged(head, label.slice(0, split));
      setTextIfChanged(tail, label.slice(split));
    }

    const kindNode = node.querySelector<HTMLElement>(".kind");
    if (kindNode) {
      setTextIfChanged(kindNode, tab.kind ?? "");
      kindNode.hidden = !tab.kind;
    }

    const status = node.querySelector<HTMLElement>(".status");
    if (status) {
      const state = tab.running ? "running" : tab.dirty ? "dirty" : "";
      status.hidden = !state;
      status.className = `status${state ? ` ${state}` : ""}`;
      if (state) {
        const text =
          state === "running" ? "Invocation running" : "Unsaved changes";
        status.setAttribute("aria-label", text);
        status.title = text;
      }
    }

    const close = node.querySelector<HTMLButtonElement>(".close");
    if (close) {
      close.setAttribute("aria-label", `Close ${label}, Delete closes`);
      close.title = `Close ${label}`;
    }
  }

  #handleTabKeydown(event: KeyboardEvent, key: string): void {
    const keys = this.#tabs.map(tab => tab.key);
    const index = keys.indexOf(key);
    if (index < 0) return;

    if (event.key === "F2") {
      event.preventDefault();
      this.#beginRename(key);
      return;
    }

    if (
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const target = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (target < 0 || target >= keys.length) return;
      const next = [...keys];
      [next[index], next[target]] = [next[target]!, next[index]!];
      this.emit("ob-tab-reorder", { keys: next });
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      this.emit("ob-tab-close", { key });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.emit("ob-tab-activate", { key });
      return;
    }

    let target = index;
    if (event.key === "ArrowLeft") {
      target = (index - 1 + keys.length) % keys.length;
    } else if (event.key === "ArrowRight") target = (index + 1) % keys.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = keys.length - 1;
    else return;
    event.preventDefault();
    const nextKey = keys[target];
    if (nextKey) this.#buttonFor(nextKey)?.focus();
  }

  /**
   * Inline rename (rev 16): an overlay input on the tab shell. Enter commits
   * (emitting `ob-tab-rename`), Esc or focus loss cancels; an all-whitespace
   * or unchanged value is a cancel, never a rename to nothing.
   */
  #beginRename(key: string): void {
    const tab = this.#tabs.find(candidate => candidate.key === key);
    if (!tab || this.#renamingKey === key) return;
    this.#endRename();
    const shell = this.#shellFor(key);
    if (!shell) return;
    this.#renamingKey = key;
    shell.classList.add("renaming");
    const input = document.createElement("input");
    input.className = "rename-input";
    input.type = "text";
    input.value = tab.label || tab.key;
    input.setAttribute("aria-label", `Rename tab ${tab.label || tab.key}`);
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        this.#commitRename(key, input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#endRename();
        this.#buttonFor(key)?.focus();
      }
    });
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("blur", () => {
      if (this.#renamingKey === key) this.#endRename();
    });
    shell.append(input);
    input.focus();
    input.select();
  }

  #commitRename(key: string, raw: string): void {
    const tab = this.#tabs.find(candidate => candidate.key === key);
    this.#endRename();
    this.#buttonFor(key)?.focus();
    const label = raw.trim();
    if (!tab || !label || label === (tab.label || tab.key)) return;
    this.emit("ob-tab-rename", { key, label });
  }

  #endRename(): void {
    if (this.#renamingKey === null) return;
    this.#renamingKey = null;
    for (const input of this.renderRoot?.querySelectorAll(".rename-input") ??
      []) {
      input.remove();
    }
    for (const shell of this.renderRoot?.querySelectorAll(
      ".tab-shell.renaming",
    ) ?? []) {
      shell.classList.remove("renaming");
    }
  }

  #shellFor(key: string): HTMLElement | null {
    for (const shell of this.renderRoot?.querySelectorAll<HTMLElement>(
      ".tab-shell",
    ) ?? []) {
      if (shell.dataset.tabKey === key) return shell;
    }
    return null;
  }

  #buttonFor(key: string): HTMLButtonElement | null {
    for (const shell of this.renderRoot?.querySelectorAll<HTMLElement>(
      ".tab-shell",
    ) ?? []) {
      if (shell.dataset.tabKey === key) {
        return shell.querySelector<HTMLButtonElement>(".tab-button");
      }
    }
    return null;
  }

  #requestMove(source: string, target: string): void {
    if (!source || source === target) return;
    const keys = this.#tabs.map(tab => tab.key);
    const sourceIndex = keys.indexOf(source);
    const targetIndex = keys.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    keys.splice(sourceIndex, 1);
    keys.splice(targetIndex, 0, source);
    this.emit("ob-tab-reorder", { keys });
  }

  #canMoveActive(direction: -1 | 1): boolean {
    if (!this.#activeKey) return false;
    const index = this.#tabs.findIndex(tab => tab.key === this.#activeKey);
    const target = index + direction;
    return index >= 0 && target >= 0 && target < this.#tabs.length;
  }

  #requestActiveMove(direction: -1 | 1): void {
    if (!this.#activeKey || !this.#canMoveActive(direction)) return;
    const keys = this.#tabs.map(tab => tab.key);
    const index = keys.indexOf(this.#activeKey);
    const target = index + direction;
    [keys[index], keys[target]] = [keys[target]!, keys[index]!];
    this.emit("ob-tab-reorder", { keys });
  }
}

function sameTabs(
  next: readonly OperationTab[],
  previous: readonly OperationTab[],
): boolean {
  if (next.length !== previous.length) return false;
  return next.every((tab, index) => {
    const other = previous[index];
    return (
      other !== undefined &&
      tab.key === other.key &&
      tab.label === other.label &&
      tab.kind === other.kind &&
      Boolean(tab.dirty) === Boolean(other.dirty) &&
      Boolean(tab.running) === Boolean(other.running)
    );
  });
}

function createTab(key: string): HTMLElement {
  const shell = document.createElement("div");
  shell.className = "tab-shell";
  shell.dataset.tabKey = key;
  shell.draggable = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab-button";
  button.setAttribute("role", "tab");
  button.dataset.focusKey = key;

  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("part", "status");
  status.hidden = true;

  const label = document.createElement("span");
  label.className = "label";
  // Middle ellipsis (rev 17.1): uniform key prefixes make end-truncation
  // collide ("openbindings.ob.de…" twice), and delimiters are conventions,
  // not contract — so the tail is preserved by construction: the head
  // shrinks with its own ellipsis while the tail never gives way.
  const labelHead = document.createElement("span");
  labelHead.className = "label-head";
  const labelTail = document.createElement("span");
  labelTail.className = "label-tail";
  label.append(labelHead, labelTail);
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.setAttribute("part", "kind");
  kind.hidden = true;
  button.append(status, label, kind);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("part", "close");
  close.textContent = "×";
  // Out of the tab sequence: the ARIA tabs pattern is a single stop, and
  // Delete already closes from the focused tab. The aria-label announces the
  // Delete affordance so it stays discoverable.
  close.tabIndex = -1;

  shell.append(button, close);
  return shell;
}

function setDisabled(refs: Refs, selector: string, disabled: boolean): void {
  const node = refs.find<HTMLButtonElement>(selector);
  if (node) node.disabled = disabled;
}

export interface OperationTabsElement {
  addEventListener<K extends keyof OperationTabsEventMap>(
    type: K,
    listener: (
      this: OperationTabsElement,
      event: OperationTabsEventMap[K],
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
    "ob-operation-tabs": OperationTabsElement;
  }
}

const SHELL = `
  <div class="container" part="container">
    <div class="tab-list" part="tab-list" role="tablist" aria-label="Open operations"></div>
    <p class="empty" part="empty">No operations open</p>
    <div class="menu" part="menu">
      <button type="button" class="menu-toggle" popovertarget="tabs-menu-popover" aria-haspopup="menu" aria-expanded="false" aria-label="Operation tab actions" title="Operation tab actions">•••</button>
      <div class="menu-popover" id="tabs-menu-popover" popover="auto">
        <button type="button" data-action="duplicate">Duplicate tab</button>
        <button type="button" data-action="move-left">Move active tab left</button>
        <button type="button" data-action="move-right">Move active tab right</button>
        <button type="button" data-action="close-unselected">Close other tabs</button>
        <button type="button" data-action="close-all">Close all tabs</button>
      </div>
    </div>
  </div>
`;

const styles = `
  :host {
    display: block;
    min-width: 0;
  }

  .container {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    height: 100%;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .container {
    position: relative;
  }

  /*
   * Edges with scrolled-out tabs dissolve the strip's own content via a mask
   * on the scroller — nothing is ever painted OVER a tab label (a painted
   * gradient reads as a smudged fake shadow on light surfaces; dogfood
   * report, rev 13.2). Masks composite alpha only, so the keyword color
   * carries no visual color and the hint is theme-proof by construction.
   * Driven by the data attribute rather than :hover so it holds at rest.
   * The menu column sits outside the scroller, so the end fade clears it
   * with no positioning special-case.
   */
  .container[data-overflow="start"] .tab-list {
    -webkit-mask-image: linear-gradient(to right, transparent, black 1.5rem);
    mask-image: linear-gradient(to right, transparent, black 1.5rem);
  }

  .container[data-overflow="end"] .tab-list {
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 1.5rem), transparent);
    mask-image: linear-gradient(to right, black calc(100% - 1.5rem), transparent);
  }

  .container[data-overflow="both"] .tab-list {
    -webkit-mask-image: linear-gradient(to right, transparent, black 1.5rem, black calc(100% - 1.5rem), transparent);
    mask-image: linear-gradient(to right, transparent, black 1.5rem, black calc(100% - 1.5rem), transparent);
  }

  .tab-list {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    /*
     * scrollbar-width is deliberately unset: in Chromium, setting it to
     * anything other than "auto" disables ::-webkit-scrollbar styling
     * altogether, which is what kept the scrollbar invisible on macOS.
     * Firefox has no ::-webkit-scrollbar, so it gets scrollbar-color only.
     */
    scrollbar-color: var(--_ob-color-text-muted) transparent;
  }

  /*
   * macOS hides overlay scrollbars at rest, which leaves an overflowing strip
   * with no visible indication that it scrolls. An explicitly sized scrollbar
   * is always drawn in Chromium and WebKit.
   */
  .tab-list::-webkit-scrollbar {
    height: 0.4rem;
  }

  .tab-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .tab-list::-webkit-scrollbar-thumb {
    background: var(--_ob-color-border);
    border-radius: 0.2rem;
  }

  .tab-list:hover::-webkit-scrollbar-thumb {
    background: var(--_ob-color-text-muted);
  }

  .tab-list:empty {
    display: none;
  }

  .tab-shell {
    position: relative;
    scroll-snap-align: start;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 8rem;
    max-width: 20rem;
    flex: 0 1 14rem;
    align-items: center;
    color: var(--_ob-color-text-muted);
    border-right: 1px solid var(--_ob-color-border);
  }

  .tab-shell.active {
    color: var(--_ob-color-text);
    background: var(--_ob-color-background);
  }

  .tab-shell.active::before {
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    content: "";
    background: var(--_ob-color-accent);
  }

  .tab-shell.dragging {
    opacity: 0.5;
  }

  .tab-shell.drop-target {
    box-shadow: inset 3px 0 var(--_ob-color-accent);
  }

  .tab-button,
  .close,
  .menu button {
    min-width: 0;
    min-height: 2.25rem;
    padding: 0 0.65rem;
    color: inherit;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .tab-button {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    text-align: left;
  }

  /* Middle ellipsis: the head shrinks with its own ellipsis, the tail is
     rigid — together they truncate long labels in the middle, where the
     information usually isn't. */
  .label {
    display: flex;
    min-width: 0;
  }

  .label-head {
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .label-tail {
    flex: none;
    white-space: pre;
  }

  /* The workspace-item kind (rev 17.1): an inline chip, present only when
     the host marks a non-default kind — a token, never a color code alone. */
  .kind {
    flex: none;
    padding: 0.02rem 0.32rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.6rem;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, var(--_ob-color-surface-strong) 70%, transparent);
    border: 1px solid var(--_ob-color-border);
    border-radius: 999px;
  }

  .kind[hidden] {
    display: none;
  }

  .rename-input {
    position: absolute;
    inset: 0.25rem 2.1rem 0.25rem 0.45rem;
    z-index: 2;
    min-width: 0;
    padding: 0 0.4rem;
    color: var(--_ob-color-text);
    font: inherit;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-accent);
    border-radius: calc(var(--_ob-radius) * 0.55);
  }

  .status {
    width: 0.45rem;
    height: 0.45rem;
    flex: 0 0 auto;
    background: var(--_ob-color-text-muted);
    border-radius: 50%;
  }

  .status[hidden] {
    display: none;
  }

  .status.running {
    background: var(--_ob-color-success);
    box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--_ob-color-success) 16%, transparent);
  }

  .status.dirty {
    background: var(--_ob-color-accent);
  }

  .close {
    width: 2rem;
    padding: 0;
    color: var(--_ob-color-text-muted);
    font-size: 1rem;
    opacity: 0.65;
  }

  .close:hover,
  .close:focus-visible {
    color: var(--_ob-color-text);
    background: var(--_ob-color-surface-strong);
    opacity: 1;
  }

  .empty {
    align-self: center;
    padding: 0 0.75rem;
    margin: 0;
    color: var(--_ob-color-text-muted);
    font-size: 0.78rem;
  }

  .empty[hidden] {
    display: none;
  }

  .menu {
    position: relative;
    border-left: 1px solid var(--_ob-color-border);
  }

  .menu[hidden] {
    display: none;
  }

  .menu-toggle {
    display: grid;
    width: 2.5rem;
    height: 100%;
    min-height: 2.25rem;
    padding: 0;
    place-items: center;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .menu-popover {
    width: 12rem;
    padding: 0.3rem;
    color: var(--_ob-color-text);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
    box-shadow: var(--_ob-shadow);
  }

  /*
   * Top-layer mode. UA popover defaults (inset 0, margin auto, fit-content
   * sizing) vary across engines and versions — every geometry property is
   * pinned here as an explicit LONGHAND so no engine's defaults can leak
   * through and stretch the box (Safari did exactly that, rev 13.5; an
   * inset:auto shorthand was not enough). The off-screen left parks the
   * first open until the rAF positioner has real layout to measure; display
   * is only claimed when actually open so the UA's closed state stays in
   * charge.
   */
  .menu-popover[popover] {
    position: fixed;
    top: 0;
    right: auto;
    bottom: auto;
    left: -9999px;
    width: 12rem;
    height: fit-content;
    max-height: calc(100vh - 2rem);
    margin: 0;
    overflow: auto;
  }

  .menu-popover[popover]:popover-open {
    display: grid;
    align-content: start;
  }

  /*
   * Popover-less fallback: the pre-top-layer presentation, subject to
   * ancestor clipping — degraded, never dead. Hidden toggling relies on the
   * base [hidden] guard.
   */
  .menu-popover.fallback {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0.25rem;
    z-index: 10;
    display: grid;
  }

  .menu button {
    text-align: left;
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  .menu button:hover:not(:disabled) {
    background: var(--_ob-color-surface);
  }

  .menu button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;
