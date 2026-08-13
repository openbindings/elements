export type ResolvedContextEntry = {
  durable?: boolean | undefined;
  value: Record<string, unknown>;
};

export type PartitionedContext = {
  durable: Record<string, unknown> | null;
  transient: Record<string, unknown> | null;
};

/**
 * Separate reusable context from context permitted only for the immediate
 * retry. Durability is opt-in: an absent flag follows the interface default
 * and therefore remains transient.
 */
export function partitionResolvedContext(
  entries: readonly ResolvedContextEntry[],
): PartitionedContext {
  let durable: Record<string, unknown> | null = null;
  let transient: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (entry.durable === true) {
      durable = mergeContext(durable, entry.value);
    } else {
      transient = mergeContext(transient, entry.value);
    }
  }
  return { durable, transient };
}

export function mergeContext(
  current: Record<string, unknown> | null,
  addition: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(current ?? {}), ...addition };
  if (isRecord(current?.apiKeys) && isRecord(addition.apiKeys)) {
    merged.apiKeys = { ...current.apiKeys, ...addition.apiKeys };
  }
  if (isRecord(current?.credentials) && isRecord(addition.credentials)) {
    merged.credentials = { ...current.credentials, ...addition.credentials };
  }
  if (isRecord(current?.configuration) && isRecord(addition.configuration)) {
    const configuration = { ...current.configuration, ...addition.configuration };
    for (const [point, value] of Object.entries(addition.configuration)) {
      const prior = current.configuration[point];
      if (isRecord(prior) && isRecord(value)) {
        configuration[point] = { ...prior, ...value };
      }
    }
    merged.configuration = configuration;
  }
  return merged;
}

/** Builds the BindingContext fragment addressed by one config.value requirement. */
export function configurationContext(
  point: string,
  path: string,
  value: unknown,
): Record<string, unknown> | null {
  if (!point) return null;
  const tokens = pointerTokens(path);
  if (tokens === null) return null;
  let nested: unknown = value;
  for (let index = tokens.length - 1; index >= 0; index--) {
    nested = { [tokens[index]!]: nested };
  }
  return { configuration: { [point]: nested } };
}

function pointerTokens(path: string): string[] | null {
  if (path === "") return [];
  if (!path.startsWith("/")) return null;
  const raw = path.slice(1).split("/");
  if (raw.some((token) => /(?:~(?![01]))/.test(token))) return null;
  return raw.map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
