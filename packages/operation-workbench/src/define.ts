// Registering the workbench also registers the elements it composes: the
// workbench renders an `<ob-json-editor>` internally, so a consumer that
// registers this tag gets a working input surface rather than an inert
// unknown element. Importing the class alone still registers nothing.
import "@openbindings/json-editor/define";
import { defineElement } from "@openbindings/ui-core";
import { OPERATION_WORKBENCH_TAG, OperationWorkbenchElement } from "./index.js";

defineElement(OPERATION_WORKBENCH_TAG, OperationWorkbenchElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
