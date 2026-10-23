import { useState } from 'react';
import { App, Button } from 'antd';
import { CheckCircle2, Cloud, HardDrive, Lock, Server, XCircle } from 'lucide-react';
import { adminStorageApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader } from '../../components/admin/PageHeader';
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
  const { message } = App.useApp();
  const { can } = useAdmin();

  const [probing, setProbing] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<StorageBackendId | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAdminResource(() => adminStorageApi.status());

  const probe = async (backend: StorageBackendId) => {
    setProbing(backend);
    try {
      const res = await adminStorageApi.probe(backend);
      if (res.ok) {
        void message.success(`${META[backend].label} 连通正常${res.latencyMs ? ` (${res.latencyMs}ms)` : ''}`);
      } else {
        void message.error(res.message);
      }
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setProbing(null);
    }
  };

  const doSwitch = async () => {
    if (!switchTarget) return;
    setBusy(true);
    try {
      const res = await adminStorageApi.setActive(switchTarget);
      setSwitchTarget(null);
      void message.success(`默认后端已切到 ${META[switchTarget].label} — ${res.note}`);
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
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
          <Button type="default" className="adm-btn" loading={loading} onClick={() => void reload()}>
            刷新
          </Button>
        }
      />

      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <div className="adm-alert is-info">
        <Lock size={16} />
        <div>
          <strong>凭据不在界面配置。</strong>
          <div>出于安全考虑，OSS / MinIO 的密钥只从部署环境变量读取，页面仅显示是否配置与脱敏值。</div>
          <div className="adm-mono" style={{ marginTop: 4 }}>{data.credentialSource}</div>
        </div>
      </div>

      <div className="adm-storage-grid">
        {data.backends.map((b) => {
          const meta = META[b.backend as StorageBackendId] ?? META.local;
          const Icon = meta.icon;
          return (
            <div
              key={b.backend}
              className={`adm-storage-card${b.active ? ' is-active' : ''}${b.configured ? '' : ' is-disabled'}`}
            >
              <div className="adm-storage-head">
                <Icon size={18} className="adm-storage-icon" />
                <div className="adm-storage-title">
                  <div className="adm-storage-name">
                    {meta.label}
                    {b.active && <span className="adm-storage-badge">当前</span>}
                  </div>
                  <div className="adm-storage-desc">{meta.desc}</div>
                </div>
              </div>

              <div className="adm-storage-status">
                {b.available ? (
                  <span className="adm-tag is-success">
                    <CheckCircle2 size={12} />
                    连通正常
                    {b.probeLatencyMs ? ` ${b.probeLatencyMs}ms` : ''}
                  </span>
                ) : b.configured ? (
                  <span className="adm-tag is-danger">
                    <XCircle size={12} />
                    不可用
                  </span>
                ) : (
                  <span className="adm-tag is-muted">未启用</span>
                )}
              </div>

              {b.probeMessage && <div className="adm-storage-probe">{b.probeMessage}</div>}

              <dl className="adm-storage-meta">
                <dt>凭据</dt>
                <dd>
                  {b.masked ? (
                    <code className="adm-mono">{b.masked}</code>
                  ) : (
                    <span className="adm-cell-sub">
                      {b.backend === 'local' ? '无需凭据' : '未配置'}
                    </span>
                  )}
                </dd>
                <dt>地址</dt>
                <dd>
                  <code className="adm-mono">{b.endpoint ?? '—'}</code>
                </dd>
              </dl>

              {!b.configured && b.backend !== 'local' && (
                <div className="adm-storage-env">
                  <div className="adm-storage-env-title">启用所需环境变量：</div>
                  {meta.envKeys.map((k) => (
                    <code key={k} className="adm-mono">
                      {k}
                    </code>
                  ))}
                </div>
              )}

              <div className="adm-storage-actions">
                {b.configured && (
                  <Button
                    type="default"
                    className="adm-btn"
                    onClick={() => void probe(b.backend as StorageBackendId)}
                    disabled={probing === b.backend}
                  >
                    {probing === b.backend ? '测试中…' : '连通性测试'}
                  </Button>
                )}
                {can('setting.write') && b.configured && !b.active && (
                  <Button
                    type="primary"
                    className="adm-btn is-primary"
                    onClick={() => setSwitchTarget(b.backend as StorageBackendId)}
                  >
                    设为默认
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {switchTarget && (
        <ConfirmAction
          open
          title={`将默认存储后端切到 ${META[switchTarget].label}`}
          confirmText="确认切换"
          loading={busy}
          onCancel={() => setSwitchTarget(null)}
          onConfirm={() => void doSwitch()}
          description={
            <p>此后新上传的素材与新生成的产出将写入该后端。</p>
          }
          impact={[
            '已写入的素材不受影响 —— 它们按 storageBackend 字段各自读取',
            '切换只改运行时默认值，重启后需通过环境变量 STORAGE_BACKEND 固化',
            '切换前建议先做连通性测试',
          ]}
        />
      )}
    </>
  );
}
