export class AppError extends Error {
  constructor(
    public readonly code:
      'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'unauthenticated' | 'rate_limited',
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
