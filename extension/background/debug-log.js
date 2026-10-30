const LOG_PREFIX = "[HuojueCapture]";
const MAX_TRACE_ID_LENGTH = 80;

export const DEBUG_LOG_ENABLED = false;

export function createTraceId(value) {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TRACE_ID_LENGTH &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    return value;
  }

  return crypto.randomUUID();
}

export function debugLog(scope, traceId, event, details) {
  writeLog("info", scope, traceId, event, details);
}

export function debugWarn(scope, traceId, event, details) {
  writeLog("warn", scope, traceId, event, details);
}

export function debugError(scope, traceId, event, error, details) {
  writeLog("error", scope, traceId, event, {
    ...details,
    error: serializeError(error)
  });
}

export function describeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") {
      return `data:${String(value).slice(5, 40).split(/[;,]/, 1)[0] || "unknown"}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function writeLog(level, scope, traceId, event, details) {
  if (!DEBUG_LOG_ENABLED) {
    return;
  }

  const message = `${LOG_PREFIX}[${traceId}][${scope}] ${event}`;
  const writer = console[level] || console.log;

  if (details === undefined) {
    writer.call(console, message);
    return;
  }

  writer.call(console, message, details);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return { message: String(error) };
}
