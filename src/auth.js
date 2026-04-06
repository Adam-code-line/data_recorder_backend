import { AppError } from "./errors.js";

export function extractTaskIdHeader(request) {
  const raw = request.headers["x-upload-task-id"];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  if (typeof raw === "string") {
    return raw.trim();
  }
  return "";
}

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return match[1].trim();
}

export function buildAuthPreHandler(config) {
  const allowedTokens = new Set(config.authTokens);

  return async function authPreHandler(request) {
    if (!config.requireAuth) {
      return;
    }

    const authHeader = request.headers.authorization;
    const bearerToken = extractBearerToken(authHeader);

    let token = bearerToken;
    if (!token) {
      const legacyHeaderValue = request.headers[config.legacyTokenHeaderName];
      if (typeof legacyHeaderValue === "string") {
        token = legacyHeaderValue.trim();
      }
    }

    if (!token || !allowedTokens.has(token)) {
      throw new AppError({
        statusCode: 401,
        errorCode: "UNAUTHORIZED",
        message: "Unauthorized.",
        retryable: false,
      });
    }
  };
}
