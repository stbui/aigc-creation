import { parseCredits } from '../../../lib/microcredits';

/** 选择器文本 ⇄ 对象：`operation=generate, size=1024x1024` */
export function parseSelector(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(text ?? '').split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = String(rawKey ?? '').trim();
    const value = rest.join('=').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function formatSelector(selector: Record<string, string>): string {
  return Object.entries(selector ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

/** 标签颜色（与参考实现 `lib/model-tags.ts` 的 6 色一致） */
export const TAG_COLOR_LABELS: Record<string, string> = {
  purple: '紫色',
  blue: '蓝色',
  green: '绿色',
  gold: '金色',
  orange: '橙色',
  pink: '粉色',
};

/** 展示标签：最多 5 个，每个 1–12 字，文字不可重复（与后端校验同口径） */
export const MAX_MODEL_TAGS = 5;
export const MAX_TAG_TEXT_LENGTH = 12;

/** 标签校验：返回错误文案，无错返回 null */
export function validateModelTags(tags: Array<{ text: string; color: string }>): string | null {
  const list = (tags ?? []).filter((tag) => tag.text.trim() !== '');
  if (list.length > MAX_MODEL_TAGS) return `最多添加 ${MAX_MODEL_TAGS} 个标签`;
  for (const tag of list) {
    const length = [...tag.text.trim()].length;
    if (length < 1 || length > MAX_TAG_TEXT_LENGTH) {
      return `标签文字须为 1–${MAX_TAG_TEXT_LENGTH} 字`;
    }
  }
  const texts = list.map((tag) => tag.text.trim());
  if (new Set(texts).size !== texts.length) return '标签文字不能重复';
  return null;
}

export function priceOf(text: string, label: string): number {
  const value = parseCredits(text);
  if (value === null) throw new Error(`${label}格式不正确，请填积分，最多 6 位小数`);
  return value;
}

/** 输入框里有正的积分值；空串 / 0 / 非法值都算“没填” */
export function hasNonZeroCredit(text: string): boolean {
  const value = parseCredits(text);
  return value !== null && value > 0;
}
