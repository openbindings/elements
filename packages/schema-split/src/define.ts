import { defineElement } from "@openbindings/ui-core";
import { SCHEMA_SPLIT_TAG, SchemaSplitElement } from "./index.js";

defineElement(SCHEMA_SPLIT_TAG, SchemaSplitElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
