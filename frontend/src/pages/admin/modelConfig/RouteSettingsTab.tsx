import { useMemo, useState } from 'react';
import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { AdminDataTable, type AdminColumn } from '../../../admin-ui/primitives/DataTable';
import { Notice } from '../../../admin-ui/primitives';
import { Panel } from '../../../components/admin/PageHeader';
import { SegmentedBox, SelectBox } from '../../../admin-ui/controls';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
import type { AdminModelConfig, AdminModelConfigItem, AdminModelRouteRow, Modality } from '../../../types/api';
import type { ModelConfigDraft } from './useModelConfigDraft';
import {
  EFFECTIVE_LABEL,
  EFFECTIVE_TONE,
  MODALITY_LABEL,
  MODALITY_ORDER,
  ROUTE_LABEL,
  ROUTE_OPTIONS_SHORT,
} from './meta';

/**
 * 逐能力路由页签。
 *
 * 编辑与生效结果合并在一张表；运行方式用短标签，避免 15 行重复长句。
 */
export function RouteSettingsTab({
  config,
  draftState,
  canWrite,
}: {
  config: AdminModelConfig;
  draftState: ModelConfigDraft;
  canWrite: boolean;
}) {
  const [filter, setFilter] = useState<'all' | Modality>('all');

  const routeItems = useMemo(() => {
    const map = new Map<string, AdminModelConfigItem>();
    for (const g of config.groups) {
      if (g.key !== 'route') continue;
      for (const it of g.items) map.set(it.key.replace('gateway.route.', ''), it);
    }
    return map;
  }, [config]);

  const rows = config.routes.filter((r) => filter === 'all' || r.modality === filter);
  const summary = {
    gateway: rows.filter((r) => r.effective === 'gateway').length,
    none: rows.filter((r) => r.effective === 'none').length,
  };

  const columns: Array<AdminColumn<AdminModelRouteRow>> = [
    {
      key: 'name',
      title: '能力',
      width: 240,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-text-primary">{r.name}</span>
          <code className="font-mono text-[11px] text-text-tertiary">{r.capability}</code>
        </div>
      ),
    },
    ...(filter === 'all'
      ? [
          {
            key: 'modality',
            title: '产出模态',
            width: 100,
            render: (r: AdminModelRouteRow) => MODALITY_LABEL[r.modality],
          } as AdminColumn<AdminModelRouteRow>,
        ]
      : []),
    {
      key: 'mode',
      title: '实现程度',
      width: 110,
      render: (r) =>
        r.mode === 'real' ? (
          <Chip variant="caption" color="lime">
            已接入
          </Chip>
        ) : (
          <Chip variant="caption" color="neutral">
            规划中
          </Chip>
        ),
    },
    {
      key: 'route',
      title: '运行方式',
      width: 240,
      render: (r) => {
        const item = routeItems.get(r.capability);
        if (!item) return ROUTE_LABEL[r.route] ?? r.route;
        const locked = item.source === 'env';
        const value = draftState.clears[item.key]
          ? 'auto'
          : (draftState.draft[item.key] ?? item.value ?? 'auto');
        /*
         * 新配置只允许 auto / remote。存量 local 不能静默改写，
         * 但必须显式显示为「已停用」并引导运营选择自动或仅远程。
         */
        const legacyLocal = String(value) === 'local';
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {legacyLocal ? (
              <SelectBox
                value={undefined}
                onChange={(next) => {
                  if (next) draftState.setValue(item.key, next);
                }}
                disabled={!canWrite || locked}
                placeholder="存量本地（已停用）"
                options={ROUTE_OPTIONS_SHORT.map((o) => ({ value: o.value, label: o.label }))}
                ariaLabel={`${r.name} 运行方式`}
              />
            ) : (
              <SelectBox
                value={String(value)}
                onChange={(next) => {
                  if (next) draftState.setValue(item.key, next);
                }}
                disabled={!canWrite || locked}
                options={ROUTE_OPTIONS_SHORT.map((o) => ({ value: o.value, label: o.label }))}
                ariaLabel={`${r.name} 运行方式`}
              />
            )}
            {locked && (
              <Chip variant="caption" color="rose">
                环境变量
              </Chip>
            )}
            {legacyLocal && !locked && (
              <Chip variant="caption" color="rose">
                请改为自动/仅远程
              </Chip>
            )}
            {draftState.clears[item.key] && (
              <Chip variant="caption" color="yellow">
                保存后恢复默认
              </Chip>
            )}
          </div>
        );
      },
    },
    {
      key: 'effective',
      title: '实际生效',
      width: 170,
      render: (r) => (
        <Chip variant="caption" color={TONE_CHIP_COLOR[EFFECTIVE_TONE[r.effective]]}>
          {EFFECTIVE_LABEL[r.effective]}
        </Chip>
      ),
    },
  ];

  return (
    <Panel
      title="逐能力路由"
      note="按能力 id 全局唯一；所有模态只允许模型通道，存量「仅本地」需改为自动或仅远程。"
      extra={
        <div className="flex items-center gap-3">
          <span className="text-xs text-emerald-700">● {summary.gateway} 真实模型</span>
          {summary.none > 0 && (
            <span className="text-xs text-rose-600">● {summary.none} 需配置模型</span>
          )}
          <SegmentedBox
            value={filter}
            onChange={(next) => setFilter(next as 'all' | Modality)}
            ariaLabel="按模态筛选"
            options={[
              { value: 'all', label: '全部' },
              ...MODALITY_ORDER.map((m) => ({ value: m, label: MODALITY_LABEL[m] })),
            ]}
          />
        </div>
      }
    >
      <Notice tone="info" className="mb-3" title="这里的「运行方式」决定能力提交时走哪条链路">
        保存后立即生效。存量「仅本地」是本地生成删除前留下的配置，必须显式改为
        「自动」或「仅远程」，否则该能力保持不可提交。
      </Notice>

      <AdminDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.capability}
        minWidth={840}
        density="compact"
        emptyText="没有匹配的能力"
      />
    </Panel>
  );
}
