import { expect, it } from "vitest";
import { equalJSON, parseJSON, stringifyJSON } from "@openbindings/sdk";
import { parseValueYAML, stringifyValueYAML } from "./value-yaml.js";

it("retains existing YAML numeric grammar and exact JSON values",()=>{
  for(const [source,json]of [["9007199254740993","9007199254740993"],["0.10000000000000001","0.10000000000000001"],["1e400","1e400"],["1e-400","1e-400"],["+.5","0.5"],["-.5","-0.5"],["01","1"],["0x20000000000001","9007199254740993"],["0o10","8"],["1.","1"],["1.e2","100"]]){
    const parsed=parseValueYAML("value: "+source);
    expect(equalJSON(parsed,parseJSON('{"value":'+json+'}'))).toBe(true);
    expect(equalJSON(parseValueYAML(stringifyValueYAML(parsed)),parsed)).toBe(true);
  }
});
it("preserves strings, keys, aliases and application objects",()=>{
  const value=parseValueYAML('9007199254740993: &n 9007199254740993\ncopy: *n\n"__proto__": { rawJSON: "7" }\nstring: "1e400"\nempty: []');
  expect(stringifyJSON(value)).toBe('{"9007199254740993":9007199254740993,"copy":9007199254740993,"__proto__":{"rawJSON":"7"},"string":"1e400","empty":[]}');
});
it("refuses duplicate keys, non-JSON numbers and cyclic JSON",()=>{
  for(const source of ["value: 1\nvalue: 2","1.0: a\n1e0: b","value: .inf","value: .nan","root: &a {self: *a}"]){expect(()=>parseValueYAML(source)).toThrow();}
});
it("retains the existing YAML 1.1 numeric constructors when a source selects that version",()=>{
  for(const [source,want]of [["077","63"],["-0x20","-32"],["1_000","1000"],["1:02:03.10000000000000001","3723.10000000000000001"],["-0:00:00.1","-0.1"]]){
    expect(equalJSON(parseValueYAML("%YAML 1.1\n---\nvalue: "+source),parseJSON('{"value":'+want+'}'))).toBe(true);
  }
});
