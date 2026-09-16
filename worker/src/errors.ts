export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
