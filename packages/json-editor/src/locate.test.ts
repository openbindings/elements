import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { describe, expect, it } from "vitest";
import { locatePath } from "./locate.js";

function state(doc: string, language: "json" | "yaml"): EditorState {
  return EditorState.create({
    doc,
    extensions: [language === "yaml" ? yaml() : json()],
  });
}

const JSON_DOC = `{
  "openbindings": "0.2.0",
  "operations": {
    "a.first": { "input": { "x": 1 } },
    "a.second": { "tags": ["one", "two"] }
  },
  "bindings": {
    "a.first.http": { "operation": "a.first", "source": "api" }
  },
  "sources": {
    "api": { "bindingSpec": "openbindings.openapi@1" }
  }
}
`;

const YAML_DOC = `openbindings: 0.2.0
operations:
  a.first:
    input:
      x: 1
  a.second:
    tags:
      - one
      - two
bindings:
  a.first.http:
    operation: a.first
    source: api
sources:
  api:
    bindingSpec: openbindings.openapi@1
`;

/** The located text, for assertions that read like the document. */
function sliceOf(
  doc: string,
  language: "json" | "yaml",
  path: Array<string | number>,
): string | null {
  const editorState = state(doc, language);
  const range = locatePath(editorState, path, language);
  return range ? doc.slice(range.from, range.to) : null;
}

describe("locatePath", () => {
  it("locates a nested operation in JSON, keyed by its dotted name", () => {
    const text = sliceOf(JSON_DOC, "json", ["operations", "a.second"]);
    expect(text).toContain('"a.second"');
    expect(text).toContain('"tags"');
    // The range covers the key AND its value, not the whole operations map.
    expect(text).not.toContain("a.first");
  });

  it("locates bindings and sources in JSON", () => {
    expect(sliceOf(JSON_DOC, "json", ["bindings", "a.first.http"])).toContain(
      '"source": "api"',
    );
    expect(sliceOf(JSON_DOC, "json", ["sources", "api"])).toContain(
      "openbindings.openapi@1",
    );
  });

  it("descends into array indices in JSON", () => {
    expect(
      sliceOf(JSON_DOC, "json", ["operations", "a.second", "tags", 1]),
    ).toBe('"two"');
  });

  it("locates the same paths in YAML", () => {
    const operation = sliceOf(YAML_DOC, "yaml", ["operations", "a.second"]);
    expect(operation).toContain("a.second");
    expect(operation).toContain("tags");
    expect(sliceOf(YAML_DOC, "yaml", ["bindings", "a.first.http"])).toContain(
      "source: api",
    );
    expect(
      sliceOf(YAML_DOC, "yaml", ["operations", "a.second", "tags", 0]),
    ).toContain("one");
  });

  it("returns null for paths the document does not contain", () => {
    expect(sliceOf(JSON_DOC, "json", ["operations", "missing"])).toBeNull();
    expect(sliceOf(JSON_DOC, "json", ["nope", "x"])).toBeNull();
    expect(sliceOf(JSON_DOC, "json", [])).toBeNull();
  });

  it("still locates nodes in a DIRTY draft, as long as it parses", () => {
    // Mid-edit: a trailing comma and an unclosed value further down. The
    // editor is the source of truth (rev 18 doctrine) — a reveal reads the
    // buffer as it is, not some committed copy.
    const dirty = JSON_DOC.replace('"x": 1', '"x": 1, "y": 2');
    expect(sliceOf(dirty, "json", ["operations", "a.first"])).toContain(
      '"y": 2',
    );
  });

  it("locates a node far past the lazily-parsed viewport", () => {
    // CodeMirror parses lazily: a naive syntaxTree() lookup finds the first
    // entries and silently misses the hundredth. ensureSyntaxTree forces it.
    const many = Array.from(
      { length: 400 },
      (_, index) => `    "op.${index}": { "description": "operation ${index}" }`,
    ).join(",\n");
    const huge = `{\n  "operations": {\n${many}\n  }\n}\n`;
    const text = sliceOf(huge, "json", ["operations", "op.399"]);
    expect(text).toContain("operation 399");
  });
});
