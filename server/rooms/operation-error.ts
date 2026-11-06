export class RoomOperationError extends Error {
  constructor(message: string, readonly status = 409, readonly code?: string) {
    super(message);
  }
}
