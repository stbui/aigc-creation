import { useState } from 'react';
import { App, Button, Input, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminCapabilitiesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import { RUNTIME_LABELS } from '../../lib/constants';
import type { AdminCapabilityControl } from '../../types/api';

/**
 * 能力管控（2026-10-21）。
 *
 * 存在的理由：某项能力依赖的厂商通道挂了、或产出质量被投诉时，运营需要
 * **立刻停止收单**，而不是等下一次发版。没有这个开关，唯一手段是下掉整条
 * 模型线路 —— 那会连带影响所有能力，把局部故障放大成全站故障。
 *
 * 三列信息刻意分开，因为它们回答的是三个不同问题：
 *   实现程度 (mode)     —— 代码里做到什么程度
 *   当前结论 (effective)    —— 此刻按下去会发生什么（下架 / 云端 / 暂不可用）
 * 只显示 mode 会让「real 但没配通道」看起来像云端可用，正是要消除的误读。
 *
 * 下架**必须填原因**：原因会原样展示给 C 端用户并写进审计。只说「已下线」
 * 只能让用户去问客服，写清「云端通道维护中，预计 2 小时恢复」才是可自助的。
 */
export function AdminCapabilitiesPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  /** 只有 capability.write 能上下线；capability.read 只读 */
  const writable = can('capability.write');
  const [saving, setSaving] = useState<string | null>(null);
  /** 下架弹窗的上下文；null = 弹窗关闭 */
  const [offline, setOffline] = useState<AdminCapabilityControl | null>(null);
  const [reason, setReason] = useState('');

  // 接口历史上有过直接回数组与回 { items } 两种形状, 统一兜成数组
  const { data, loading, error, reload } = useAdminResource(async () => {
    const list = await adminCapabilitiesApi.list();
    return Array.isArray(list) ? list : [];
  });
  const rows = data ?? [];

  const submitOffline = async () => {
    if (!offline) return;
    const text = reason.trim();
    if (!text) {
      message.warning('下架必须填写原因，用户会看到它');
      return;
    }
    setSaving(offline.capabilityId);
    try {
      await adminCapabilitiesApi.set(offline.capabilityId, false, text);
      message.success(`${offline.name} 已下线，C 端立即生效`);
      setOffline(null);
      setReason('');
      await reload();
    } catch (e) {
      message.error((e as Error).message || '下线失败');
    } finally {
      setSaving(null);
    }
  };

  /** 上线按产品要求直接执行，不再弹窗二次确认 */
  const bringOnline = async (row: AdminCapabilityControl) => {
    setSaving(row.capabilityId);
    try {
      await adminCapabilitiesApi.set(row.capabilityId, true);
      message.success(`${row.name} 已上线`);
      await reload();
    } catch (e) {
      message.error((e as Error).message || '上线失败');
    } finally {
      setSaving(null);
    }
  };

  const columns: ColumnsType<AdminCapabilityControl> = [
    {
      title: '能力',
      key: 'name',
      width: 200,
      render: (_, row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{row.name}</span>
          <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.capabilityId}</code>
        </div>
      ),
    },
    { title: '分组', dataIndex: 'group', key: 'group', width: 120 },
    {
      title: '模态',
      dataIndex: 'modality',
      key: 'modality',
      width: 90,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: '实现程度',
      dataIndex: 'mode',
      key: 'mode',
      width: 110,
      render: (v: string) => (
        <Tooltip title={v === 'real' ? '已接入真实模型通道' : '参考站有、本项目未实现'}>
          <span className={`adm-tag ${v === 'real' ? 'is-success' : 'is-warning'}`}>
            <span className="adm-tag-dot" aria-hidden="true" />
            {v === 'real' ? '已接入' : '规划中'}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '当前结论',
      key: 'runtime',
      width: 170,
      render: (_, row) => {
        const eff = row.runtime?.effective ?? 'unavailable';
        const tone = eff === 'remote' ? 'is-success' : 'is-danger';
        return (
          <Tooltip title={row.runtime?.reason || ''}>
            <span className={`adm-tag ${tone}`}>
              <span className="adm-tag-dot" aria-hidden="true" />
              {RUNTIME_LABELS[eff] ?? eff}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      key: 'enabled',
      width: 120,
      render: (_, row) =>
        row.enabled ? (
          <span className="adm-tag is-success">
            <span className="adm-tag-dot" aria-hidden="true" />
            上线中
          </span>
        ) : (
          <Tooltip title={row.reason || ''}>
            <span className="adm-tag is-danger">
              <span className="adm-tag-dot" aria-hidden="true" />
              已下线
            </span>
          </Tooltip>
        ),
    },
    {
      title: '最后修改',
      key: 'updated',
      width: 180,
      render: (_, row) =>
        row.updatedAt ? (
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
            <span>{new Date(row.updatedAt).toLocaleString('zh-CN')}</span>
            <span style={{ color: 'var(--text-muted)' }}>{row.updatedBy ?? '-'}</span>
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>从未调整</span>
        ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 120,
      render: (_, row) => (
        <Tooltip title={writable ? undefined : '当前账号无 capability.write 权限'}>
          <Button
            size="small"
            danger={row.enabled}
            loading={saving === row.capabilityId}
            disabled={!writable}
            onClick={() => {
              if (row.enabled) {
                setReason('');
                setOffline(row);
              } else {
                void bringOnline(row);
              }
            }}
          >
            {row.enabled ? '下线' : '上线'}
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="能力管控"
        description={
          writable
            ? '按能力单独上下线。下架后 C 端立刻停止收单并展示下线原因，生成接口返回 40005；不影响其它能力与模型线路。'
            : '当前账号只有 capability.read 权限，可查看能力状态但不能上下线。'
        }
      />

      <Panel title="能力清单" note="「当前结论」是运行时结论：它由后台开关、逐能力路由与该模态的云端通道共同决定。">
        {/*
          三态必须分家 (2026-10-23): 之前加载中是裸 <p>加载中…</p>、失败态用的却是
          AdminEmpty —— 同一块区域把「没连上」说成「没有数据」, 运营会以为能力清单被清空了。
        */}
        {error && rows.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
        )}
        {loading && rows.length === 0 ? (
          <AdminListLoading tip="加载能力清单…" />
        ) : error && rows.length === 0 ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : rows.length === 0 ? (
          <AdminEmpty description="没有可管控的能力" />
        ) : (
          <Table
            rowKey="capabilityId"
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
            scroll={{ x: 960 }}
          />
        )}
      </Panel>

      <ConfirmAction
        open={!!offline}
        title={offline ? `下线「${offline.name}」` : ''}
        confirmText="确认下线"
        danger
        loading={saving === offline?.capabilityId}
        onCancel={() => setOffline(null)}
        onConfirm={() => void submitOffline()}
        description={
          <p style={{ marginBottom: 8, color: 'var(--text-body)' }}>
            下架后用户在 C 端会看到下方填写的「下线原因」，同时该能力不可提交。此操作会写入审计日志。
          </p>
        }
        impact={['C 端停止提交该能力', '下线原因展示给用户', '写操作审计（含操作人）']}
        extra={
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={200}
            showCount
            placeholder="例如：云端通道维护中，预计 2 小时恢复"
          />
        }
      />
    </>
  );
}
