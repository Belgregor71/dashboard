import Ajv from "ajv";

// TWO instances, because inbound and outbound want opposite things.
//
// Inbound (validateBody/validateQuery): coercion is the point. Query strings
// arrive as strings, so `{ type: "number" }` can only ever match after a coerce.
//
// Outbound (validateData): coercion is a bug. Ajv applies coerceTypes,
// useDefaults and removeAdditional by MUTATING the object in place — and
// getWeatherNormalized validates the very object it is about to return. On
// `anyOf: [number, null]` a null was coerced to 0, and a null string to "", so
// "we don't know" left the server as a confident zero. Every `!= null` guard
// downstream was dead code as a result: aiBriefing.js told the model "UV 0"
// when the truth was "no reading", and feels_like_c read 0 °C on a mild day.
//
// Keep them apart. A validator must not edit what it is checking.
const inboundAjv = new Ajv({
  allErrors: true,
  removeAdditional: "failing",
  coerceTypes: true,
  useDefaults: true
});

const dataAjv = new Ajv({ allErrors: true });

/** Compile for INBOUND request bodies/queries — coerces, and mutates req. */
export function compileSchema(schema) {
  return inboundAjv.compile(schema);
}

/** Compile for OUTBOUND payloads — checks only, never rewrites the data. */
export function compileDataSchema(schema) {
  return dataAjv.compile(schema);
}

function formatErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    message: error.message || "Validation error"
  }));
}

export function validateBody(validateFn) {
  return (req, res, next) => {
    const ok = validateFn(req.body);
    if (!ok) {
      res.status(400).json({
        error: "Invalid request body",
        details: formatErrors(validateFn.errors)
      });
      return;
    }
    next();
  };
}

export function validateQuery(validateFn) {
  return (req, res, next) => {
    const ok = validateFn(req.query);
    if (!ok) {
      res.status(400).json({
        error: "Invalid query params",
        details: formatErrors(validateFn.errors)
      });
      return;
    }
    next();
  };
}

/**
 * Check an outbound payload. Compile with compileDataSchema, not compileSchema,
 * or this silently rewrites the very thing you are about to send.
 */
export function validateData(validateFn, data) {
  const ok = validateFn(data);
  return {
    ok,
    data,
    errors: ok ? [] : formatErrors(validateFn.errors)
  };
}
