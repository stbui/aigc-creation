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
import { ActionButton, IconButton, TextField } from './components';
import type { ChannelHeader } from './constants';
import { DEFAULT_USER_AGENT, MAX_HEADER_COUNT, validateChannelHeaders } from './utils';

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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">自定义请求头</div>
          <div className="mt-0.5 break-all text-[12px] leading-4 text-muted-foreground">
            默认发送 {DEFAULT_USER_AGENT}；添加 User-Agent 后会覆盖默认值。
          </div>
        </div>
        {!hasUserAgent && (
          <ActionButton
            variant="secondary"
            size="xs"
            disabled={disabled || full}
            onClick={() => onChange([...headers, { name: 'User-Agent', value: DEFAULT_USER_AGENT }])}
          >
            添加 User-Agent
          </ActionButton>
        )}
      </div>

      {headers.map((header, index) => (
        <div
          key={index}
          className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_32px] items-center gap-2"
        >
          <TextField
            ariaLabel={`请求头 ${index + 1} 名称`}
            value={header.name}
            onChange={(next) => updateHeader(index, { name: next })}
            placeholder="Header 名称"
            disabled={disabled}
          />
          <TextField
            ariaLabel={`请求头 ${index + 1} 值`}
            value={header.value}
            onChange={(next) => updateHeader(index, { value: next })}
            placeholder="Header 值"
            disabled={disabled}
            /* 名字像凭据就遮起来：截图与投屏时不该把值摊在屏幕上 */
            type={/token|key|secret/i.test(header.name) ? 'password' : 'text'}
          />
          <IconButton
            icon={Trash2}
            size="xs"
            label={`删除请求头 ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(headers.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActionButton
          variant="secondary"
          size="xs"
          icon={Plus}
          disabled={disabled || full}
          onClick={() => onChange([...headers, { name: '', value: '' }])}
        >
          添加请求头
        </ActionButton>
        <span className={validation ? 'text-[12px] text-danger-text' : 'text-[12px] text-muted-foreground'}>
          {validation || `${headers.length}/${MAX_HEADER_COUNT}`}
        </span>
      </div>
    </div>
  );
}
