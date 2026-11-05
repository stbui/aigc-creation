import { useState } from 'react';
import {
  ActionButton,
  AdminDataTable,
  Descriptions,
  Drawer,
  FormField,
  StatusTag,
  TextAreaField,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminLogicalModelsApi } from './api';
import { useToast } from './hooks';
import type { AdminLogicalModelView, SimulateResultView } from '../../../types/model';

type SimulatedRoute = SimulateResultView['routes'][number];

const ROUTE_COLUMNS: Array<AdminColumn<SimulatedRoute>> = [
  {
    key: 'channelModel',
    title: '线路',
    render: (route) => (
      <span className="font-mono">{route.channelModelKey || route.channelModelId}</span>
    ),
  },
  {
    key: 'priority',
    title: '优先级',
    align: 'right',
    render: (route) => <span className="tabular-nums">{route.priority}</span>,
  },
  {
    key: 'weight',
    title: '权重',
    align: 'right',
    render: (route) => <span className="tabular-nums">{route.weight}</span>,
  },
  {
    key: 'priceTierId',
    title: '价格档',
    render: (route) => route.priceTierId || '—',
  },
  {
    key: 'result',
    title: '结论',
    render: (route) =>
      route.eligible ? (
        <StatusTag status="ok" tone="success" label="可命中" />
      ) : (
        <span className="text-muted-foreground">
          {route.matchReasons.join('；') || '未命中'}
        </span>
      ),
  },
];

/**
 * 路由模拟抽屉。
 *
 * 只读：按给定参数算一遍「会落到哪条线路、为什么没落」，不扣费、不建任务。
 * 上线新模型前用它确认能力合同与线路优先级是否符合预期，比真发一单便宜得多。
 *
 * 组件由页面按模型 id 做 key 重挂载，因此内部状态可以按目标模型直接初始化。
 */
export function RouteSimulateDrawer({
  model,
  onClose,
}: {
  model: AdminLogicalModelView | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [operation, setOperation] = useState(
    model?.capabilitySpec?.operations?.[0] ?? '',
  );
  const [options, setOptions] = useState(
    JSON.stringify(model?.defaultOptions ?? {}, null, 2),
  );
  const [result, setResult] = useState<SimulateResultView | null>(null);
  const [simulating, setSimulating] = useState(false);

  const run = async () => {
    if (!model) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(options || '{}');
    } catch {
      toast.error('参数不是合法 JSON');
      return;
    }
    setSimulating(true);
    try {
      const next = await adminLogicalModelsApi.simulate(model.id, {
        // 意图的 capability 是**模态**（image / video），不是产品能力 id
        // （expand / main_image）。后端缺省时按模型自己的能力合同取，
        // 这里不传 —— 传产品 id 会让后端拒绝（命名空间不同）。
        operation: operation.trim() || undefined,
        options: parsed as Record<string, unknown>,
      });
      setResult(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '模拟失败');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <Drawer
      open={model !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={720}
      title={`路由模拟 · ${model?.name ?? ''}`}
      description="只读：按给定参数算一遍「会落到哪条线路、为什么没落」，不扣费、不建任务"
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose}>
            关闭
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={simulating} onClick={run}>
            {simulating ? '模拟中…' : '开始模拟'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="操作（operation）" hint="留空则用能力合同里的第一个操作">
          <TextField
            ariaLabel="操作"
            value={operation}
            onChange={setOperation}
            placeholder="generate"
          />
        </FormField>
        <FormField label="请求参数（options）" hint="JSON 对象；尺寸、数量等影响价格档的选择">
          <TextAreaField ariaLabel="请求参数" value={options} onChange={setOptions} rows={6} />
        </FormField>

        {result && (
          <div className="flex flex-col gap-3">
            <Descriptions
              items={[
                { label: '候选线路', value: String(result.candidates) },
                {
                  label: '选中线路',
                  value:
                    result.routes.find((route) => route.selectedTier)?.channelModelKey ||
                    result.selectedRouteId ||
                    '无',
                },
                { label: '结论', value: result.reason || '—' },
              ]}
              columns={2}
            />
            <div className="rounded-lg border border-border">
              <AdminDataTable<SimulatedRoute>
                rows={result.routes}
                columns={ROUTE_COLUMNS}
                rowKey={(route) => `${route.routeId}-${route.priceTierId}`}
                density="compact"
                emptyText="没有候选线路。"
              />
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
