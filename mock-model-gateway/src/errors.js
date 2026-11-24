/**
 * OpenAI 风格错误信封。
 *
 * 本项目后端的 provider 只认两种错误形状（见 openai-chat-text.provider /
 * image-provider-base）：
 *   { error: { message, type, code } }
 *   { code, message }                    ← 部分厂商的顶层形状
 * 这里统一发第一种，HTTP 状态码同时给对，避免「HTTP 200 但内容是错误」。
 */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {{ type?: string, code?: string, param?: string | null }} [extra]
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = extra.type ?? typeForStatus(status);
    this.code = extra.code ?? null;
    this.param = extra.param ?? null;
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        type: this.type,
        ...(this.param ? { param: this.param } : {}),
        ...(this.code ? { code: this.code } : {}),
      },
    };
  }
}

function typeForStatus(status) {
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 409) return 'conflict_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

export function badRequest(message, param = null, code = null) {
  return new ApiError(400, message, { param, code });
}

export function unauthorized(message = '无效的 API 密钥') {
  return new ApiError(401, message, { code: 'invalid_api_key' });
}

export function notFound(message = '资源不存在') {
  return new ApiError(404, message, { code: 'not_found' });
}
