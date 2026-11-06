import { isDeepStrictEqual } from "node:util";
import type { Json, JsonSchema } from "../../../shared/automation/spec";

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}
const types = ["null", "boolean", "number", "integer", "string", "array", "object"];
const keywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "title",
  "description",
  "default",
  "$schema",
]);

function object(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertValidSchemaDefinition(schema: JsonSchema): void {
  if (!object(schema)) throw new Error("Schema must be an object");
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!declared.length || declared.some((type) => typeof type !== "string" || !types.includes(type)))
      throw new Error("Invalid schema type");
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = schema[key];
    if (branches !== undefined) {
      if (!Array.isArray(branches) || !branches.length) throw new Error(`Invalid ${key}`);
      branches.forEach((branch) => {
        assertValidSchemaDefinition(branch as JsonSchema);
      });
    }
  }
  for (const key of ["items", "not"]) {
    if (schema[key] !== undefined) assertValidSchemaDefinition(schema[key] as JsonSchema);
  }
  if (schema.properties !== undefined) {
    if (!object(schema.properties)) throw new Error("Invalid schema properties");
    Object.values(schema.properties).forEach((child) => {
      assertValidSchemaDefinition(child as JsonSchema);
    });
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    assertValidSchemaDefinition(schema.additionalProperties as JsonSchema);
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))
  )
    throw new Error("Invalid required properties");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length))
    throw new Error("Invalid enum");
  for (const key of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ]) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value)))
      throw new Error(`Invalid ${key}`);
    if (
      typeof value === "number" &&
      (key.startsWith("min") || key.startsWith("max")) &&
      key !== "minimum" &&
      key !== "maximum" &&
      (!Number.isInteger(value) || value < 0)
    )
      throw new Error(`Invalid ${key}`);
  }
  if (schema.multipleOf !== undefined && (schema.multipleOf as number) <= 0) throw new Error("Invalid multipleOf");
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean")
    throw new Error("Invalid uniqueItems");
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") throw new Error("Invalid pattern");
    new RegExp(schema.pattern, "u");
  }
}

function matchesType(type: Json, value: Json): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return object(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

export function validateJsonSchema(schema: JsonSchema, value: Json): readonly ValidationError[] {
  assertValidSchemaDefinition(schema);
  const errors: ValidationError[] = [];
  function validate(s: JsonSchema, v: Json, path: string): void {
    const fail = (message: string) => {
      errors.push({ path, message });
    };
    if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some((type) => matchesType(type, v))) {
      fail(`Expected ${JSON.stringify(s.type)}`);
      return;
    }
    if (Array.isArray(s.enum) && !s.enum.some((entry) => isDeepStrictEqual(entry, v))) fail("Value is not in enum");
    if (Object.hasOwn(s, "const") && !isDeepStrictEqual(s.const, v)) fail("Value differs from const");
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(s[key])) {
        const branches = s[key] as Json[];
        const valid = branches.filter((branch) => validateJsonSchema(branch as JsonSchema, v).length === 0).length;
        if (
          (key === "anyOf" && valid === 0) ||
          (key === "oneOf" && valid !== 1) ||
          (key === "allOf" && valid !== branches.length)
        )
          fail(`Value does not satisfy ${key}`);
      }
    }
    if (object(s.not) && validateJsonSchema(s.not, v).length === 0) fail("Value satisfies forbidden schema");
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) fail("Value is below minimum");
      if (typeof s.maximum === "number" && v > s.maximum) fail("Value exceeds maximum");
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) fail("Value is below exclusive minimum");
      if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) fail("Value exceeds exclusive maximum");
      if (typeof s.multipleOf === "number" && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-10)
        fail("Value is not a multiple");
    }
    if (typeof v === "string") {
      const length = [...v].length;
      if (typeof s.minLength === "number" && length < s.minLength) fail("String is too short");
      if (typeof s.maxLength === "number" && length > s.maxLength) fail("String is too long");
      if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(v)) fail("String does not match pattern");
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) fail("Too few items");
      if (typeof s.maxItems === "number" && v.length > s.maxItems) fail("Too many items");
      if (
        s.uniqueItems === true &&
        v.some((entry, index) => v.slice(0, index).some((prior) => isDeepStrictEqual(entry, prior)))
      )
        fail("Items are not unique");
      if (object(s.items))
        v.forEach((item, index) => {
          validate(s.items as JsonSchema, item, `${path}[${index}]`);
        });
    }
    if (object(v)) {
      const properties = object(s.properties) ? s.properties : {};
      if (Array.isArray(s.required))
        for (const key of s.required) {
          if (typeof key === "string" && !Object.hasOwn(v, key)) fail(`Missing required property: ${key}`);
        }
      for (const [key, item] of Object.entries(v)) {
        if (Object.hasOwn(properties, key)) validate(properties[key] as JsonSchema, item, `${path}.${key}`);
        else if (s.additionalProperties === false) fail(`Unexpected property: ${key}`);
        else if (object(s.additionalProperties)) validate(s.additionalProperties, item, `${path}.${key}`);
      }
      if (typeof s.minProperties === "number" && Object.keys(v).length < s.minProperties) fail("Too few properties");
      if (typeof s.maxProperties === "number" && Object.keys(v).length > s.maxProperties) fail("Too many properties");
    }
  }
  validate(schema, value, "$");
  return errors;
}
