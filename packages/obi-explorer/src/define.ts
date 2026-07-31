import { defineElement } from "@openbindings/ui-core";
import { OBI_EXPLORER_TAG, OBIExplorerElement } from "./index.js";

defineElement(OBI_EXPLORER_TAG, OBIExplorerElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
