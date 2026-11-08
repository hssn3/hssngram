export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'ورود لازم است') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'دسترسی مجاز نیست') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'یافت نشد') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const tooMany = (message = 'درخواست‌های زیادی ارسال شده است') =>
  new HttpError(429, 'too_many_requests', message);
export const payloadTooLarge = (message = 'حجم فایل بیش از حد مجاز است') =>
  new HttpError(413, 'payload_too_large', message);
