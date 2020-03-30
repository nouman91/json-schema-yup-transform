import { JSONSchema7, JSONSchema7Definition } from "json-schema";
import has from "lodash/has";
import get from "lodash/get";
import omit from "lodash/omit";
import isObject from "lodash/isObject";
import Yup from "../addMethods/";
import { getProperties, isSchemaObject } from "../../schema/";
import { createValidationSchema } from "../schemas/schema";
import { SchemaItem } from "../types";
import { getObjectHead } from "../utils";

/**
 * Merges yup validation schema into the object
 */

export const buildValidation = (
  schema: {},
  [key, value]: SchemaItem,
  jsonSchema: JSONSchema7
): { [key: string]: Yup.Lazy | Yup.MixedSchema<any> } => {
  const validationSchema = createValidationSchema([key, value], jsonSchema);
  return {
    ...schema,
    [key]: validationSchema
  };
};

/**
 * Iterate through each item in properties and generate a key value pair of yup schema
 */

export const buildProperties = (
  properties: {
    [key: string]: JSONSchema7Definition;
  },
  jsonSchema: JSONSchema7
) => {
  let schema = {};

  for (let [key, value] of Object.entries(properties)) {
    if (!isSchemaObject(value)) {
      continue;
    }
    const { properties, type, items } = value;

    // if item is object type call this function again
    if (type === "object" && properties) {
      const objSchema = build(value);
      schema = { ...schema, [key]: objSchema };
    } else if (
      type === "array" &&
      isSchemaObject(items) &&
      has(items, "properties")
    ) {
      /** Structured to handle nested objects in schema. First
       * an array with all the relevant validation rules need to
       * be applied and then the subschemas will be concatenated.
       */
      const ArraySchema = createValidationSchema(
        [key, omit(value, "items")],
        jsonSchema
      );
      schema = {
        ...schema,
        [key]: ArraySchema.concat(Yup.array(build(items)))
      };
    } else {
      // check if item has a then or else schema
      if (type === "array" && isSchemaObject(items)) {
        schema = {
          ...schema,
          [key]: Yup.array(createValidationSchema([key, items], jsonSchema))
        };
      } else {
        schema = {
          ...schema,
          [key]: createValidationSchema([key, value], jsonSchema),
          ...(hasIfSchema(jsonSchema, key) ? buildCondition(jsonSchema) : {})
        };
      }
    }
  }
  return schema;
};

/**
 * Determine schema has a if schema
 */

const hasIfSchema = (jsonSchema: JSONSchema7, key: string) => {
  const { if: ifSchema } = jsonSchema;
  if (isSchemaObject(ifSchema)) {
    const { properties } = ifSchema;
    return isObject(properties) && has(properties, key);
  }
  return false;
};

/**
 * High order function that takes json schema and property item
 * and generates a validation schema to validate the given value
 */

const isValidator = (
  [key, value]: [string, JSONSchema7],
  jsonSchema: JSONSchema7
) => (val: unknown): boolean => {
  const conditionalSchema = createValidationSchema([key, value], jsonSchema);
  const result: boolean = conditionalSchema.isValidSync(val);
  return result;
};

/** Build `is` and `then` validation schema */

export const buildCondition = (
  jsonSchema: JSONSchema7
): false | { [key: string]: Yup.MixedSchema } => {
  const ifSchema = get(jsonSchema, "if");

  if (isSchemaObject(ifSchema)) {
    const { properties } = ifSchema;
    if (!properties) return false;

    const ifSchemaHead = getObjectHead(properties);

    if (!ifSchemaHead) return false;
    const [ifSchemaKey, ifSchemaValue] = ifSchemaHead;

    if (!isSchemaObject(ifSchemaValue)) return false;

    const thenSchema = get(jsonSchema, "then");
    const elseSchema = get(jsonSchema, "else");

    let ConditionSchema = {};

    if (isSchemaObject(thenSchema)) {
      const isValid = isValidator([ifSchemaKey, ifSchemaValue], thenSchema);
      ConditionSchema = buildConditionItem(thenSchema, [
        ifSchemaKey,
        val => {
          return isValid(val) === true;
        }
      ]);
      if (!ConditionSchema) return false;
    }

    if (isSchemaObject(elseSchema)) {
      const isValid = isValidator([ifSchemaKey, ifSchemaValue], elseSchema);
      const elseConditionSchema = buildConditionItem(elseSchema, [
        ifSchemaKey,
        val => isValid(val) === false
      ]);
      if (!elseConditionSchema) return false;
      ConditionSchema = { ...ConditionSchema, ...elseConditionSchema };
    }

    return ConditionSchema;
  }

  return false;
};

/**
 * Build the then/else schema as a yup when schema
 */

const buildConditionItem = (
  schema: JSONSchema7,
  [ifSchemaKey, callback]: [string, (val: unknown) => boolean]
): false | { [key: string]: Yup.MixedSchema } => {
  const { properties, if: ifSchema } = schema;

  let thenSchemaData = properties && buildProperties(properties, schema);
  if (!thenSchemaData) return false;

  thenSchemaData = getObjectHead(thenSchemaData);
  if (!thenSchemaData) return false;

  /** Get the correct schema type to concat the when schema to */
  let Schema = thenSchemaData[1];

  // is there a if schema here
  const ChildConditionSchema =
    isSchemaObject(ifSchema) && buildCondition(schema);

  if (ChildConditionSchema) {
    Schema = Schema.concat(Yup.object().shape(ChildConditionSchema));
  }

  const conditionSchemaHead = getObjectHead(properties);
  if (!conditionSchemaHead) return false;

  const conditionSchemaHeadKey = conditionSchemaHead[0];

  return {
    [conditionSchemaHeadKey]: Yup.mixed().when(ifSchemaKey, {
      is: callback,
      then: Schema
    })
  };
};

/**
 * Iterates through a valid JSON Schema and generates yup field level
 * and object level schema
 */

export const build = (
  jsonSchema: JSONSchema7
): Yup.ObjectSchema<object> | undefined => {
  const properties = getProperties(jsonSchema);

  if (!properties) {
    return properties;
  }

  let Schema = buildProperties(properties, jsonSchema);
  return Yup.object().shape(Schema);
};

export default build;
