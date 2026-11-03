/** 提示词工具在各类失败下给用户看的文案；技术细节只留在内部错误对象与日志中。 */

export type PromptToolAction = 'polish' | 'image';

const CHINESE_TEXT = /[\u3400-\u9fff]/;
const TECHNICAL_TERMS =
  /text|渠道|模型|配置|协议|请求号|api|http|mock|gateway|uuid|request[-\s]?id|\bid\b|[0-9a-f]{8}-[0-9a-f-]{27,}/i;

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.trim() : '';
}

export function promptToolErrorMessage(error: unknown, action: PromptToolAction): string {
  const fallback = action === 'polish' ? '润色暂时不可用，请稍后再试' : '图片分析暂时不可用，请稍后再试';
  const status = statusOf(error);

  if (status === 401) return '请先登录';
  if (status === 429) return '操作太频繁，请稍后再试';
  if (status === 403) return '当前操作暂不可用，请稍后再试';

  // 4xx 多为用户可自行处理的输入或素材问题；只在文案本身足够通俗时透出。
  if (status !== null && status >= 400 && status < 500) {
    const message = messageOf(error);
    if (message && CHINESE_TEXT.test(message) && !TECHNICAL_TERMS.test(message)) return message;
  }

  return fallback;
}
