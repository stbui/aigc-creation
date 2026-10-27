import { useEffect, useState } from 'react';
import { App, Button, InputNumber, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminCreditPricesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminResource,
  ConfirmAction,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type { AdminCreditPrice } from '../../types/api';

/**
 * 能力消耗价 (commerce-design.md §4.4)。
 *
 * 为什么改价要有 UI: 定价是运营日常动作, 走后台改数据库意味着「改价要会写 SQL」。
 * 这里是 SystemSetting 覆盖层的唯一图形入口 —— 保存后 C 端 `/capabilities`
 * 与生成扣费**立即**生效 (后端改价时会失效价格缓存, 不必等 TTL)。
 *
 * 关键设计: 每行同时显示「生效价」与「代码默认值」+ 来源标记。
 * 不标来源的话, 运营改完价看到数字没变会以为是 bug,
 * 实际是自己在改一个不生效的层 (或反之)。
 */
export function AdminCreditPricesPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('product.price');
  const [saving, setSaving] = useState<string | null>(null);
  /** 本地草稿: key = capabilityId, value = 输入框里的数字 */
  const [draft, setDraft] = useState<Record<string, number>>({});
  /** 回退确认：选中的行 */
  const [rowForReset, setRowForReset] = useState<AdminCreditPrice | null>(null);

  // 接口历史上有过直接回数组与回 { items } 两种形状, 统一兜成数组
  const { data, loading, error, reload } = useAdminResource(async () => {
    const list = await adminCreditPricesApi.list();
    return Array.isArray(list) ? list : [];
  });
  const rows = data ?? [];

  const dirtyCount = rows.filter((r) => draft[r.capabilityId] !== undefined && draft[r.capabilityId] !== r.cost).length;
  useUnsavedGuard(dirtyCount > 0);

  /*
   * 草稿跟着生效价走: 拉到新价就把输入框重置成服务端的值。
   * 放在 effect 里而不是 fetcher 内 —— 保存后 `reload()` 也会走到这里,
   * 保证「刚保存的数字」与「输入框里的数字」一致, 不留一个假的"未保存"标记。
   *
   * 依赖写 `data` 而不是 `rows`: `rows = data ?? []` 每次渲染都是新数组,
   * 拿它当依赖会让 effect 每渲染都跑一次 setDraft, 自己把自己重新渲染起来。
   */
  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.map((r) => [r.capabilityId, r.cost])));
  }, [data]);

  const save = async (row: AdminCreditPrice) => {
    const next = draft[row.capabilityId];
    if (next === undefined || next === row.cost) return;
    setSaving(row.capabilityId);
    try {
      await adminCreditPricesApi.update([{ capabilityId: row.capabilityId, cost: next }]);
      message.success(`${row.capabilityName} 已改为 ${next} 积分，立即生效`);
      await reload();
    } catch (e) {
      message.error((e as Error).message || '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const reset = async (row: AdminCreditPrice) => {
    setSaving(row.capabilityId);
    try {
      const res = await adminCreditPricesApi.reset(row.capabilityId);
      message.success(`已回落到默认值 ${res.cost} 积分`);
      await reload();
    } catch (e) {
      message.error((e as Error).message || '回落失败');
    } finally {
      setSaving(null);
      setRowForReset(null);
    }
  };

  const columns: ColumnsType<AdminCreditPrice> = [
    { title: '能力', dataIndex: 'capabilityName', key: 'name', width: 160 },
    {
      title: '能力 ID',
      dataIndex: 'capabilityId',
      key: 'id',
      width: 160,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: '生效消耗价（积分）',
      key: 'cost',
      width: 200,
      render: (_, row) => (
        <InputNumber
          min={0}
          max={10000}
          size="small"
          value={draft[row.capabilityId]}
          disabled={!writable}
          onChange={(v) =>
            setDraft((d) => ({ ...d, [row.capabilityId]: Number(v ?? 0) }))
          }
          onPressEnter={() => {
            if (writable) void save(row);
          }}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: '代码默认值',
      dataIndex: 'registryDefault',
      key: 'registryDefault',
      width: 110,
      render: (v: number) => <span style={{ color: 'var(--text-muted)' }}>{v}</span>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 130,
      render: (v: string, row) =>
        v === 'campaign' ? (
          /*
           * 活动覆盖必须单独标出来：此时生效价恒为 0，运营在输入框里改价
           * **不会生效**（活动到点后自动恢复）。不标来源的话，这段表现为
           * 「改了没反应」，会被当成改价 bug。
           */
          <Tooltip title="进行中的限时免费活动覆盖了这项能力，活动结束后自动恢复原价">
            <span className="adm-tag is-danger">
              <span className="adm-tag-dot" aria-hidden="true" />
              限时免费
            </span>
          </Tooltip>
        ) : v === 'setting' ? (
          <Tooltip title="后台覆盖中。回落默认后恢复为 registry 的值">
            <span className="adm-tag is-warning">
              <span className="adm-tag-dot" aria-hidden="true" />
              后台设置
            </span>
          </Tooltip>
        ) : (
          <Tooltip title="未覆盖，使用代码里的 registry.creditCost">
            <span className="adm-tag is-muted">
              <span className="adm-tag-dot" aria-hidden="true" />
              代码默认
            </span>
          </Tooltip>
        ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 170,
      render: (_, row) => {
        const dirty = draft[row.capabilityId] !== undefined && draft[row.capabilityId] !== row.cost;
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="small"
              type="primary"
              disabled={!writable || !dirty}
              loading={saving === row.capabilityId}
              onClick={() => void save(row)}
            >
              保存
            </Button>
            {row.overridden ? (
              <>
                <Button
                  size="small"
                  danger
                  disabled={!writable || saving === row.capabilityId}
                  onClick={() => setRowForReset(row)}
                >
                  回落默认
                </Button>
                <ConfirmAction
                  open={rowForReset?.capabilityId === row.capabilityId}
                  title="回落到代码默认值？"
                  description={`将从 ${row.cost} 恢复为 ${row.registryDefault} 积分`}
                  impact={[`恢复 ${row.capabilityName} 价格为 ${row.registryDefault} 积分`]}
                  danger
                  loading={saving === row.capabilityId}
                  onCancel={() => setRowForReset(null)}
                  onConfirm={() => rowForReset && void reset(rowForReset)}
                />
              </>
            ) : (
              <Button size="small" disabled title="该项未覆盖，无需回落">
                回落默认
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="能力消耗价"
        description={
          writable
            ? '每次生成实际扣除的积分。保存后立即对 C 端展示与生成扣费生效，已创建的任务按当时价格不变。'
            : '当前账号只有 product.price 的读权限（或无此权限），可查看价格但不能修改。'
        }
      />

      <Panel
        title="消耗价配置"
        note="0 表示该能力免费。价格为整数，不支持小数积分。"
      >
        {error && rows.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
        )}
        {/* 三态分家: 失败态不能渲染成 AdminEmpty, 否则「没连上」会被读成「没有可配置的能力」 */}
        {loading && rows.length === 0 ? (
          <AdminListLoading tip="加载消耗价…" />
        ) : error && rows.length === 0 ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : rows.length === 0 ? (
          <AdminEmpty description="没有可配置的能力" />
        ) : (
          <Table
            rowKey="capabilityId"
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
          />
        )}
      </Panel>
    </>
  );
}
