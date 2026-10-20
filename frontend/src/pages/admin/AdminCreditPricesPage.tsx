import { useCallback, useEffect, useState } from 'react';
import { App, Button, InputNumber, Popconfirm, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminCreditPricesApi } from '../../lib/api';
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
  const [rows, setRows] = useState<AdminCreditPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /** 本地草稿: key = capabilityId, value = 输入框里的数字 */
  const [draft, setDraft] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminCreditPricesApi.list();
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      setDraft(Object.fromEntries(list.map((r) => [r.capabilityId, r.cost])));
    } catch (e) {
      setError((e as Error).message || '消耗价加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: AdminCreditPrice) => {
    const next = draft[row.capabilityId];
    if (next === undefined || next === row.cost) return;
    setSaving(row.capabilityId);
    try {
      await adminCreditPricesApi.update([{ capabilityId: row.capabilityId, cost: next }]);
      message.success(`${row.capabilityName} 已改为 ${next} 积分，立即生效`);
      await load();
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
      await load();
    } catch (e) {
      message.error((e as Error).message || '回落失败');
    } finally {
      setSaving(null);
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
          onChange={(v) =>
            setDraft((d) => ({ ...d, [row.capabilityId]: Number(v ?? 0) }))
          }
          onPressEnter={() => void save(row)}
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
        v === 'setting' ? (
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
              disabled={!dirty}
              loading={saving === row.capabilityId}
              onClick={() => void save(row)}
            >
              保存
            </Button>
            {row.overridden ? (
              <Popconfirm
                title="回落到代码默认值？"
                description={`将从 ${row.cost} 恢复为 ${row.registryDefault} 积分`}
                onConfirm={() => void reset(row)}
                okText="回落"
                cancelText="取消"
              >
                <Button size="small" disabled={saving === row.capabilityId}>
                  回落默认
                </Button>
              </Popconfirm>
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
        description="每次生成实际扣除的积分。保存后立即对 C 端展示与生成扣费生效，已创建的任务按当时价格不变。"
      />

      <Panel
        title="消耗价配置"
        note="0 表示该能力免费。价格为整数，不支持小数积分。"
      >
        {loading ? (
          <p style={{ padding: 24, textAlign: 'center' }}>加载中…</p>
        ) : error ? (
          <AdminEmpty description={error} />
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