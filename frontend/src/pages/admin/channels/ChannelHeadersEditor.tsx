/**
 * 渠道「自定义请求头」结构化编辑器。
 *
 * 移植自 open-ai-canvas `web/src/components/channel-headers-editor.tsx`：
 * 把原先一坨 JSON 文本框换成逐行「名称 / 值 / 删除」，并在提交前做一次
 * 与服务端完全一致的前置校验（`normalizeOutboundHeaders`）。
 *
 * 为什么还要在前端校验一遍：服务端拒绝时只回一句错误，用户不知道是哪一行；
 * 这里逐条给出行级判定，能在点保存之前定位到具体请求头。**规则以后端为准**，
 * 前端只负责提前拦下同一批错误，不放宽任何一条。
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button, TextInput } from './components';

export interface ChannelHeader {
  name: string;
  value: string;
}

/** 与 `backend/src/model/infra/outbound.ts` 的 `DEFAULT_USER_AGENT` 保持一致 */
export const DEFAULT_USER_AGENT = 'ecom-vision/1.0';
export const MAX_HEADER_COUNT = 32;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 与后端 `blockedOutboundHeader` 同一份名单：这些头由出站层或协议适配器写入 */
const BLOCKED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'content-type',
  'accept',
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'forwarded',
  'x-goog-api-key',
]);

/** 值里只允许可打印 ASCII 与横向制表符（与后端逐字符判定一致） */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || (code >= 32 && code !== 127)) continue;
    return true;
  }
  return false;
}

/**
 * 返回第一条错误文案；空串表示通过。
 *
 * 空行（名称与值都为空）直接跳过，不算错误 —— 用户点了「添加请求头」还没填时
 * 不应该被报错打断。
 */
export function validateChannelHeaders(headers: ChannelHeader[]): string {
  if (headers.length === 0) return '';
  if (headers.length > MAX_HEADER_COUNT) return `自定义请求头最多支持 ${MAX_HEADER_COUNT} 项`;
  const seen = new Set<string>();
  let total = 0;
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name && !value) continue;
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      return '请求头名称无效，请使用标准 HTTP Header 名称';
    }
    const lower = name.toLowerCase();
    if (BLOCKED_HEADERS.has(lower) || lower.startsWith('x-canvas-') || lower.startsWith('x-forwarded-')) {
      return `${name} 由系统管理，不允许自定义`;
    }
    if (seen.has(lower)) return `请求头不能重复：${name}`;
    if (hasControlChar(value)) return `${name} 的值包含非法控制字符`;
    if (name.length > MAX_NAME_LENGTH || value.length > MAX_VALUE_LENGTH) {
      return '单个请求头名称或值过长';
    }
    total += name.length + value.length;
    if (total > MAX_HEADER_BYTES) return '自定义请求头总大小不能超过 16KB';
    seen.add(lower);
  }
  return '';
}

/** 提交前裁掉首尾空白并丢弃空行，与服务端 `normalizeOutboundHeaders` 的落库形态一致 */
export function normalizeChannelHeaders(headers: ChannelHeader[]): ChannelHeader[] {
  return headers
    .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name !== '' || header.value !== '');
}

export function ChannelHeadersEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ChannelHeader[];
  onChange: (headers: ChannelHeader[]) => void;
  disabled?: boolean;
}) {
  const headers = value;
  const validation = validateChannelHeaders(headers);
  const hasUserAgent = headers.some((header) => header.name.trim().toLowerCase() === 'user-agent');
  const full = headers.length >= MAX_HEADER_COUNT;

  const updateHeader = (index: number, patch: Partial<ChannelHeader>) => {
    onChange(headers.map((header, itemIndex) => (itemIndex === index ? { ...header, ...patch } : header)));
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-table bg-surface/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-primary">自定义请求头</div>
          <div className="mt-0.5 break-all text-[11px] leading-4 text-text-tertiary">
            默认发送 {DEFAULT_USER_AGENT}；添加 User-Agent 后会覆盖默认值。
          </div>
        </div>
        {!hasUserAgent && (
          <Button
            variant="secondary"
            size="xs"
            disabled={disabled || full}
            onClick={() => onChange([...headers, { name: 'User-Agent', value: DEFAULT_USER_AGENT }])}
          >
            添加 User-Agent
          </Button>
        )}
      </div>

      {headers.map((header, index) => (
        <div
          key={index}
          className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_32px] items-center gap-2"
        >
          <TextInput
            ariaLabel={`请求头 ${index + 1} 名称`}
            value={header.name}
            onChange={(next) => updateHeader(index, { name: next })}
            placeholder="Header 名称"
            disabled={disabled}
          />
          <TextInput
            ariaLabel={`请求头 ${index + 1} 值`}
            value={header.value}
            onChange={(next) => updateHeader(index, { value: next })}
            placeholder="Header 值"
            disabled={disabled}
            /* 名字像凭据就遮起来：截图与投屏时不该把值摊在屏幕上 */
            type={/token|key|secret/i.test(header.name) ? 'password' : 'text'}
          />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Trash2}
            aria-label={`删除请求头 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(headers.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="xs"
          leadingIcon={Plus}
          disabled={disabled || full}
          onClick={() => onChange([...headers, { name: '', value: '' }])}
        >
          添加请求头
        </Button>
        <span className={validation ? 'text-[11px] text-rose-600' : 'text-[11px] text-text-tertiary'}>
          {validation || `${headers.length}/${MAX_HEADER_COUNT}`}
        </span>
      </div>
    </div>
  );
}
