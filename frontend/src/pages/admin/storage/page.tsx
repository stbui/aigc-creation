import { useState } from 'react';
import { BACKEND_ORDER, KIND_LABEL, KIND_ORDER, META } from './constants';
import { useAdmin, useToast, useAdminResource } from './hooks';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';

import { adminAssetsApi, adminStorageApi } from '../../../lib/api';

import {
  AdminPage,
  ActionButton,
  RefreshButton,
  EmptyState,
  ListError,
  Meter,
  Notice,
  PageSkeleton,
  Panel,
  Skeleton,
  SkeletonCards,
  SkeletonPanel,
  SkeletonStats,
  StaleError,
  StatCards,
  ToneBadge,
  formatBytes,
  formatNumber,
} from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
import type { StorageBackendId } from '../../../types/api';

interface DistributionRow {
  key: string;
  label: string;
  count: number;
}

/**
 * 占比条按**条数**算：素材域只下发按条数的分组，没有分后端的字节汇总。
 * 字节总量放在上方统计卡里，不在这里用条数反推一个假字节数。
 */
function Distribution({
  title,
  rows,
  total,
}: {
  title: string;
  rows: DistributionRow[];
  total: number;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-medium text-foreground">{title}</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const percent = total > 0 ? (row.count / total) * 100 : 0;
          return (
            <div key={row.key} data-testid="admin-storage-dist-row" data-key={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-[12px] leading-4">
                <span className="truncate text-foreground">{row.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatNumber(row.count)} 个 · {Math.round(percent)}%
                </span>
              </div>
              <Meter className="mt-1.5" value={percent} decorative />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 存储后端配置 (B-62/B-63)。
 *
 * 凭据只读：PRD §3.11 明确约束「凭据走部署期环境变量，界面不可编辑」。
 * 所以本页没有任何写凭据的输入框 —— 展示脱敏值 + 连通性 + 切换默认后端。
 * 这不是功能缺失，是刻意的安全边界。
 *
 * 容量统计复用素材域 `GET /admin/assets/stats`（后台唯一的容量事实源），
 * 不在存储域另写一份聚合 —— 两处 groupBy 迟早和素材管理页的数字对不上。
 */
export function AdminStoragePage() {
  const toast = useToast();
  const { can } = useAdmin();
  const canReadAssets = can('asset.read');

  const [probing, setProbing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 存储页只要求 setting.read；没有 asset.read 时不发统计请求，避免整页 403。
  const { data, loading, error, reload } = useAdminResource(async () => {
    const [status, stats] = await Promise.all([
      adminStorageApi.status(),
      canReadAssets ? adminAssetsApi.stats() : Promise.resolve(null),
    ]);
    return { status, stats };
  });

  const probe = async (backend: StorageBackendId) => {
    setProbing(backend);
    try {
      const res = await adminStorageApi.probe(backend);
      if (res.ok) {
        toast.success(`${META[backend].label} 连通正常${res.latencyMs ? ` (${res.latencyMs}ms)` : ''}`);
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
    <Notice tone="locked" title="凭据不在界面配置。" icon={<Lock className="size-4 shrink-0" aria-hidden />}>
      <p>出于安全考虑，OSS / MinIO 的密钥只从部署环境变量读取，页面仅显示是否配置与脱敏值。</p>
      {loading ? (
        <Skeleton className="mt-1 h-3 w-72" />
      ) : (
        <code className="mt-1 block font-mono text-[12px] break-all text-muted-foreground">
          {data?.status.credentialSource}
        </code>
      )}
    </Notice>
  );

  if (loading && !data) {
    return (
      <PageSkeleton
        title="存储配置"
        description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
        actions={<RefreshButton disabled />}
        notice={credentialNotice(true)}
        body={
          <>
            <SkeletonStats className="mt-4" count={4} />
            <SkeletonPanel rows={3} />
            <SkeletonCards count={3} />
          </>
        }
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="暂无存储后端信息" />;

  const { status, stats } = data;
  const hiddenCount = stats?.byStatus.hidden ?? 0;

  const backendRows: DistributionRow[] = BACKEND_ORDER.map((backend) => ({
    key: backend,
    label: META[backend].label,
    count: stats?.byBackend[backend] ?? 0,
  }));
  const kindRows: DistributionRow[] = [
    ...KIND_ORDER.map((kind) => ({
      key: kind,
      label: KIND_LABEL[kind],
      count: stats?.byKind[kind] ?? 0,
    })),
    ...Object.keys(stats?.byKind ?? {})
      .filter((kind) => !KIND_ORDER.includes(kind))
      .map((kind) => ({ key: kind, label: kind, count: stats?.byKind[kind] ?? 0 })),
  ];

  return (
    <AdminPage
      title="存储配置"
      description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
      actions={<RefreshButton loading={loading} onRefresh={reload} />}
    >

      {/*
       * 有数据时的刷新**不塌页面**：卡片留在原位，只是「刷新」按钮禁用。
       * 探测/切换后端之后要重拉状态 —— 无条件替换会让用户刚点的后端卡片闪一下
       * 消失，看起来像操作失败重载。
       */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {credentialNotice(false)}

      {stats ? (
        <>
          <StatCards
            className="mt-4 mb-4"
            columns={4}
            items={[
              {
                key: 'bytes',
                label: '已占用容量',
                value: formatBytes(stats.totalBytes),
                hint: `${formatNumber(stats.total)} 个素材文件`,
              },
              {
                key: 'assets',
                label: '素材总数',
                value: formatNumber(stats.total),
                hint:
                  stats.total > 0
                    ? `平均 ${formatBytes(stats.totalBytes / stats.total)} / 个`
                    : '暂无素材',
              },
              {
                key: 'active',
                label: '当前默认后端',
                value: META[status.active]?.label ?? status.active,
                hint: '只影响新上传',
              },
              {
                key: 'hidden',
                label: '已下架仍占用',
                value: formatNumber(hiddenCount),
                hint: '下架不删除文件',
                tone: hiddenCount > 0 ? 'warn' : undefined,
              },
            ]}
          />

          <Panel
            title="容量分布"
            note="按素材记录统计，与「素材管理」页同源；不含未入库的孤儿文件"
          >
            <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              <Distribution title="按存储后端" rows={backendRows} total={stats.total} />
              <Distribution title="按素材来源" rows={kindRows} total={stats.total} />
            </div>
            <p className="mt-3 border-t border-border pt-3 text-[12px] leading-5 text-muted-foreground">
              每条素材记录写入时的 <code className="font-mono">storageBackend</code>
              ，切换默认后端不会改变已有素材的读取位置。
            </p>
          </Panel>
        </>
      ) : (
        <div className="mt-4">
          <Notice tone="info" title="容量统计需要素材读取权限。">
            <p>当前账号没有 asset.read，已隐藏容量概览；后端状态与连通性测试不受影响。</p>
          </Notice>
        </div>
      )}

      {/*
       * auto-fit 而非固定三列：后端清单未来会随 STORAGE_BACKEND 增加，
       * 固定 3 列在只有 2 个后端时会留出半屏空白。
       */}
      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {status.backends.map((b) => {
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

              {/*
               * 未启用不是终点：把「装 SDK → 配变量 → 重启」三步摆出来，
               * 运营不必去翻代码或后端日志才知道下一步做什么。
               * 凭据仍只从环境变量读，这里只给变量名与命令，不提供输入框。
               */}
              {!b.configured && b.backend !== 'local' && (
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
              )}

              <div className="mt-auto flex items-center gap-2 pt-3">
                {can('channel.test') && b.configured && (
                  <ActionButton
                    variant="secondary"
                    disabled={probing === b.backend}
                    onClick={() => void probe(b.backend as StorageBackendId)}
                  >
                    {probing === b.backend ? '测试中…' : '连通性测试'}
                  </ActionButton>
                )}
                {can('setting.write') && b.configured && !b.active && (
                  <ActionButton disabled={busy} onClick={() => void doSwitch(b.backend as StorageBackendId)}>
                    设为默认
                  </ActionButton>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </AdminPage>
  );
}
