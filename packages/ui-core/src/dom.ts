import { stringifyJSON, isJSONNumber } from "@openbindings/sdk";
/** Replaces a shadow root with static trusted markup and returns it. */
export function renderStatic(root: ShadowRoot, markup: string): ShadowRoot {
  root.innerHTML = markup;
  return root;
}

export function setText(
  root: ParentNode,
  selector: string,
  value: string | null | undefined,
): void {
  const node = root.querySelector(selector);
  if (node) node.textContent = value ?? "";
}

export function formatJSON(value: unknown): string {
  try {
    return stringifyJSON(value, 2);
  } catch {
    return String(value);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isJSONNumber(value);
}
