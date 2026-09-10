import { cloneValueGraph } from "@openbindings/sdk";

/** Presentation traversal only: leave JSON instance data and unknown keywords
 * opaque. The caller retains reference scope/depth/cycle policy. */
export function mapSchemaChildren(schema: Record<string,unknown>, visit:(value:unknown)=>unknown): Record<string,unknown> {
  return Object.fromEntries(Object.entries(schema).map(([key,value])=>{
    switch(key){
      case "properties":case "patternProperties":case "$defs":case "definitions":case "dependentSchemas":
        return [key,value && typeof value==="object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).map(([name,child])=>[name,visit(child)]))
          : cloneValueGraph(value)];
      case "items":case "prefixItems":case "allOf":case "oneOf":case "anyOf":case "not":case "if":case "then":case "else":case "contains":case "propertyNames":case "additionalProperties":case "additionalItems":case "unevaluatedProperties":case "unevaluatedItems":case "contentSchema":
        return [key,Array.isArray(value)?value.map(visit):visit(value)];
      default:return [key,cloneValueGraph(value)];
    }
  }));
}
