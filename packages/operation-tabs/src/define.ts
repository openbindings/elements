import { defineElement } from "@openbindings/ui-core";
import { OPERATION_TABS_TAG, OperationTabsElement } from "./index.js";

defineElement(OPERATION_TABS_TAG, OperationTabsElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
