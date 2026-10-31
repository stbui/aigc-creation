/**
 * 声明式清单表达式求值器。
 *
 * 逐条移植 open-ai-canvas `internal/protocol/expression.go`。插件用一小组
 * `$` 前缀操作符拼装上游请求体，宿主只做纯数据变换 —— **不执行插件代码**，
 * 也绝不使用 `eval` / `new Function`：清单来自可上传的插件包，任何可执行能力
 * 都是远程代码执行面。
 *
 * 语义要点（与参考实现保持一致，改动前先看单测）：
 * - 字符串整串形如 `${request.model}` 时取路径值；否则原样保留；
 * - 数组与对象的求值结果中 `null` 会被丢弃（这是 `$omitEmpty` 之外的第二层兜底）；
 * - 对象只有一个键且以 `$` 开头时才按操作符解释，多键对象一律当模板；
 * - 数值统一走 `normalizeNumber`：整数值返回 number，否则返回浮点。
 */

export type ManifestEnv = Record<string, any>;

export class ManifestExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestExpressionError';
  }
}

const SCALAR_TYPES = new Set(['string', 'number', 'boolean', 'bigint']);

/** 求值入口 */
export function evaluateManifestValue(template: any, env: ManifestEnv): any {
  if (template === null || template === undefined) return template ?? null;
  if (SCALAR_TYPES.has(typeof template)) {
    if (typeof template === 'string') {
      const trimmed = template.trim();
      if (trimmed.startsWith('${') && trimmed.endsWith('}')) {
        return manifestPathValue(env, trimmed.slice(2, -1).trim());
      }
    }
    return template;
  }
  if (Array.isArray(template)) {
    const result: any[] = [];
    for (const item of template) {
      const evaluated = evaluateManifestValue(item, env);
      if (evaluated !== null && evaluated !== undefined) result.push(evaluated);
    }
    return result;
  }
  if (typeof template === 'object') {
    const keys = Object.keys(template);
    if (keys.length === 1 && keys[0].startsWith('$')) {
      return evaluateManifestOperator(keys[0], template[keys[0]], env);
    }
    const result: Record<string, any> = {};
    for (const key of keys) {
      const evaluated = evaluateManifestValue(template[key], env);
      if (evaluated !== null && evaluated !== undefined) result[key] = evaluated;
    }
    return result;
  }
  throw new ManifestExpressionError(`不支持的清单模板值：${typeof template}`);
}

function evaluateManifestOperator(operator: string, operand: any, env: ManifestEnv): any {
  switch (operator) {
    case '$ref': {
      if (typeof operand !== 'string') throw new ManifestExpressionError('$ref 需要字符串路径');
      return manifestPathValue(env, operand);
    }
    case '$literal':
      return operand;
    case '$coalesce':
    case '$default': {
      const values = requireArray(operator, operand);
      for (const item of values) {
        const value = evaluateManifestValue(item, env);
        if (!manifestEmpty(value)) return value;
      }
      return null;
    }
    case '$concat': {
      const values = requireArray(operator, operand);
      return values
        .map((item) => evaluateManifestValue(item, env))
        .filter((value) => value !== null && value !== undefined)
        .map((value) => manifestString(value))
        .join('');
    }
    case '$concatArrays': {
      const values = requireArray(operator, operand);
      const result: any[] = [];
      for (const item of values) result.push(...manifestArray(evaluateManifestValue(item, env)));
      return result;
    }
    case '$map':
    case '$filter': {
      const spec = requireObject(operator, operand);
      const from = evaluateManifestValue(spec.from, env);
      const alias = manifestString(spec.as).trim() || 'item';
      const items = manifestArray(from);
      const result: any[] = [];
      items.forEach((item, index) => {
        const child: ManifestEnv = { ...env, [alias]: item, [`${alias}Index`]: index };
        if (operator === '$filter') {
          if (manifestTruthy(evaluateManifestValue(spec.where, child))) result.push(item);
          return;
        }
        const mapped = evaluateManifestValue(spec.in, child);
        if (mapped !== null && mapped !== undefined) result.push(mapped);
      });
      return result;
    }
    case '$indexObject': {
      const spec = requireObject(operator, operand);
      const from = evaluateManifestValue(spec.from, env);
      const alias = manifestString(spec.as).trim() || 'item';
      const prefix = manifestString(evaluateManifestValue(spec.prefix, env));
      const items = manifestArray(from);
      let maxItems = items.length;
      if (spec.max !== undefined && spec.max !== null) {
        const configured = manifestInt(evaluateManifestValue(spec.max, env));
        if (configured >= 0 && configured < maxItems) maxItems = configured;
      }
      const result: Record<string, any> = {};
      items.slice(0, maxItems).forEach((item, index) => {
        const child: ManifestEnv = { ...env, [alias]: item, [`${alias}Index`]: index };
        const value = evaluateManifestValue(spec.value, child);
        if (!manifestEmpty(value)) result[`${prefix}${index}`] = value;
      });
      return result;
    }
    case '$first':
    case '$last': {
      const items = manifestArray(evaluateManifestValue(operand, env));
      if (items.length === 0) return null;
      return operator === '$last' ? items[items.length - 1] : items[0];
    }
    case '$at': {
      const values = requireArray(operator, operand, 2);
      const items = manifestArray(evaluateManifestValue(values[0], env));
      const index = manifestInt(evaluateManifestValue(values[1], env));
      if (index < 0 || index >= items.length) return null;
      return items[index];
    }
    case '$len': {
      const value = evaluateManifestValue(operand, env);
      if (Array.isArray(value)) return value.length;
      if (value && typeof value === 'object') return Object.keys(value).length;
      if (typeof value === 'string') return [...value].length;
      return 0;
    }
    case '$split': {
      const values = requireArray(operator, operand, 2);
      const value = manifestString(evaluateManifestValue(values[0], env));
      const separator = manifestString(evaluateManifestValue(values[1], env));
      if (!separator) throw new ManifestExpressionError('$split 分隔符不能为空');
      return value.split(separator);
    }
    case '$if': {
      const spec = requireObject(operator, operand);
      return manifestTruthy(evaluateManifestValue(spec.condition, env))
        ? evaluateManifestValue(spec.then, env)
        : evaluateManifestValue(spec.else, env);
    }
    case '$switch': {
      const spec = requireObject(operator, operand);
      for (const rawCase of manifestArray(spec.cases)) {
        const item = (rawCase ?? {}) as Record<string, any>;
        if (manifestTruthy(evaluateManifestValue(item.when, env))) {
          return evaluateManifestValue(item.then, env);
        }
      }
      return evaluateManifestValue(spec.default, env);
    }
    case '$omitEmpty': {
      const value = evaluateManifestValue(operand, env);
      return manifestEmpty(value) ? null : value;
    }
    case '$lower':
    case '$upper':
    case '$trim':
    case '$toString':
    case '$toInt':
    case '$toFloat':
    case '$toBool':
    case '$dataMime':
    case '$dataPayload':
    case '$json': {
      const value = evaluateManifestValue(operand, env);
      const text = manifestString(value);
      switch (operator) {
        case '$lower':
          return text.toLowerCase();
        case '$upper':
          return text.toUpperCase();
        case '$trim':
          return text.trim();
        case '$toString':
          return text;
        case '$toInt':
          return manifestInt(value);
        case '$toFloat': {
          const parsed = manifestFloatValue(value);
          return parsed.ok ? parsed.value : null;
        }
        case '$toBool':
          return manifestTruthy(value);
        case '$dataMime':
          return dataMime(text);
        case '$dataPayload':
          return dataPayload(text);
        default:
          return stableJson(value);
      }
    }
    case '$merge': {
      const values = requireArray(operator, operand);
      const result: Record<string, any> = {};
      for (const item of values) {
        Object.assign(result, manifestObject(evaluateManifestValue(item, env)));
      }
      return result;
    }
    case '$sortByOrder': {
      const items = [...manifestArray(evaluateManifestValue(operand, env))];
      return items
        .map((item, index) => ({ item, index }))
        .sort((left, right) => {
          const diff = manifestInt(manifestPathValue(left.item, 'order')) - manifestInt(manifestPathValue(right.item, 'order'));
          return diff !== 0 ? diff : left.index - right.index;
        })
        .map((entry) => entry.item);
    }
    case '$add':
    case '$multiply':
    case '$divide':
    case '$min':
    case '$max': {
      const values = requireArray(operator, operand);
      if (values.length === 0) throw new ManifestExpressionError(`${operator} 需要数组`);
      if (operator === '$divide') {
        if (values.length !== 2) throw new ManifestExpressionError('$divide 需要 [被除数, 除数]');
        const numerator = manifestFloat(evaluateManifestValue(values[0], env));
        const denominator = manifestFloat(evaluateManifestValue(values[1], env));
        if (denominator === 0) throw new ManifestExpressionError('$divide 除数不能为 0');
        return normalizeManifestNumber(numerator / denominator);
      }
      let result = operator === '$multiply' ? 1 : operator === '$min' ? Infinity : operator === '$max' ? -Infinity : 0;
      for (const item of values) {
        const number = manifestFloat(evaluateManifestValue(item, env));
        if (operator === '$multiply') result *= number;
        else if (operator === '$min') result = Math.min(result, number);
        else if (operator === '$max') result = Math.max(result, number);
        else result += number;
      }
      return normalizeManifestNumber(result);
    }
    case '$ceilStep': {
      const values = requireArray(operator, operand, 2);
      const value = manifestFloat(evaluateManifestValue(values[0], env));
      const step = manifestFloat(evaluateManifestValue(values[1], env));
      if (step <= 0) throw new ManifestExpressionError('$ceilStep 步长必须为正');
      return normalizeManifestNumber(Math.ceil(value / step) * step);
    }
    case '$eq':
    case '$ne':
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
    case '$in':
    case '$and':
    case '$or':
      return evaluateManifestComparison(operator, operand, env);
    case '$not': {
      const value = evaluateManifestValue(operand, env);
      return !manifestTruthy(value);
    }
    default:
      throw new ManifestExpressionError(`不支持的清单操作符 "${operator}"`);
  }
}

function evaluateManifestComparison(operator: string, operand: any, env: ManifestEnv): any {
  const values = requireArray(operator, operand);
  const evaluated = values.map((item) => evaluateManifestValue(item, env));
  if (operator === '$and' || operator === '$or') {
    let result = operator === '$and';
    for (const value of evaluated) {
      result = operator === '$and' ? result && manifestTruthy(value) : result || manifestTruthy(value);
    }
    return result;
  }
  if (evaluated.length !== 2) throw new ManifestExpressionError(`${operator} 需要两个操作数`);
  const [left, right] = evaluated;
  switch (operator) {
    case '$eq':
      return stableJson(left) === stableJson(right);
    case '$ne':
      return stableJson(left) !== stableJson(right);
    case '$gt':
      return manifestFloat(left) > manifestFloat(right);
    case '$gte':
      return manifestFloat(left) >= manifestFloat(right);
    case '$lt':
      return manifestFloat(left) < manifestFloat(right);
    case '$lte':
      return manifestFloat(left) <= manifestFloat(right);
    case '$in': {
      const target = stableJson(left);
      return manifestArray(right).some((item) => stableJson(item) === target);
    }
    default:
      return false;
  }
}

/** 模板字符串插值：把 `{{path}}` 替换为路径值（用于 URL / 请求头等） */
export function interpolateManifestString(value: string, env: ManifestEnv): string {
  let result = String(value ?? '');
  for (;;) {
    const start = result.indexOf('{{');
    if (start < 0) return result;
    const endOffset = result.slice(start + 2).indexOf('}}');
    if (endOffset < 0) return result;
    const end = start + 2 + endOffset;
    const path = result.slice(start + 2, end).trim();
    result = `${result.slice(0, start)}${manifestString(manifestPathValue(env, path))}${result.slice(end + 2)}`;
  }
}

/** 点号路径取值，支持数组下标 */
export function manifestPathValue(root: any, path: string): any {
  if (!String(path ?? '').trim()) return root;
  let value = root;
  for (const part of String(path).replace(/^\.+|\.+$/g, '').split('.')) {
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length) return null;
      value = value[index];
      continue;
    }
    if (value && typeof value === 'object') {
      value = value[part];
      continue;
    }
    return null;
  }
  return value === undefined ? null : value;
}

/** 统一把单值当数组处理（对齐参考实现 manifestArray） */
export function manifestArray(value: any): any[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function manifestObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** 空判定：null / 空白字符串 / 空数组 / 空对象 */
export function manifestEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** 真值判定：字符串 "false" / "0" / "no" / "null" 视为假 */
export function manifestTruthy(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && !['false', '0', 'no', 'null'].includes(normalized);
  }
  if (typeof value === 'number' || typeof value === 'bigint') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** 任意值 → 字符串（数字不使用科学计数法） */
export function manifestString(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return stableJson(value);
}

/** 任意值 → 数字；字符串按十进制解析 */
export function manifestFloat(value: any): number {
  const parsed = manifestFloatValue(value);
  return parsed.ok ? parsed.value : 0;
}

function manifestFloatValue(value: any): { ok: boolean; value: number } {
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  if (typeof value === 'bigint') return { ok: true, value: Number(value) };
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, value: 0 };
  }
  return { ok: false, value: 0 };
}

export function manifestInt(value: any): number {
  return Math.trunc(manifestFloat(value));
}

/** 整数值返回 number，否则保留小数（对齐 normalizeManifestNumber） */
export function normalizeManifestNumber(value: number): number {
  return Number.isInteger(value) ? value : value;
}

/** 稳定序列化：对象键排序，保证 `$eq` 与 Go 的 `json.Marshal` 同语义 */
export function stableJson(value: any): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) result[key] = sortKeys(value[key]);
    return result;
  }
  return value;
}

function dataMime(value: string): string {
  if (value.startsWith('data:')) {
    const index = value.indexOf(';');
    if (index > 5) return value.slice(5, index);
  }
  return 'application/octet-stream';
}

function dataPayload(value: string): string {
  if (value.startsWith('data:')) {
    const index = value.indexOf(',');
    if (index >= 0) return value.slice(index + 1);
  }
  return value;
}

function requireArray(operator: string, operand: any, expected?: number): any[] {
  if (!Array.isArray(operand)) throw new ManifestExpressionError(`${operator} 需要数组`);
  if (expected !== undefined && operand.length !== expected) {
    throw new ManifestExpressionError(`${operator} 需要 ${expected} 个操作数`);
  }
  return operand;
}

function requireObject(operator: string, operand: any): Record<string, any> {
  if (!operand || typeof operand !== 'object' || Array.isArray(operand)) {
    throw new ManifestExpressionError(`${operator} 需要对象`);
  }
  return operand;
}
