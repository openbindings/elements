/**
 * Schema-driven form input model, translated from panjir's exec-view input
 * mode (input-mode.ts + schema-shell.ts) into plain TypeScript with no
 * framework or DOM dependency.
 *
 * The one deliberate improvement over the benchmark: panjir's model declined
 * every `$ref`; here local `#/schemas/<name>` references are resolved against
 * the interface's schema map (recursively, with a cycle guard) BEFORE
 * capability analysis, because OpenBindings schemas are `$ref`-heavy — an
 * operation input is routinely just `{"$ref": "#/schemas/SomeInput"}`. A
 * reference the resolver cannot satisfy (unknown name, external URL, cycle)
 * is left in place and the capability analysis then declines it with the
 * benchmark's reason, so the decline-with-reason doctrine is preserved.
 */

export type PrimitiveType = "string" | "number" | "integer" | "boolean";

export interface FormCapability {
  supported: boolean;
  reason?: string;
}

export interface SchemaFormModel {
  type: "object";
  fields: SchemaField[];
}

export type SchemaField =
  | SchemaPrimitiveField
  | SchemaObjectField
  | SchemaArrayField;

interface SchemaFieldBase {
  kind: "primitive" | "object" | "array";
  key: string;
  label: string;
  description?: string | undefined;
  required: boolean;
  path: Array<string | number>;
  defaultValue?: unknown;
}

export interface SchemaPrimitiveField extends SchemaFieldBase {
  kind: "primitive";
  valueType: PrimitiveType;
  enumValues?: Array<string | number | boolean> | undefined;
}

export interface SchemaObjectField extends SchemaFieldBase {
  kind: "object";
  fields: SchemaField[];
}

export interface SchemaArrayField extends SchemaFieldBase {
  kind: "array";
  item: SchemaPrimitiveField | SchemaObjectField;
}

type ParseNodeResult =
  | { ok: true; field: SchemaField }
  | { ok: false; reason: string };

type JSONRecord = Record<string, unknown>;

export const UNSUPPORTED_COMBINATORS = [
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
] as const;

export function isPrimitiveField(
  field: SchemaField,
): field is SchemaPrimitiveField {
  return field.kind === "primitive";
}

export function isObjectField(field: SchemaField): field is SchemaObjectField {
  return field.kind === "object";
}

export function isArrayField(field: SchemaField): field is SchemaArrayField {
  return field.kind === "array";
}

const OBI_SCHEMA_REF = /^#\/schemas\/(.+)$/;

/**
 * Resolves local `#/schemas/<name>` references recursively against the
 * interface's schema map. A cycle, an unknown name, or a non-local reference
 * leaves the `$ref` node untouched for the capability analysis to decline.
 */
export function resolveLocalSchemaRefs(
  value: unknown,
  schemas: Record<string, unknown> | undefined,
): unknown {
  if (!schemas || value === undefined || value === null) return value;
  return resolveNode(value, schemas, new Set());
}

function resolveNode(
  value: unknown,
  schemas: Record<string, unknown>,
  resolving: Set<string>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(entry => resolveNode(entry, schemas, resolving));
  }
  const record = value as JSONRecord;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "$ref" && typeof record.$ref === "string") {
    const match = OBI_SCHEMA_REF.exec(record.$ref);
    if (match) {
      const name = decodeURIComponent(match[1] ?? "");
      if (resolving.has(name)) return value;
      const definition = schemas[name];
      if (definition === undefined) return value;
      resolving.add(name);
      const resolved = resolveNode(definition, schemas, resolving);
      resolving.delete(name);
      return resolved;
    }
  }
  const out: JSONRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    out[key] = resolveNode(entry, schemas, resolving);
  }
  return out;
}

export function createSchemaFormModel(schema: unknown): {
  capability: FormCapability;
  model: SchemaFormModel | null;
} {
  if (!isRecord(schema)) {
    return {
      capability: { supported: false, reason: "Input schema is not an object." },
      model: null,
    };
  }

  if (schema.$ref) {
    return {
      capability: {
        supported: false,
        reason: "Form view does not support unresolved schema references.",
      },
      model: null,
    };
  }

  for (const keyword of UNSUPPORTED_COMBINATORS) {
    if (schema[keyword] !== undefined) {
      return {
        capability: {
          supported: false,
          reason: `Form view does not support "${keyword}" schemas.`,
        },
        model: null,
      };
    }
  }

  const rootType = schema.type;
  // OpenAPI / hand-written schemas often omit `type` when `properties` is
  // present.
  if (rootType !== undefined && rootType !== "object") {
    return {
      capability: {
        supported: false,
        reason: "Form view requires an object input schema.",
      },
      model: null,
    };
  }

  const properties = schema.properties;
  if (!isRecord(properties)) {
    return {
      capability: { supported: true },
      model: { type: "object", fields: [] },
    };
  }

  const requiredSet = asRequiredSet(schema.required);
  const fields: SchemaField[] = [];

  for (const [key, rawPropertySchema] of Object.entries(properties)) {
    if (!isRecord(rawPropertySchema)) {
      return {
        capability: {
          supported: false,
          reason: `Property "${key}" has an invalid schema shape.`,
        },
        model: null,
      };
    }
    const parsed = parseNode(rawPropertySchema, key, requiredSet.has(key), [
      key,
    ]);
    if (!parsed.ok) {
      return {
        capability: {
          supported: false,
          reason: `Property "${key}" is unsupported: ${parsed.reason}`,
        },
        model: null,
      };
    }
    fields.push(parsed.field);
  }

  return { capability: { supported: true }, model: { type: "object", fields } };
}

export function parseJsonObjectInput(raw: string): {
  payload: JSONRecord | null;
  error: string | null;
  empty: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { payload: null, error: null, empty: true };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return {
        payload: null,
        error: "Input JSON must be an object at the top level.",
        empty: false,
      };
    }
    return { payload: parsed, error: null, empty: false };
  } catch {
    return { payload: null, error: "Input must be valid JSON.", empty: false };
  }
}

export function payloadToPrettyJson(payload: JSONRecord): string {
  return JSON.stringify(payload, null, 2);
}

export function buildPayloadFromDefaults(model: SchemaFormModel): JSONRecord {
  const out: JSONRecord = {};
  for (const field of model.fields) {
    const value = defaultForField(field);
    if (value !== undefined) {
      out[field.key] = value;
    }
  }
  return out;
}

export function defaultForField(field: SchemaField): unknown {
  if (field.defaultValue !== undefined) {
    return cloneJSONValue(field.defaultValue);
  }
  if (isObjectField(field)) {
    const out: JSONRecord = {};
    for (const child of field.fields) {
      const value = defaultForField(child);
      if (value !== undefined) out[child.key] = value;
    }
    return Object.keys(out).length > 0 || field.required ? out : undefined;
  }
  if (isArrayField(field)) {
    return field.required ? [] : undefined;
  }
  if (isPrimitiveField(field)) {
    if (field.required) {
      if (field.valueType === "string") return "";
      if (field.valueType === "number" || field.valueType === "integer") {
        return 0;
      }
      return false;
    }
  }
  return undefined;
}

export function getValueAtPath(
  root: unknown,
  path: Array<string | number>,
): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

export function setValueAtPath(
  root: JSONRecord,
  path: Array<string | number>,
  value: unknown,
): JSONRecord {
  if (path.length === 0) return root;
  const next = cloneJSONRecord(root);
  setPathMutable(next, path, value);
  return next;
}

export function unsetValueAtPath(
  root: JSONRecord,
  path: Array<string | number>,
): JSONRecord {
  if (path.length === 0) return root;
  const next = cloneJSONRecord(root);
  unsetPathMutable(next, path);
  return next;
}

export function appendArrayItemAtPath(
  root: JSONRecord,
  path: Array<string | number>,
  item: unknown,
): JSONRecord {
  const current = getValueAtPath(root, path);
  const entries = Array.isArray(current) ? [...current] : [];
  entries.push(cloneJSONValue(item));
  return setValueAtPath(root, path, entries);
}

export function removeArrayItemAtPath(
  root: JSONRecord,
  path: Array<string | number>,
  index: number,
): JSONRecord {
  const current = getValueAtPath(root, path);
  if (!Array.isArray(current)) return root;
  if (index < 0 || index >= current.length) return root;
  const entries = current.filter((_, position) => position !== index);
  return setValueAtPath(root, path, entries);
}

function parseNode(
  schema: JSONRecord,
  key: string,
  required: boolean,
  path: Array<string | number>,
): ParseNodeResult {
  if (schema.$ref) {
    return { ok: false, reason: "unresolved references are not supported" };
  }
  for (const keyword of UNSUPPORTED_COMBINATORS) {
    if (schema[keyword] !== undefined) {
      return { ok: false, reason: `"${keyword}" is not supported` };
    }
  }

  const description =
    typeof schema.description === "string" ? schema.description : undefined;
  const defaultValue = schema.default;
  const type = inferType(schema);

  if (type === "object") {
    const properties = schema.properties;
    if (properties !== undefined && !isRecord(properties)) {
      return { ok: false, reason: "object properties must be a map" };
    }
    const nestedRequired = asRequiredSet(schema.required);
    const nestedFields: SchemaField[] = [];
    for (const [childKey, childRaw] of Object.entries(properties ?? {})) {
      if (!isRecord(childRaw)) {
        return {
          ok: false,
          reason: `property "${childKey}" has an invalid schema shape`,
        };
      }
      const parsed = parseNode(childRaw, childKey, nestedRequired.has(childKey), [
        ...path,
        childKey,
      ]);
      if (!parsed.ok) return parsed;
      nestedFields.push(parsed.field);
    }
    return {
      ok: true,
      field: {
        kind: "object",
        key,
        label: key,
        description,
        required,
        path,
        fields: nestedFields,
        defaultValue,
      },
    };
  }

  if (type === "array") {
    if (!isRecord(schema.items)) {
      return { ok: false, reason: "array items must be a schema object" };
    }
    const itemParsed = parseNode(schema.items, key, true, [...path, 0]);
    if (!itemParsed.ok) return itemParsed;
    if (isArrayField(itemParsed.field)) {
      return { ok: false, reason: "nested arrays are not supported in v1" };
    }
    return {
      ok: true,
      field: {
        kind: "array",
        key,
        label: key,
        description,
        required,
        path,
        item: itemParsed.field,
        defaultValue,
      },
    };
  }

  if (
    type === "string" ||
    type === "number" ||
    type === "integer" ||
    type === "boolean"
  ) {
    const enumValues = parseEnum(schema.enum, type);
    if (schema.enum !== undefined && enumValues === null) {
      return {
        ok: false,
        reason: "enum values do not match the declared primitive type",
      };
    }
    return {
      ok: true,
      field: {
        kind: "primitive",
        key,
        label: key,
        description,
        required,
        path,
        valueType: type,
        enumValues: enumValues ?? undefined,
        defaultValue,
      },
    };
  }

  return { ok: false, reason: `unsupported type "${String(type ?? "unknown")}"` };
}

function inferType(schema: JSONRecord): PrimitiveType | "object" | "array" | null {
  const declared = schema.type;
  if (typeof declared === "string") {
    return asAllowedType(declared);
  }
  if (Array.isArray(declared)) {
    // v1: nullable union only (e.g. ["string", "null"]).
    const nonNull = declared.filter(
      (entry): entry is string => typeof entry === "string" && entry !== "null",
    );
    const sole = nonNull[0];
    if (nonNull.length === 1 && sole !== undefined) return asAllowedType(sole);
    return null;
  }
  if (schema.properties && isRecord(schema.properties)) return "object";
  if (schema.items && isRecord(schema.items)) return "array";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const value = schema.enum[0];
    if (typeof value === "string") return "string";
    if (typeof value === "number") {
      return Number.isInteger(value) ? "integer" : "number";
    }
    if (typeof value === "boolean") return "boolean";
  }
  return null;
}

function parseEnum(
  rawEnum: unknown,
  type: PrimitiveType,
): Array<string | number | boolean> | null {
  if (rawEnum === undefined) return null;
  if (!Array.isArray(rawEnum)) return null;
  const out: Array<string | number | boolean> = [];
  for (const item of rawEnum) {
    if (type === "string" && typeof item === "string") out.push(item);
    else if (
      (type === "number" || type === "integer") &&
      typeof item === "number"
    ) {
      out.push(item);
    } else if (type === "boolean" && typeof item === "boolean") out.push(item);
    else return null;
  }
  return out;
}

function asAllowedType(
  value: string,
): PrimitiveType | "object" | "array" | null {
  if (value === "string") return "string";
  if (value === "number") return "number";
  if (value === "integer") return "integer";
  if (value === "boolean") return "boolean";
  if (value === "object") return "object";
  if (value === "array") return "array";
  return null;
}

function setPathMutable(
  root: JSONRecord | unknown[],
  path: Array<string | number>,
  value: unknown,
): void {
  let current: JSONRecord | unknown[] = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    if (segment === undefined) return;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return;
      const child = current[segment];
      if (
        nextSegment !== undefined &&
        (typeof nextSegment === "number" ? !Array.isArray(child) : !isRecord(child))
      ) {
        current[segment] = typeof nextSegment === "number" ? [] : {};
      }
      current = current[segment] as JSONRecord | unknown[];
    } else {
      if (!isRecord(current)) return;
      const child = current[segment];
      if (
        nextSegment !== undefined &&
        (typeof nextSegment === "number" ? !Array.isArray(child) : !isRecord(child))
      ) {
        current[segment] = typeof nextSegment === "number" ? [] : {};
      }
      current = current[segment] as JSONRecord | unknown[];
    }
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (typeof last === "number") {
    if (!Array.isArray(current)) return;
    current[last] = cloneJSONValue(value);
  } else {
    if (!isRecord(current)) return;
    current[last] = cloneJSONValue(value);
  }
}

function unsetPathMutable(
  root: JSONRecord | unknown[],
  path: Array<string | number>,
): void {
  let current: JSONRecord | unknown[] = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (segment === undefined) return;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return;
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        return;
      }
      current = current[segment] as JSONRecord | unknown[];
    } else {
      if (!isRecord(current) || !isRecord(current[segment])) return;
      current = current[segment] as JSONRecord;
    }
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (typeof last === "number") {
    if (!Array.isArray(current)) return;
    if (last >= 0 && last < current.length) current.splice(last, 1);
    return;
  }
  if (!isRecord(current)) return;
  delete current[last];
}

function cloneJSONRecord(input: JSONRecord): JSONRecord {
  return cloneJSONValue(input) as JSONRecord;
}

function cloneJSONValue<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function asRequiredSet(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((entry): entry is string => typeof entry === "string"));
}

function isRecord(value: unknown): value is JSONRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lightweight structural conformance check: does `value` structurally match
 * `schema` well enough to map fields for the form view? Checks type
 * compatibility, required properties, and recurses into object properties and
 * array items. Does NOT enforce constraints like `pattern` or `minimum` —
 * runtime operation validation remains authoritative.
 */
export function conformsToSchema(value: unknown, schema: unknown): boolean {
  if (!isRecord(schema)) return false;

  const type = inferType(schema);

  if (type === "object" || isRecord(schema.properties)) {
    if (!isRecord(value)) return false;
    const requiredSet = asRequiredSet(schema.required);
    for (const key of requiredSet) {
      if (!(key in value)) return false;
    }
    const properties = schema.properties;
    if (isRecord(properties)) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value && isRecord(propertySchema)) {
          if (!conformsToSchema(value[key], propertySchema)) return false;
        }
      }
    }
    return true;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return false;
    if (isRecord(schema.items) && value.length > 0) {
      for (const item of value) {
        if (!conformsToSchema(item, schema.items)) return false;
      }
    }
    return true;
  }

  if (type === "string") return typeof value === "string";
  if (type === "number" || type === "integer") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";

  // No type information — accept anything.
  if (type === null) return true;

  return false;
}

export interface OneOfBranchInfo {
  label: string;
  schema: JSONRecord;
}

export interface InputSchemaAnalysis {
  /** Schema for form and starter work: the selected branch, or the whole input. */
  effective: unknown;
  /** Set when the dereferenced root schema uses `oneOf`. */
  oneOfBranches: OneOfBranchInfo[] | null;
  /** Safe index into `oneOfBranches` for the requested index. */
  clampedOneOfIndex: number;
}

function labelForOneOfBranch(schema: JSONRecord, index: number): string {
  const title = typeof schema.title === "string" ? schema.title.trim() : "";
  if (title) return title;
  const description =
    typeof schema.description === "string" ? schema.description.trim() : "";
  if (description) {
    return description.length > 52 ? `${description.slice(0, 49)}…` : description;
  }
  const declared = schema.type;
  if (typeof declared === "string") return `Variant ${index + 1} (${declared})`;
  const properties = schema.properties;
  if (isRecord(properties)) {
    const keys = Object.keys(properties);
    if (keys.length > 0) {
      const head = keys.slice(0, 3).join(", ");
      return `Variant ${index + 1} ({ ${head}${keys.length > 3 ? ", …" : ""} })`;
    }
  }
  return `Variant ${index + 1}`;
}

/**
 * Dereferences `input` against the interface's schema map, then, when the
 * root is a `oneOf`, selects the requested branch (clamped).
 */
export function analyzeInputSchema(
  input: unknown,
  schemas: Record<string, unknown> | undefined,
  oneOfIndex: number,
): InputSchemaAnalysis {
  if (input === undefined || input === null) {
    return { effective: undefined, oneOfBranches: null, clampedOneOfIndex: 0 };
  }

  const dereferenced = resolveLocalSchemaRefs(input, schemas);

  if (!isRecord(dereferenced)) {
    return {
      effective: dereferenced,
      oneOfBranches: null,
      clampedOneOfIndex: 0,
    };
  }

  const oneOfRaw = dereferenced.oneOf;
  if (!Array.isArray(oneOfRaw) || oneOfRaw.length === 0) {
    return {
      effective: dereferenced,
      oneOfBranches: null,
      clampedOneOfIndex: 0,
    };
  }

  const branches: OneOfBranchInfo[] = [];
  for (let index = 0; index < oneOfRaw.length; index += 1) {
    const branch = oneOfRaw[index];
    if (!isRecord(branch)) continue;
    branches.push({ label: labelForOneOfBranch(branch, index), schema: branch });
  }

  if (branches.length === 0) {
    return {
      effective: dereferenced,
      oneOfBranches: null,
      clampedOneOfIndex: 0,
    };
  }

  const clamped = Math.max(0, Math.min(oneOfIndex, branches.length - 1));
  return {
    effective: branches[clamped]?.schema,
    oneOfBranches: branches,
    clampedOneOfIndex: clamped,
  };
}
