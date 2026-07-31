import { defineElement } from "@openbindings/ui-core";
import {
  OPERATION_GRAPH_EDITOR_TAG,
  OperationGraphEditorElement,
} from "./index.js";

defineElement(OPERATION_GRAPH_EDITOR_TAG, OperationGraphEditorElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
