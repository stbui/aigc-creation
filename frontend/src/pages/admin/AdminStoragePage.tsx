import { useState } from 'react';
import { CheckCircle2, Cloud, HardDrive, Lock, RefreshCw, Server, XCircle } from 'lucide-react';
import { Button, Chip } from '../../admin-ui/shadcn/kit';
import { adminStorageApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { Notice } from '../../admin-ui/primitives';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader } from '../../components/admin/PageHeader';
import { cx } from '../../admin-ui/lib/cn';
import type { StorageBackendId } from '../../types/api';

const META: Record<StorageBackendId, { label: string; desc: string; icon: typeof HardDrive; envKeys: string[] }> = {
  local: {
    label: '本地磁盘',
    desc: '文件存于 backend/uploads/，由静态服务提供访问',
    icon: HardDrive,
    envKeys: ['STORAGE_BACKEND=local'],
  },
  oss: {
    label: '阿里云 OSS',
    desc: '对象存储，私有读 + 签名 URL 访问',
    icon: Cloud,
    envKeys: ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_ENDPOINT(可选)'],
  },
  minio: {
    label: 'MinIO',
    desc: 'S3 兼容对象存储，自建或用云厂商的兼容服务',
    icon: Server,
    envKeys: ['MINIO_ENDPOINT', 'MINIO_PORT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_BUCKET'],
  },
};

/**
 * 存储后端配置 (B-62/B-63)。
 *
 * ⚠ **凭据只读**: PRD §3.11 明确约束「凭据走部署期环境变量，界面不可编辑」。
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
   * 2026-10-23: 守卫从「无条件替换整页」收窄成「还没有数据时才替换」。
   * 探测/切换后端之后要重拉状态 —— 用旧写法整页先塌成骨架屏再弹回来,
   * 用户刚点的那个后端卡片会闪一下消失, 很像操作失败重载。
   */
  if (loading && !data) return <AdminListLoading tip="加载存储配置…" />;
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;
  if (!data) return <AdminEmpty description="暂无存储后端信息" />;

  return (
    <>
      <PageHeader
        title="存储配置"
        description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
        actions={
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RefreshCw}
            disabled={loading}
            onClick={() => void reload()}
          >
            刷新
          </Button>
        }
      />

      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <Notice
        tone="locked"
        title="凭据不在界面配置。"
        icon={<Lock className="size-4 shrink-0" aria-hidden />}
      >
        <p>出于安全考虑，OSS / MinIO 的密钥只从部署环境变量读取，页面仅显示是否配置与脱敏值。</p>
        <code className="mt-1 block break-all font-mono text-[11px] text-text-secondary">
          {data.credentialSource}
        </code>
      </Notice>

      {/*
       * auto-fit 而非固定三列: 后端清单未来会随 STORAGE_BACKEND 增加，
       * 固定 3 列在只有 2 个后端时会留出半屏空白。
       */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {data.backends.map((b) => {
          const meta = META[b.backend as StorageBackendId] ?? META.local;
          const Icon = meta.icon;
          return (
            <section
              key={b.backend}
              data-testid="admin-storage-card"
              data-backend={b.backend}
              data-active={b.active ? 'true' : 'false'}
              className={cx(
                'flex flex-col rounded-xl border bg-white p-4',
                b.active ? 'border-accent-400' : 'border-border-table',
                !b.configured && 'bg-background-secondary-default/40',
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cx(
                    'mt-0.5 shrink-0',
                    b.active ? 'text-accent-600' : 'text-text-tertiary',
                  )}
                >
                  <Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-text-primary">{meta.label}</span>
                    {b.active && (
                      <span
                        data-testid="admin-storage-badge"
                        className="rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-700"
                      >
                        当前
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-text-tertiary">{meta.desc}</p>
                </div>
              </div>

              <div className="mt-3">
                {b.available ? (
                  <Chip variant="bold" color="lime">
                    <CheckCircle2 size={12} aria-hidden className="mr-1" />
                    连通正常
                    {b.probeLatencyMs ? ` ${b.probeLatencyMs}ms` : ''}
                  </Chip>
                ) : b.configured ? (
                  <Chip variant="bold" color="rose">
                    <XCircle size={12} aria-hidden className="mr-1" />
                    不可用
                  </Chip>
                ) : (
                  <Chip variant="bold" color="neutral">
                    未启用
                  </Chip>
                )}
              </div>

              {b.probeMessage && (
                <p className="mt-2 break-all font-mono text-[11px] leading-4 text-text-tertiary">
                  {b.probeMessage}
                </p>
              )}

              <dl className="mt-3 grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 text-[11px] leading-4">
                <dt className="text-text-tertiary">凭据</dt>
                <dd className="min-w-0 truncate font-mono text-text-secondary">
                  {b.masked ? (
                    b.masked
                  ) : (
                    <span className="font-sans text-text-placeholder">
                      {b.backend === 'local' ? '无需凭据' : '未配置'}
                    </span>
                  )}
                </dd>
                <dt className="text-text-tertiary">地址</dt>
                <dd className="min-w-0 truncate font-mono text-text-secondary">{b.endpoint ?? '—'}</dd>
              </dl>

              {!b.configured && b.backend !== 'local' && (
                <div className="mt-3">
                  <div className="text-[11px] text-text-tertiary">启用所需环境变量：</div>
                  <div data-testid="admin-storage-env" className="mt-1 flex flex-wrap gap-1">
                    {meta.envKeys.map((k) => (
                      <code
                        key={k}
                        className="rounded border border-border-table bg-white px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
                      >
                        {k}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-3">
                {b.configured && (
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={probing === b.backend}
                    onClick={() => void probe(b.backend as StorageBackendId)}
                  >
                    {probing === b.backend ? '测试中…' : '连通性测试'}
                  </Button>
                )}
                {can('setting.write') && b.configured && !b.active && (
                  <Button
                    variant="primary"
                    size="small"
                    disabled={busy}
                    onClick={() => void doSwitch(b.backend as StorageBackendId)}
                  >
                    设为默认
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
