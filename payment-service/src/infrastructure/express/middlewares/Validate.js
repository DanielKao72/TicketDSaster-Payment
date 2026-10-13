const { HttpError } = require('../HttpError');

// Validates req.body, req.params and req.query against zod schemas before the
// controller runs, and replaces them with the parsed values.
function validate(schemas) {
  return (req, res, next) => {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;

      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const message = result.error.issues
          .map((issue) => `${[part, ...issue.path].join('.')}: ${issue.message}`)
          .join('; ');
        next(new HttpError(400, 'VALIDATION_ERROR', message));
        return;
      }
      req[part] = result.data;
    }
    next();
  };
}

module.exports = { validate };
