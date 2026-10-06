export class RoomOperationError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}
