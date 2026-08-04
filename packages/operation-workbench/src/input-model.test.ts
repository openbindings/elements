import { describe, expect, it } from "vitest";
import {
  analyzeInputSchema,
  appendArrayItemAtPath,
  buildPayloadFromDefaults,
  conformsToSchema,
  createSchemaFormModel,
  getValueAtPath,
  parseJsonObjectInput,
  removeArrayItemAtPath,
  resolveLocalSchemaRefs,
  setValueAtPath,
  unsetValueAtPath,
  type SchemaArrayField,
  type SchemaObjectField,
  type SchemaPrimitiveField,
} from "./input-model.js";

describe("createSchemaFormModel capability", () => {
  const declineCases: Array<{
    name: string;
    schema: unknown;
    reason: string;
  }> = [
    {
      name: "non-record schema",
      schema: "string",
      reason: "Input schema is not an object.",
    },
    {
      name: "unresolved root $ref",
      schema: { $ref: "#/schemas/Missing" },
      reason: "Form view does not support unresolved schema references.",
    },
    {
      name: "allOf root",
      schema: { allOf: [{ type: "object" }] },
      reason: 'Form view does not support "allOf" schemas.',
    },
    {
      name: "anyOf root",
      schema: { anyOf: [{ type: "object" }] },
      reason: 'Form view does not support "anyOf" schemas.',
    },
    {
      name: "oneOf root",
      schema: { oneOf: [{ type: "object" }] },
      reason: 'Form view does not support "oneOf" schemas.',
    },
    {
      name: "not root",
      schema: { not: { type: "string" } },
      reason: 'Form view does not support "not" schemas.',
    },
    {
      name: "if root",
      schema: { if: { type: "string" } },
      reason: 'Form view does not support "if" schemas.',
    },
    {
      name: "non-object root type",
      schema: { type: "string" },
      reason: "Form view requires an object input schema.",
    },
    {
      name: "invalid property schema shape",
      schema: { type: "object", properties: { a: 5 } },
      reason: 'Property "a" has an invalid schema shape.',
    },
    {
      name: "property with unresolved $ref",
      schema: {
        type: "object",
        properties: { a: { $ref: "#/schemas/Missing" } },
      },
      reason:
        'Property "a" is unsupported: unresolved references are not supported',
    },
    {
      name: "property with combinator",
      schema: {
        type: "object",
        properties: { a: { anyOf: [{ type: "string" }] } },
      },
      reason: 'Property "a" is unsupported: "anyOf" is not supported',
    },
    {
      name: "nested array of arrays",
      schema: {
        type: "object",
        properties: {
          a: { type: "array", items: { type: "array", items: { type: "string" } } },
        },
      },
      reason:
        'Property "a" is unsupported: nested arrays are not supported in v1',
    },
    {
      name: "enum values not matching declared type",
      schema: {
        type: "object",
        properties: { a: { type: "string", enum: [1, 2] } },
      },
      reason:
        'Property "a" is unsupported: enum values do not match the declared primitive type',
    },
    {
      name: "unsupported property type",
      schema: { type: "object", properties: { a: { type: "null" } } },
      // Unrecognized declared types normalize to null before reporting, so
      // the reason reads "unknown" — benchmark-identical behavior.
      reason: 'Property "a" is unsupported: unsupported type "unknown"',
    },
  ];

  for (const entry of declineCases) {
    it(`declines with reason: ${entry.name}`, () => {
      const { capability, model } = createSchemaFormModel(entry.schema);
      expect(capability.supported).toBe(false);
      expect(capability.reason).toBe(entry.reason);
      expect(model).toBeNull();
    });
  }

  it("models primitives, enums, booleans, nested objects, and arrays with required flags", () => {
    const { capability, model } = createSchemaFormModel({
      type: "object",
      properties: {
        name: { type: "string", description: "Who", default: "x" },
        size: { type: "string", enum: ["s", "m"] },
        count: { type: "integer" },
        active: { type: "boolean" },
        nested: {
          type: "object",
          properties: { deep: { type: "number" } },
          required: ["deep"],
        },
        tags: { type: "array", items: { type: "string" } },
        rows: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" } } },
        },
      },
      required: ["name", "nested"],
    });
    expect(capability.supported).toBe(true);
    expect(model).not.toBeNull();
    const byKey = new Map(model!.fields.map(field => [field.key, field]));
    const name = byKey.get("name") as SchemaPrimitiveField;
    expect(name.required).toBe(true);
    expect(name.description).toBe("Who");
    expect(name.defaultValue).toBe("x");
    expect((byKey.get("size") as SchemaPrimitiveField).enumValues).toEqual([
      "s",
      "m",
    ]);
    expect((byKey.get("count") as SchemaPrimitiveField).valueType).toBe(
      "integer",
    );
    expect((byKey.get("active") as SchemaPrimitiveField).valueType).toBe(
      "boolean",
    );
    const nested = byKey.get("nested") as SchemaObjectField;
    expect(nested.kind).toBe("object");
    expect(nested.required).toBe(true);
    expect(nested.fields[0]?.required).toBe(true);
    expect(nested.fields[0]?.path).toEqual(["nested", "deep"]);
    const rows = byKey.get("rows") as SchemaArrayField;
    expect(rows.kind).toBe("array");
    expect(rows.item.kind).toBe("object");
  });

  it("treats an object schema without properties as an empty form", () => {
    const { capability, model } = createSchemaFormModel({ type: "object" });
    expect(capability.supported).toBe(true);
    expect(model?.fields).toEqual([]);
  });
});

describe("resolveLocalSchemaRefs", () => {
  const schemas = {
    Input: {
      type: "object",
      properties: { key: { $ref: "#/schemas/Key" } },
      required: ["key"],
    },
    Key: { type: "string", description: "resolved" },
    Loop: {
      type: "object",
      properties: { self: { $ref: "#/schemas/Loop" } },
    },
  } as Record<string, unknown>;

  it("resolves nested local refs before capability analysis", () => {
    const resolved = resolveLocalSchemaRefs(
      { $ref: "#/schemas/Input" },
      schemas,
    );
    const { capability, model } = createSchemaFormModel(resolved);
    expect(capability.supported).toBe(true);
    const field = model!.fields[0] as SchemaPrimitiveField;
    expect(field.key).toBe("key");
    expect(field.valueType).toBe("string");
    expect(field.description).toBe("resolved");
  });

  it("guards cycles: the cyclic ref stays unresolved and capability declines", () => {
    const resolved = resolveLocalSchemaRefs(
      { $ref: "#/schemas/Loop" },
      schemas,
    );
    const { capability } = createSchemaFormModel(resolved);
    expect(capability.supported).toBe(false);
    expect(capability.reason).toBe(
      'Property "self" is unsupported: unresolved references are not supported',
    );
  });

  it("leaves unknown and external refs untouched", () => {
    expect(
      resolveLocalSchemaRefs({ $ref: "#/schemas/Nope" }, schemas),
    ).toEqual({ $ref: "#/schemas/Nope" });
    expect(
      resolveLocalSchemaRefs({ $ref: "https://x/y.json" }, schemas),
    ).toEqual({ $ref: "https://x/y.json" });
  });
});

describe("analyzeInputSchema", () => {
  it("exposes labeled oneOf branches with a clamped index", () => {
    const analysis = analyzeInputSchema(
      {
        oneOf: [
          { title: "ById", type: "object", properties: { id: { type: "string" } } },
          { type: "object", properties: { name: { type: "string" } } },
        ],
      },
      undefined,
      5,
    );
    expect(analysis.oneOfBranches?.length).toBe(2);
    expect(analysis.oneOfBranches?.[0]?.label).toBe("ById");
    expect(analysis.oneOfBranches?.[1]?.label).toContain("Variant 2");
    expect(analysis.clampedOneOfIndex).toBe(1);
    expect(analysis.effective).toBe(analysis.oneOfBranches?.[1]?.schema);
  });

  it("dereferences the input against obi schemas before branching", () => {
    const analysis = analyzeInputSchema(
      { $ref: "#/schemas/Pick" },
      {
        Pick: { oneOf: [{ type: "object", properties: {} }] },
      },
      0,
    );
    expect(analysis.oneOfBranches?.length).toBe(1);
  });
});

describe("payload path operations", () => {
  it("gets, sets, unsets, and builds intermediate containers", () => {
    const base = { a: { b: 1 } };
    expect(getValueAtPath(base, ["a", "b"])).toBe(1);
    expect(getValueAtPath(base, ["a", "missing", "x"])).toBeUndefined();
    const withSet = setValueAtPath(base, ["items", 0, "id"], "x");
    expect(withSet).toEqual({ a: { b: 1 }, items: [{ id: "x" }] });
    // Immutability: the original was not touched.
    expect(base).toEqual({ a: { b: 1 } });
    const without = unsetValueAtPath(withSet, ["a", "b"]);
    expect(without.a).toEqual({});
  });

  it("appends and removes array items", () => {
    const appended = appendArrayItemAtPath({}, ["tags"], "one");
    expect(appended).toEqual({ tags: ["one"] });
    const twice = appendArrayItemAtPath(appended, ["tags"], "two");
    const removed = removeArrayItemAtPath(twice, ["tags"], 0);
    expect(removed).toEqual({ tags: ["two"] });
    expect(removeArrayItemAtPath(removed, ["tags"], 9)).toEqual(removed);
  });
});

describe("parse and conformance", () => {
  it("parses object input and rejects non-objects with copy", () => {
    expect(parseJsonObjectInput("")).toEqual({
      payload: null,
      error: null,
      empty: true,
    });
    expect(parseJsonObjectInput("[1]").error).toBe(
      "Input JSON must be an object at the top level.",
    );
    expect(parseJsonObjectInput("{nope").error).toBe(
      "Input must be valid JSON.",
    );
    expect(parseJsonObjectInput('{"a":1}').payload).toEqual({ a: 1 });
  });

  it("checks structural conformance including required and array items", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    };
    expect(conformsToSchema({ name: "x", tags: ["a"] }, schema)).toBe(true);
    expect(conformsToSchema({ tags: [] }, schema)).toBe(false);
    expect(conformsToSchema({ name: "x", tags: [1] }, schema)).toBe(false);
    expect(conformsToSchema({ name: 4 }, schema)).toBe(false);
  });

  it("builds defaults for required fields only, honoring declared defaults", () => {
    const { model } = createSchemaFormModel({
      type: "object",
      properties: {
        name: { type: "string" },
        limit: { type: "integer", default: 10 },
        note: { type: "string" },
      },
      required: ["name"],
    });
    expect(buildPayloadFromDefaults(model!)).toEqual({
      name: "",
      limit: 10,
    });
  });
});
