type JsonSchema = {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  pattern?: string;
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema | null {
  if (!ref.startsWith("#/$defs/")) {
    return null;
  }
  const key = ref.replace("#/$defs/", "");
  return root.$defs?.[key] ?? null;
}

function validateNode(
  value: unknown,
  schema: JsonSchema,
  path: string,
  root: JsonSchema
): string[] {
  if (schema.$ref) {
    const resolved = resolveRef(root, schema.$ref);
    if (!resolved) {
      return [`${path}: unsupported schema ref ${schema.$ref}`];
    }
    return validateNode(value, resolved, path, root);
  }

  if (schema.oneOf?.length) {
    const passes = schema.oneOf.filter((item) => validateNode(value, item, path, root).length === 0);
    if (passes.length !== 1) {
      return [`${path}: expected value matching exactly one allowed shape.`];
    }
    return [];
  }

  if (schema.anyOf?.length) {
    const passes = schema.anyOf.some((item) => validateNode(value, item, path, root).length === 0);
    if (!passes) {
      return [`${path}: expected value matching at least one allowed shape.`];
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    return [`${path}: expected constant value ${JSON.stringify(schema.const)}.`];
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [`${path}: expected array.`];
    }
    const errors: string[] = [];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items.`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateNode(item, schema.items as JsonSchema, `${path}[${index}]`, root));
      });
    }
    return errors;
  }

  if (schema.type === "object") {
    if (!isObject(value)) {
      return [`${path}: expected object.`];
    }
    const errors: string[] = [];
    const required = schema.required ?? [];
    required.forEach((key) => {
      if (!(key in value)) {
        errors.push(`${path}: missing required field \"${key}\".`);
      }
    });

    const props = schema.properties ?? {};
    Object.entries(props).forEach(([key, propSchema]) => {
      if (key in value) {
        errors.push(...validateNode(value[key], propSchema, `${path}.${key}`, root));
      }
    });

    if (schema.additionalProperties === false) {
      Object.keys(value).forEach((key) => {
        if (!(key in props)) {
          errors.push(`${path}: unexpected field \"${key}\".`);
        }
      });
    }

    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      return [`${path}: expected string.`];
    }
    const errors: string[] = [];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: expected string length >= ${schema.minLength}.`);
    }
    if (schema.pattern) {
      const regexp = new RegExp(schema.pattern);
      if (!regexp.test(value)) {
        errors.push(`${path}: invalid string format.`);
      }
    }
    return errors;
  }

  return [];
}

export function validateAgainstQuizSchema(quizData: unknown, schema: JsonSchema): string[] {
  return validateNode(quizData, schema, "$", schema);
}
