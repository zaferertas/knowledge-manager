export class AiFailure extends Error {
  constructor(readonly code: 'AI_TIMEOUT' | 'AI_UNAVAILABLE', message: string = code) {
    super(message);
  }
}
