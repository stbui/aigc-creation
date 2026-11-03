import { useState } from 'react';
import { META } from './constants';
import { useAdmin, useToast, useAdminResource } from './hooks';
import { CheckCircle2, Lock, RefreshCw, XCircle } from 'lucide-react';

import { adminStorageApi } from '../../../lib/api';

import { ActionButton, EmptyState, ListError, Notice, PageHeader, PageSkeleton, Skeleton, StaleError, ToneBadge } from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
import type { StorageBackendId } from '../../../types/api';

/**
 * 存储后端配置 (B-62/B-63)。
 *
 * 凭据只读：PRD §3.11 明确约束「凭据走部署期环境变量，界面不可编辑」。
 * 所以本页没有任何写凭据的输入框 —— 展示脱敏值 + 连通性 + 切换默认后端。
 * 这不是功能缺失，是刻意的安全边界。
 */
export function AdminStoragePage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [probing, setProbing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAdminResource(() => adminStorageApi.status());

  const probe = async (backend: StorageBackendId) => {
    setProbing(backend);
    try {
      const res = await adminStorageApi.probe(backend);
      if (res.ok) {
        toast.success(
          `${META[backend].label} 连通正常${res.latencyMs ? ` (${res.latencyMs}ms)` : ''}`,
        );
      } else {
        toast.error(res.message);
      }
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProbing(null);
    }
  };

  /** 切换只改运行时默认值，按产品要求直接执行，不再弹窗二次确认 */
  const doSwitch = async (backend: StorageBackendId) => {
    setBusy(true);
    try {
      const res = await adminStorageApi.setActive(backend);
      toast.success(`默认后端已切到 ${META[backend].label} — ${res.note}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * 守卫只在「还没有数据」时替换**正文**。探测/切换后端之后要重拉状态 ——
   * 无条件替换会让用户刚点的后端卡片闪一下消失，看起来像操作失败重载。
   *
   * 页头照常渲染：加载期间标题与「刷新」按钮就该在位，否则首屏先闪一段
   * 没有标题的灰条，再突然冒出完整页面 —— 版面跳两次比跳一次更难接受。
   *
   * 凭据提示是**固定文案**（与数据无关），所以骨架态也照常渲染：它占着
   * 页头与卡片之间的位置，数据到位时卡片不会往上跳一截。只有末行的
   * `credentialSource` 来自接口 —— 加载期间用一根灰条占位，高度对得上。
   */
  const credentialNotice = (loading: boolean) => (
    <Notice
      tone="locked"
      title="凭据不在界面配置。"
      icon={<Lock className="size-4 shrink-0" aria-hidden />}
    >
      <p>出于安全考虑，OSS / MinIO 的密钥只从部署环境变量读取，页面仅显示是否配置与脱敏值。</p>
      {loading ? (
        <Skeleton className="mt-1 h-3 w-72" />
      ) : (
        <code className="mt-1 block font-mono text-[12px] break-all text-muted-foreground">
          {data?.credentialSource}
        </code>
      )}
    </Notice>
  );

  if (loading && !data) {
    return (
      <PageSkeleton
        title="存储配置"
        description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
        actions={
          <ActionButton variant="secondary" icon={RefreshCw} disabled>
            刷新
          </ActionButton>
        }
        notice={credentialNotice(true)}
        panels={0}
        cards={3}
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="暂无存储后端信息" />;

  return (
    <>
      <PageHeader
        title="存储配置"
        description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
        actions={
          <ActionButton
            variant="secondary"
            icon={RefreshCw}
            disabled={loading}
            onClick={() => void reload()}
          >
            刷新
          </ActionButton>
        }
      />

      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {/*
       * 有数据时的刷新**不塌页面**：卡片留在原位，只是「刷新」按钮禁用。
       * 探测/切换后端之后要重拉状态 —— 无条件替换会让用户刚点的后端卡片闪一下
       * 消失，看起来像操作失败重载。
       */}
      {credentialNotice(false)}

      {/*
       * auto-fit 而非固定三列：后端清单未来会随 STORAGE_BACKEND 增加，
       * 固定 3 列在只有 2 个后端时会留出半屏空白。
       */}
      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {data.backends.map((b) => {
          const meta = META[b.backend as StorageBackendId] ?? META.local;
          const Icon = meta.icon;
          return (
            <section
              key={b.backend}
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
                <span
                  className={cn(
                    'mt-0.5 shrink-0',
                    b.active ? 'text-brand' : 'text-muted-foreground',
                  )}
                >
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
                <p className="mt-2 font-mono text-[12px] leading-4 break-all text-muted-foreground">
                  {b.probeMessage}
                </p>
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
                <dd className="min-w-0 truncate font-mono text-foreground">
                  {b.endpoint ?? '—'}
                </dd>
              </dl>

              {!b.configured && b.backend !== 'local' && (
                <div className="mt-3">
                  <div className="text-[12px] text-muted-foreground">启用所需环境变量：</div>
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
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-3">
                {b.configured && (
                  <ActionButton
                    variant="secondary"
                    disabled={probing === b.backend}
                    onClick={() => void probe(b.backend as StorageBackendId)}
                  >
                    {probing === b.backend ? '测试中…' : '连通性测试'}
                  </ActionButton>
                )}
                {can('setting.write') && b.configured && !b.active && (
                  <ActionButton
                    disabled={busy}
                    onClick={() => void doSwitch(b.backend as StorageBackendId)}
                  >
                    设为默认
                  </ActionButton>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
