import Ajv from "ajv";

// Single Ajv instance so schemas are compiled once and reused.
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: "failing",
  coerceTypes: true,
  useDefaults: true
});

export function compileSchema(schema) {
  return ajv.compile(schema);
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

export function validateData(validateFn, data) {
  const ok = validateFn(data);
  return {
    ok,
    data,
    errors: ok ? [] : formatErrors(validateFn.errors)
  };
}
