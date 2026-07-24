import type { OperationImplementation } from "@openbindings/sdk";

export type OperationSourceListener = () => void;

/**
 * Read-only source of the concrete implementations an application currently
 * offers to operation-dependent consumers.
 *
 * This is UI lifecycle plumbing, not an SDK registry. The application owns
 * the mutable collection and all policy that produced it.
 */
export interface OperationSource {
  snapshot(): readonly OperationImplementation[];
  subscribe(listener: OperationSourceListener): () => void;
}

/** Application-owned mutable implementation source. */
export class OperationEnvironment implements OperationSource {
  readonly #listeners = new Set<OperationSourceListener>();
  #implementations: readonly OperationImplementation[];

  constructor(implementations: readonly OperationImplementation[] = []) {
    this.#implementations = Object.freeze([...implementations]);
  }

  snapshot(): readonly OperationImplementation[] {
    return this.#implementations;
  }

  subscribe(listener: OperationSourceListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Replaces the application-owned snapshot. Registration and preference
   * policy remain the caller's; elements can only observe the result.
   */
  replace(implementations: readonly OperationImplementation[]): void {
    this.#implementations = Object.freeze([...implementations]);
    for (const listener of [...this.#listeners]) listener();
  }
}
