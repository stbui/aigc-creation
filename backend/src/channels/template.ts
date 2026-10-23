/**
 * 极简模板渲染 —— 只做 `{{变量}}` 替换，不引模板引擎。
 *
 * 白名单语义
 * ----------
 * 只有 `vars` 里显式给出的键会被替换，模板里写了但没给的占位符**原样保留**。
 * 这是刻意选择：
 *   - 若静默替换成空串，运营在后台写错变量名（`{{userNmae}}`）时会发出
 *     「尊敬的 ，」这样的邮件，且没有任何报错可追；
 *   - 原样保留则错误立刻可见，日志里也能看出是模板写错而不是数据缺失。
 *
 * HTML 转义
 * ---------
 * 渲染进 HTML 的变量必须转义：昵称里出现 `<a href=...>` 时，邮件客户端会
 * 把它当链接渲染。`escapeHtml` 由调用方按输出介质选择（纯文本不转义，
 * 否则用户会看到 `&lt;`）。
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** HTML 转义：只处理会改变结构的五个字符 */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderOptions {
  /** 是否对替换值做 HTML 转义（渲染 HTML 正文时置 true） */
  escape?: boolean;
}

/**
 * @param template 含 `{{key}}` 占位符的模板
 * @param vars     变量表。未声明的键不会被替换
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined | null>,
  options: RenderOptions = {},
): string {
  if (!template) return '';
  return template.replace(PLACEHOLDER, (whole, rawKey: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, rawKey)) return whole;
    const value = vars[rawKey];
    if (value == null) return whole;
    const text = String(value);
    return options.escape ? escapeHtml(text) : text;
  });
}

/** 模板里出现但未赋值的占位符（用于后台保存模板时提示、发信时告警） */
export function findUnresolvedPlaceholders(
  rendered: string,
): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER.lastIndex = 0;
  while ((m = PLACEHOLDER.exec(rendered)) !== null) out.add(m[1]);
  return [...out];
}
