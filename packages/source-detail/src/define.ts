import "@openbindings/json-editor/define";
import { defineElement } from "@openbindings/ui-core";
import { SOURCE_DETAIL_TAG, SourceDetailElement } from "./index.js";

defineElement(SOURCE_DETAIL_TAG, SourceDetailElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
