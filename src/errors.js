export class AppError extends Error {
  constructor({
    message,
    statusCode,
    errorCode,
    retryable = false,
    details = undefined,
  }) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function toErrorResponse(error) {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      payload: {
        code: -1,
        message: error.message,
        errorCode: error.errorCode,
        retryable: error.retryable,
      },
    };
  }

  return {
    statusCode: 500,
    payload: {
      code: -1,
      message: "Internal server error.",
      errorCode: "INTERNAL_ERROR",
      retryable: true,
    },
  };
}
