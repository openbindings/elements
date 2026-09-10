import { cloneValueGraph, equalJSON } from "@openbindings/sdk";
import type { ContextRequirement } from "@openbindings/sdk";

/** Retained retry-chain values never cross even an opaque scope change. */
export function matchingRetryContext(
  priorTarget: string | null, nextTarget: string,
  context: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return nextTarget && priorTarget === nextTarget ? context : null;
}

export interface RememberedRequirement {
  target: string;
  requirement: ContextRequirement;
  fields: Record<string, string>;
}

/** Host-local memory, never invocation context. Reuse requires a fresh matching
 * challenge and explicit Apply. A document or operation is not a destination.
 * Values are never included in lookup keys, and one-shot values never enter it.
 */
export class ContextMemory {
  #entries: RememberedRequirement[] = [];

  remember(target: string, requirement: ContextRequirement, fields: Record<string, string>): void {
    if (!target || requirement.durable !== true) return;
    this.#entries = this.#entries.filter(entry => !matches(entry, target, requirement));
    this.#entries.push(cloneValueGraph({ target, requirement, fields }));
    if (this.#entries.length > 32) this.#entries.shift();
  }

  recall(target: string, requirement: ContextRequirement): Record<string, string> {
    const entry = this.#entries.find(entry => matches(entry, target, requirement));
    return entry ? cloneValueGraph(entry.fields) : {};
  }

  clear(): void { this.#entries = []; }
}

function matches(entry: RememberedRequirement, target: string, requirement: ContextRequirement): boolean {
  // Deliberately conservative: no origin folding, scheme-name aliasing, or
  // cross-requirement credential projection. A changed requirement asks again.
  if(entry.target!==target)return false;
  try {return equalJSON(entry.requirement,requirement);}catch{return false;}
}
