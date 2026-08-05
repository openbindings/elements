/**
 * The workspace split axis (rev 17.12). One ratio can drive several stacked
 * strips — the invocation cockpit and the schemas strip — and their columns
 * must align by CONSTRUCTION, not by three copies of the same numbers
 * happening to agree. This module owns the pieces every consumer shares:
 * the ratio math, the gutter interaction, and the rail / gutter geometry.
 */

export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
export const SPLIT_RATIO_STEP = 0.02;

/** Rounds a ratio to 0.1% so keyboard steps stay exact decimals. */
export function roundSplitRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampSplitRatio(value: number): number {
  return roundSplitRatio(
    Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value)),
  );
}

/**
 * The element half of a gutter binding. `resize` mutates silently (drag
 * movement, keyboard step); `commit` is USER INTENT — emitted once at drag
 * end and per effective keyboard step — so programmatic assignment never
 * echoes.
 */
export interface SplitGutterHost {
  ratio(): number;
  bounds(): { left: number; width: number } | null;
  resize(next: number): void;
  commit(next: number): void;
}

/**
 * Pointer and keyboard resize for a split gutter. The pointer path uses
 * pointer capture so a fast drag that leaves the hit zone keeps resizing;
 * movement mutates state silently and `commit` fires once, at drag end.
 * Keyboard steps commit per effective change.
 */
export function bindSplitGutter(
  gutter: HTMLElement,
  host: SplitGutterHost,
): void {
  let dragBounds: { left: number; width: number } | null = null;
  let dragChanged = false;

  const endDrag = (event: Event): void => {
    if (dragBounds === null) return;
    dragBounds = null;
    gutter.classList.remove("dragging");
    const pointerID = (event as PointerEvent).pointerId;
    try {
      gutter.releasePointerCapture?.(pointerID);
    } catch {
      // The capture may already be gone (pointercancel, jsdom).
    }
    if (dragChanged) {
      dragChanged = false;
      host.commit(host.ratio());
    }
  };

  gutter.addEventListener("pointerdown", event => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    const bounds = host.bounds();
    if (!bounds || bounds.width <= 0) return;
    dragBounds = bounds;
    dragChanged = false;
    gutter.classList.add("dragging");
    try {
      gutter.setPointerCapture?.(pointer.pointerId);
    } catch {
      // jsdom tracks no pointers; capture is progressive enhancement there.
    }
    pointer.preventDefault();
  });

  gutter.addEventListener("pointermove", event => {
    if (dragBounds === null) return;
    const pointer = event as PointerEvent;
    const next = clampSplitRatio(
      (pointer.clientX - dragBounds.left) / dragBounds.width,
    );
    if (next === host.ratio()) return;
    host.resize(next);
    dragChanged = true;
  });

  gutter.addEventListener("pointerup", endDrag);
  gutter.addEventListener("pointercancel", endDrag);

  gutter.addEventListener("keydown", event => {
    const key = (event as KeyboardEvent).key;
    let target: number | null = null;
    if (key === "ArrowLeft") target = host.ratio() - SPLIT_RATIO_STEP;
    else if (key === "ArrowRight") target = host.ratio() + SPLIT_RATIO_STEP;
    else if (key === "Home") target = SPLIT_RATIO_MIN;
    else if (key === "End") target = SPLIT_RATIO_MAX;
    if (target === null) return;
    event.preventDefault();
    const next = clampSplitRatio(target);
    if (next === host.ratio()) return;
    host.resize(next);
    host.commit(next);
  });
}

/**
 * The icon rail: a fixed-width vertical toolbar hugging a pane's outer edge.
 * Width and padding here ARE the alignment contract — every strip on the
 * split axis adopts this, so their pane columns start at identical offsets.
 * Consumers add their own verb colors, pressed states, and hover rules.
 */
export const railStyles = `
  .tool-rail {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 0.3rem;
    align-items: center;
  }

  .tool-rail button {
    display: grid;
    width: 2.1rem;
    min-height: 2.1rem;
    padding: 0;
    place-items: center;
    color: var(--_ob-color-text-muted);
    background: var(--_ob-color-background);
  }

  .tool-rail svg {
    width: 1rem;
    height: 1rem;
  }

  :host([flush]) .tool-rail {
    padding: 0.35rem 0.3rem;
  }
`;

/**
 * The split gutter's shared look: invisible handle at rest in the framed
 * card; an always-visible hairline carrying the pane surface in flush mode,
 * widening to the grab affordance on interaction.
 */
export const splitGutterStyles = `
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

  :host([flush]) .layout-gutter {
    width: 0.5rem;
    background: var(--_ob-code-surface);
    border-radius: 0;
  }

  :host([flush]) .layout-gutter-handle {
    width: 1px;
    background: var(--_ob-color-border);
  }

  :host([flush]) .layout-gutter:hover .layout-gutter-handle,
  :host([flush]) .layout-gutter:focus-visible .layout-gutter-handle,
  :host([flush]) .layout-gutter.dragging .layout-gutter-handle {
    width: 3px;
  }
`;
