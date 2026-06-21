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

function describePath(path: string): string {
  if (path === "$") {
    return "Quiz";
  }

  let description = path;
  description = description.replace(/^\$\[(\d+)\]/, (_match, index: string) => `Round ${Number(index) + 1}`);
  description = description.replace(/\.questions\[(\d+)\]/g, (_match, index: string) => `, question ${Number(index) + 1}`);
  description = description.replace(/\.prompt\.stages\[(\d+)\]/g, (_match, index: string) => ` prompt stage ${Number(index) + 1}`);
  description = description.replace(/\.answer\.stages\[(\d+)\]/g, (_match, index: string) => ` answer stage ${Number(index) + 1}`);
  description = description.replace(/, question (\d+)\./g, ", question $1 ");
  description = description.replace(/Round (\d+)\./g, "Round $1 ");

  return description;
}

function validationError(path: string, message: string): string {
  return `${describePath(path)}: ${message}`;
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

function summarizeAnyOfErrors(errors: string[], path: string): string[] {
  const missingFields = errors
    .map((error) => error.match(/: missing required field "([^"]+)"\.$/)?.[1])
    .filter((field): field is string => Boolean(field));

  if (missingFields.length === errors.length && missingFields.length > 1) {
    const quotedFields = missingFields.map((field) => `"${field}"`);
    const fieldList = `${quotedFields.slice(0, -1).join(", ")} or ${quotedFields[quotedFields.length - 1]}`;
    return [validationError(path, `expected at least one of ${fieldList}.`)];
  }

  return errors;
}

function describeStringPattern(pattern: string): string {
  if (pattern === ".*\\S.*") {
    return "expected non-empty text.";
  }

  if (pattern.includes("(png|jpg|jpeg|gif|webp|svg|mp3|wav|ogg|m4a|mp4|mov|webm)")) {
    return "expected a relative media path with a supported extension.";
  }

  return "invalid string format.";
}

function validateRequiredFields(
  value: unknown,
  schema: JsonSchema,
  path: string
): string[] {
  if (!isObject(value)) {
    return [];
  }

  const errors: string[] = [];
  const required = schema.required ?? [];
  required.forEach((key) => {
    if (!(key in value)) {
      errors.push(validationError(path, `missing required field "${key}".`));
    }
  });
  return errors;
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
      return [validationError(path, `unsupported schema ref ${schema.$ref}.`)];
    }
    return validateNode(value, resolved, path, root);
  }

  if (schema.oneOf?.length) {
    const branchErrors = schema.oneOf.map((item) => validateNode(value, item, path, root));
    const passes = branchErrors.filter((errors) => errors.length === 0);
    if (passes.length === 1) {
      return [];
    }
    if (passes.length > 1) {
      return [validationError(path, "matches more than one allowed shape.")];
    }

    const shortestBranchErrors = branchErrors.reduce<string[] | null>((shortest, errors) => {
      if (!shortest || errors.length < shortest.length) {
        return errors;
      }
      return shortest;
    }, null);

    return uniqueErrors(shortestBranchErrors ?? [validationError(path, "does not match any allowed shape.")]);
  }

  if (schema.anyOf?.length) {
    const branchErrors = schema.anyOf.map((item) => validateNode(value, item, path, root));
    const passes = branchErrors.some((errors) => errors.length === 0);
    if (!passes) {
      return summarizeAnyOfErrors(uniqueErrors(branchErrors.flat()), path);
    }
  }

  const requiredErrors = validateRequiredFields(value, schema, path);
  if (!schema.type && requiredErrors.length) {
    return requiredErrors;
  }

  if (schema.const !== undefined && value !== schema.const) {
    return [validationError(path, `expected ${JSON.stringify(schema.const)}.`)];
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [validationError(path, "expected array.")];
    }
    const errors: string[] = [];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(validationError(path, `expected at least ${schema.minItems} items.`));
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
      return [validationError(path, "expected object.")];
    }
    const errors: string[] = [];
    errors.push(...requiredErrors);

    const props = schema.properties ?? {};
    Object.entries(props).forEach(([key, propSchema]) => {
      if (key in value) {
        errors.push(...validateNode(value[key], propSchema, `${path}.${key}`, root));
      }
    });

    if (schema.additionalProperties === false) {
      Object.keys(value).forEach((key) => {
        if (!(key in props)) {
          errors.push(validationError(path, `unexpected field "${key}".`));
        }
      });
    }

    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      return [validationError(path, "expected string.")];
    }
    const errors: string[] = [];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(
        validationError(
          path,
          schema.pattern ? describeStringPattern(schema.pattern) : `expected string length >= ${schema.minLength}.`
        )
      );
    }
    if (schema.pattern && errors.length === 0) {
      const regexp = new RegExp(schema.pattern);
      if (!regexp.test(value)) {
        errors.push(validationError(path, describeStringPattern(schema.pattern)));
      }
    }
    return errors;
  }

  return [];
}

export function validateAgainstQuizSchema(quizData: unknown, schema: JsonSchema): string[] {
  return validateNode(quizData, schema, "$", schema);
}
