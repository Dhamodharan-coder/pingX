export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
