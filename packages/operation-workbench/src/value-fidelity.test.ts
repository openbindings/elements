import { describe, expect, it } from "vitest";
import { parseJSON, stringifyJSON, type OBInterface } from "@openbindings/sdk";
import { parseJsonObjectInput, payloadToPrettyJson, setValueAtPath, resolveLocalSchemaRefs, createSchemaFormModel, buildPayloadFromDefaults } from "./input-model.js";
import { presentInvocationError, OperationWorkbenchElement } from "./index.js";
import { formatJSON } from "@openbindings/ui-core";
import { adaptOBStartFrameBindings } from "../../../apps/ob-start-workbench/src/ob-start-frame-invoker.js";

describe("ordinary workbench value boundaries",()=>{
  it("declines unavailable comparisons and multiplicative starter expansion",()=>{
    if(!customElements.get("fidelity-workbench"))customElements.define("fidelity-workbench",OperationWorkbenchElement);
    for(const schema of [
      {allOf:[{const:parseJSON("1e10001")},{const:parseJSON("1e10001")}]},
      {type:"array",minItems:1024,items:{type:"array",minItems:1024,items:true}},
    ]){
      const element=document.createElement("fidelity-workbench") as OperationWorkbenchElement;
      element.obi={openbindings:"0.2.0",operations:{value:{input:schema}}};element.operationKey="value";
      expect(element.resetInputToSchema()).toBe(false);
    }
  });
  it("keeps exact tokens editable in numeric form controls",async()=>{
    if(!customElements.get("fidelity-workbench"))customElements.define("fidelity-workbench",OperationWorkbenchElement);
    const element=document.createElement("fidelity-workbench") as OperationWorkbenchElement;
    element.obi={openbindings:"0.2.0",operations:{value:{input:{type:"object",properties:{n:{type:"number"}}}}}};
    element.operationKey="value";element.inputText='{"n":1e400}';document.body.append(element);
    try {
      await new Promise(resolve=>setTimeout(resolve,0));
      element.shadowRoot!.querySelector<HTMLButtonElement>(".view-form")!.click();
      await new Promise(resolve=>setTimeout(resolve,0));
      const input=element.shadowRoot!.querySelector<HTMLInputElement>("#f-n")!;
      expect(input.value).toBe("1e400");input.value="0.10000000000000001";
      input.dispatchEvent(new Event("input",{bubbles:true}));
      expect(stringifyJSON(parseJSON(element.inputText))).toBe('{"n":0.10000000000000001}');
    }finally{element.remove();}
  });
  it("preserves special property names in form defaults and schema starters",()=>{
    const schema=parseJSON('{"type":"object","required":["__proto__"],"properties":{"__proto__":{"type":"object","properties":{"__proto__":{"type":"number","default":9007199254740993}}}}}') as Record<string,unknown>;
    const {model}=createSchemaFormModel(schema);
    expect(model).toBeTruthy();
    expect(stringifyJSON(buildPayloadFromDefaults(model!))).toBe('{"__proto__":{"__proto__":9007199254740993}}');
    if(!customElements.get("fidelity-workbench"))customElements.define("fidelity-workbench",OperationWorkbenchElement);
    const element=document.createElement("fidelity-workbench") as OperationWorkbenchElement;
    element.obi={openbindings:"0.2.0",operations:{value:{input:schema}}};element.operationKey="value";
    expect(element.resetInputToSchema()).toBe(true);
    expect(stringifyJSON(parseJSON(element.inputText))).toBe('{"__proto__":{"__proto__":9007199254740993}}');
  });
  it("never invents a starter below an exact numeric minimum",()=>{
    if(!customElements.get("fidelity-workbench"))customElements.define("fidelity-workbench",OperationWorkbenchElement);
    for(const token of ["9007199254740993","1e400","0.10000000000000001"]){
      const element=document.createElement("fidelity-workbench") as OperationWorkbenchElement;
      element.obi={openbindings:"0.2.0",operations:{value:{input:{type:"number",minimum:parseJSON(token)}}}};
      element.operationKey="value";
      expect(element.resetInputToSchema()).toBe(true);
      expect(stringifyJSON(parseJSON(element.inputText))).toBe(token);
    }
  });
  it("honors exact count constraints without expanding enormous counts",()=>{
    if(!customElements.get("fidelity-workbench"))customElements.define("fidelity-workbench",OperationWorkbenchElement);
    for(const [schema,want]of [[{type:"array",items:true,minItems:parseJSON("1.0")},"[null]"],[{type:"string",minLength:parseJSON("1.0")},'"x"'],[{type:"array",items:true,minItems:parseJSON("1e400")},null]] as const){
      const element=document.createElement("fidelity-workbench") as OperationWorkbenchElement;
      element.obi={openbindings:"0.2.0",operations:{value:{input:schema}}};element.operationKey="value";
      expect(element.resetInputToSchema()).toBe(want!==null);
      if(want!==null)expect(stringifyJSON(parseJSON(element.inputText))).toBe(want);
    }
  });
  for(const token of ["9007199254740993","0.10000000000000001","1e-400","1e400"]){
    it(`preserves ${token} through edit, copy, schema view and presentation`,()=>{
      const raw=`{"value":${token},"rawJSON":"1","empty":[]}`;
      const value=parseJSON(raw) as Record<string,unknown>;
      const parsed=parseJsonObjectInput(raw);
      expect(stringifyJSON(parsed.payload)).toBe(raw);
      expect(stringifyJSON(parseJSON(payloadToPrettyJson(value)))).toBe(raw);
      const edited=setValueAtPath(value,["new"],true);
      expect(stringifyJSON(edited)).toBe(raw.slice(0,-1)+',"new":true}');
      expect(value).not.toHaveProperty("new");
      const schema={const:value};
      expect(stringifyJSON(resolveLocalSchemaRefs(schema,{}))).toBe(stringifyJSON(schema));
      expect(stringifyJSON(parseJSON(formatJSON(value)))).toBe(raw);
      expect(stringifyJSON(parseJSON(presentInvocationError({code:"E",data:value}).detail))).toBe(`{"code":"E","data":${raw}}`);
      const doc:OBInterface={openbindings:"0.2.0",operations:{},"x-value":value};
      expect(stringifyJSON(adaptOBStartFrameBindings(doc)["x-value"])).toBe(raw);
    });
  }
  it("does not resolve references inside instance data",()=>{
    const schema={const:{$ref:"#/schemas/Value"},properties:{default:{$ref:"#/schemas/Value"}}};
    expect(resolveLocalSchemaRefs(schema,{Value:{type:"number"}})).toEqual({const:{$ref:"#/schemas/Value"},properties:{default:{type:"number"}}});
  });
  it("treats special path names as own data properties",()=>{
    const key="__obFidelityProbe";
    try {
      const edited=setValueAtPath({},["__proto__",key],1);
      expect(Object.hasOwn(Object.prototype,key)).toBe(false);
      expect(Object.hasOwn(edited,"__proto__")).toBe(true);
      expect(stringifyJSON(edited)).toBe('{"__proto__":{"__obFidelityProbe":1}}');
    } finally {delete (Object.prototype as Record<string,unknown>)[key];}
  });
});
