import { CheckCircle2, XCircle } from 'lucide-react';
import { ActionButton, ToneBadge } from './components';
import { META } from './constants';
import type { StorageBackendId, StorageBackendRow } from './types';
import { cn } from './utils';

/**
 * 未启用不是终点：把「装 SDK → 配变量 → 重启」三步摆出来，
 * 运营不必去翻代码或后端日志才知道下一步做什么。
 * 凭据仍只从环境变量读，这里只给变量名与命令，不提供输入框。
 */
function StorageBackendSetup({ meta }: { meta: (typeof META)[StorageBackendId] }) {
  return (
    <div className="mt-3" data-testid="admin-storage-setup">
      <div className="text-[12px] font-medium text-foreground">启用步骤</div>

      {meta.sdk && (
        <>
          <div className="mt-2 text-[12px] text-muted-foreground">① 安装 SDK</div>
          <code
            data-testid="admin-storage-sdk"
            className="mt-1 block break-all rounded-sm border border-border bg-muted px-1.5 py-1 font-mono text-[11px] text-foreground"
          >
            {meta.sdk}
          </code>
        </>
      )}

      <div className="mt-2 text-[12px] text-muted-foreground">② 配置环境变量（必填）</div>
      <div data-testid="admin-storage-env" className="mt-1 flex flex-wrap gap-1">
        {meta.envKeys.map((key) => (
          <code
            key={key}
            className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground"
          >
            {key}
          </code>
        ))}
      </div>

      {meta.optionalKeys && meta.optionalKeys.length > 0 && (
        <>
          <div className="mt-1.5 text-[12px] text-muted-foreground">可选 / 有默认值</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {meta.optionalKeys.map((key) => (
              <code
                key={key}
                className="rounded-sm border border-dashed border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {key}
              </code>
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-[12px] leading-4 text-muted-foreground">
        ③ 写入 <code className="font-mono">{'.env.<env>.local'}</code> 并重启后端，本卡片即可探测与切换。
      </p>
    </div>
  );
}

/** 单个存储后端卡片：状态、脱敏凭据、启用步骤与两个写操作入口。 */
export function StorageBackendCard({
  backend: b,
  probing,
  busy,
  canProbe,
  canSwitch,
  onProbe,
  onSwitch,
}: {
  backend: StorageBackendRow;
  probing: boolean;
  busy: boolean;
  canProbe: boolean;
  canSwitch: boolean;
  onProbe: () => void;
  onSwitch: () => void;
}) {
  const meta = META[b.backend as StorageBackendId] ?? META.local;
  const Icon = meta.icon;

  return (
    <section
      data-testid="admin-storage-card"
      data-backend={b.backend}
      data-active={b.active ? 'true' : 'false'}
      className={cn(
        'flex flex-col rounded-lg border bg-card p-4 shadow-card',
        b.active ? 'border-ring' : 'border-border',
        !b.configured && 'bg-muted/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-0.5 shrink-0', b.active ? 'text-brand' : 'text-muted-foreground')}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{meta.label}</span>
            {b.active && (
              <ToneBadge tone="brand">
                <span data-testid="admin-storage-badge">当前</span>
              </ToneBadge>
            )}
          </div>
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{meta.desc}</p>
        </div>
      </div>

      <div className="mt-3">
        {b.available ? (
          <ToneBadge tone="success">
            <CheckCircle2 className="mr-1 size-3" aria-hidden />
            连通正常
            {b.probeLatencyMs ? ` ${b.probeLatencyMs}ms` : ''}
          </ToneBadge>
        ) : b.configured ? (
          <ToneBadge tone="danger">
            <XCircle className="mr-1 size-3" aria-hidden />
            不可用
          </ToneBadge>
        ) : (
          <ToneBadge tone="neutral">未启用</ToneBadge>
        )}
      </div>

      {b.probeMessage && (
        <p className="mt-2 font-mono text-[12px] leading-4 break-all text-muted-foreground">{b.probeMessage}</p>
      )}

      <dl className="mt-3 grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 text-[12px] leading-4">
        <dt className="text-muted-foreground">凭据</dt>
        <dd className="min-w-0 truncate font-mono text-foreground">
          {b.masked ? (
            b.masked
          ) : (
            <span className="font-sans text-muted-foreground">
              {b.backend === 'local' ? '无需凭据' : '未配置'}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">地址</dt>
        <dd className="min-w-0 truncate font-mono text-foreground">{b.endpoint ?? '—'}</dd>
      </dl>

      {!b.configured && b.backend !== 'local' && <StorageBackendSetup meta={meta} />}

      <div className="mt-auto flex items-center gap-2 pt-3">
        {canProbe && b.configured && (
          <ActionButton
            variant="secondary"
            disabled={probing}
            onClick={onProbe}
          >
            {probing ? '测试中…' : '连通性测试'}
          </ActionButton>
        )}
        {canSwitch && b.configured && !b.active && (
          <ActionButton disabled={busy} onClick={onSwitch}>
            设为默认
          </ActionButton>
        )}
      </div>
    </section>
  );
}
