import { defineElement } from "@openbindings/ui-core";
import {
  INTERFACE_SOURCES_TAG,
  InterfaceSourcesElement,
} from "./index.js";

defineElement(INTERFACE_SOURCES_TAG, InterfaceSourcesElement);

// Re-export the package surface so this entry ships full types (element
// class, HTMLElementTagNameMap and event-map augmentations), not just the
// registration side effect.
export * from "./index.js";
