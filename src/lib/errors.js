/**
 * Error types shared by the whole application.
 *
 * Rules:
 *  - `HttpError` and its subclasses carry a message that is safe to show a user.
 *  - Anything else that escapes a handler is treated as an internal fault: the
 *    stack goes to the log, the user gets a generic 500 page.
 */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message user-safe message
   * @param {{code?:string, details?:object}} [options]
   */
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
    this.code = options.code;
    this.details = options.details;
  }
}

/** A business-rule violation, e.g. "that slot is no longer available". */
export class DomainError extends HttpError {
  constructor(message, options = {}) {
    super(options.status ?? 400, message, options);
    this.name = 'DomainError';
  }
}

/** Field-level input problems collected by the validator. */
export class ValidationError extends HttpError {
  /** @param {Record<string,string>} fieldErrors */
  constructor(fieldErrors, message = 'Please correct the highlighted fields.') {
    super(422, message, { code: 'validation_failed' });
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Thrown to send a redirect from anywhere in the request pipeline. */
export class RedirectError extends Error {
  /**
   * @param {string} location
   * @param {{type:'success'|'error'|'info', message:string}|null} [flash]
   * @param {number} [status]
   */
  constructor(location, flash = null, status = 302) {
    super(`Redirect to ${location}`);
    this.name = 'RedirectError';
    this.location = location;
    this.flash = flash;
    this.status = status;
  }
}

export const badRequest = (message = 'That request could not be processed.', options) =>
  new HttpError(400, message, options);

export const unauthorized = (message = 'You need to sign in to continue.', options) =>
  new HttpError(401, message, options);

export const forbidden = (message = 'You do not have access to that.', options) =>
  new HttpError(403, message, options);

export const notFound = (message = 'That page could not be found.', options) =>
  new HttpError(404, message, options);

export const conflict = (message = 'That action conflicts with the current state.', options) =>
  new HttpError(409, message, options);

export const tooManyRequests = (message = 'Too many attempts. Please try again shortly.', options) =>
  new HttpError(429, message, options);

export const payloadTooLarge = (message = 'That submission is too large.', options) =>
  new HttpError(413, message, options);
