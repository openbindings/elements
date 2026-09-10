import { cloneJSON, equalJSON, isJSONNumber, numberToken, parseJSON } from "@openbindings/sdk";
import { isScalar, parseDocument, stringify, visit, type ScalarTag } from "yaml";

// YAML owns recognition, syntax, aliases and diagnostics. Only the already
// recognized core numeric tags get an exact JSON constructor. No native
// number-valued intermediate is used for source data.
function numericToken(source: string): string {
  return source.replace(/_/g, "").replace(/^\+/, "").replace(/^(-?)\./, "$10.")
    .replace(/^(-?)0+(?=\d)/, "$1").replace(/\.(?=[eE]|$)/, ".0");
}

export function parseValueYAML(text: string): unknown {
  const document=parseDocument(text,{
    prettyErrors:true,
    customTags:tags=>tags.map(tag=>{
      if(typeof tag==="string" || "collection" in tag || !["tag:yaml.org,2002:int","tag:yaml.org,2002:float"].includes(tag.tag))return tag;
      return {...tag,resolve:((source,onError,options)=>{
        if(tag.tag.endsWith(":int")){
          // Retain the library's radix/version/sexagesimal recognition and
          // its existing bigint constructor rather than reparsing those forms.
          const value=tag.resolve(source,onError,{...options,intAsBigInt:true});
          if(typeof value!=="bigint")throw new TypeError("YAML integer constructor did not preserve its value");
          return parseJSON(String(value));
        }
        if(tag.format==="TIME"){
          const integerTag=tags.find(t=>typeof t!=="string" && !("collection" in t) && t.tag==="tag:yaml.org,2002:int" && t.format==="TIME") as ScalarTag|undefined;
          if(!integerTag)throw new TypeError("YAML time constructor unavailable");
          const [whole,fraction=""]=source.split(".");
          const value=integerTag.resolve(whole!,onError,{...options,intAsBigInt:true});
          if(typeof value!=="bigint")throw new TypeError("YAML integer constructor did not preserve its value");
          return parseJSON(`${value===0n && source.startsWith("-")?"-0":String(value)}.${fraction.replace(/_/g,"")||"0"}`);
        }
        return parseJSON(numericToken(source));
      }) satisfies ScalarTag["resolve"]};
    }),
    uniqueKeys:(a,b)=>isScalar(a)&&isScalar(b)?equalJSON(a.value,b.value):a===b,
  });
  if(document.errors.length)throw document.errors[0];
  // Object member names are strings at the JSON boundary. Preserve exact
  // numeric YAML keys instead of asking the library to stringify a carrier.
  visit(document,{Scalar(key,node){if(key==="key" && numberToken(node.value)!==undefined)node.value=numberToken(node.value);}});
  return cloneJSON(document.toJS({maxAliasCount:100}));
}

const exactNumberTag:ScalarTag={
  tag:"tag:yaml.org,2002:float",default:true,identify:isJSONNumber,
  resolve:source=>parseJSON(numericToken(source)),
  stringify:node=>numberToken(node.value)!,
};

export function stringifyValueYAML(value: unknown): string {
  // Domain validation prevents host hooks and carrier-shaped data coercion.
  return stringify(cloneJSON(value),{indent:2,lineWidth:0,customTags:[exactNumberTag]});
}
