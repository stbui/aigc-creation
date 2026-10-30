import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { AdminDataTable, type AdminColumn } from '../../../admin-ui/primitives/DataTable';
import { HoverTip } from '../../../admin-ui/controls';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
import type { AdminModelChannelRecord, VendorPreset } from '../../../types/api';
import {
  fmtLatency,
  fmtTime,
  healthMeta,
  hostOf,
  matchVendor,
  readCachedTest,
  vendorDisplayLabel,
} from './meta';

/**
 * 单模态线路表。
 *
 * 服务商并入「线路」副行，去掉「最近更新」列，把宽度留给模型与操作。
 */
export function ChannelTable({
  channels,
  vendors,
  canWrite,
  canTest,
  busyId,
  testNonce,
  onEdit,
  onTest,
  onMove,
  onDelete,
  onMaterialize,
}: {
  channels: AdminModelChannelRecord[];
  vendors: VendorPreset[];
  canWrite: boolean;
  canTest: boolean;
  busyId: string | null;
  testNonce: number;
  onEdit: (ch: AdminModelChannelRecord) => void;
  onTest: (ch: AdminModelChannelRecord) => void;
  onMove: (ch: AdminModelChannelRecord, dir: 'up' | 'down') => void;
  onDelete: (ch: AdminModelChannelRecord) => void;
  onMaterialize: (ch: AdminModelChannelRecord) => void;
}) {
  const columns: Array<AdminColumn<AdminModelChannelRecord>> = [
    {
      key: 'name',
      title: '线路',
      width: 260,
      render: (ch) => {
        const health = healthMeta(ch);
        const vendor = matchVendor(ch, vendors);
        const vendorLabel = vendor ? vendorDisplayLabel(vendor.label) : '自定义';
        return (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                className="!px-0 font-semibold text-text-primary"
                onClick={() => onEdit(ch)}
                disabled={ch.synthetic}
                title={ch.synthetic ? '旧版配置需先转为可管理线路' : '编辑线路'}
              >
                {ch.name}
              </Button>
              {ch.synthetic && (
                <Chip variant="caption" color="yellow">
                  旧版配置
                </Chip>
              )}
              {!ch.enabled && (
                <Chip variant="caption" color="neutral">
                  已停用
                </Chip>
              )}
              {!ch.protocolKnown && (
                <HoverTip tip="该协议在本项目尚未实现，启用后调用会失败">
                  <Chip variant="caption" color="rose">
                    协议未接入
                  </Chip>
                </HoverTip>
              )}
              {health.tone === 'danger' && (
                <HoverTip tip={health.hint}>
                  <Chip variant="caption" color="rose">
                    冷却中
                  </Chip>
                </HoverTip>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <span>{vendorLabel}</span>
              <span aria-hidden>·</span>
              <code className="font-mono text-[11px]">{ch.protocol}</code>
            </div>
          </div>
        );
      },
    },
    {
      key: 'model',
      title: '默认模型',
      width: 240,
      /*
       * 除了「这条线路用哪个模型」，还要回答「这家厂商还有哪些模型可选」——
       * 运营配下一跳或换模型时不必再点开编辑抽屉逐个找。
       */
      render: (ch) => {
        const vendor = matchVendor(ch, vendors);
        const models = vendor?.models ?? [];
        const others = models.filter((m) => m.id !== ch.model);
        if (!ch.model) {
          return <span className="text-xs text-text-tertiary">按协议默认</span>;
        }
        return (
          <div className="flex flex-col gap-1">
            <HoverTip tip={ch.model}>
              <code className="font-mono text-xs">{ch.model}</code>
            </HoverTip>
            {vendor && models.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none text-[11px] text-accent-700 hover:underline">
                  {others.length > 0 ? `另有 ${others.length} 个可选模型` : '查看该厂商模型'}
                </summary>
                <div className="mt-1.5 max-w-[380px] rounded-lg border border-border-table bg-white p-2 shadow-lg">
                  <p className="mb-1 text-[11px] font-medium text-text-secondary">
                    {vendorDisplayLabel(vendor.label)} · 可选模型（{models.length}）
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {models.map((m) => (
                      <li key={m.id} className="flex flex-col gap-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-text-primary">{m.label}</span>
                          {m.id === ch.model && (
                            <Chip variant="caption" color="purple">
                              当前
                            </Chip>
                          )}
                        </div>
                        <span className="text-[11px] text-text-tertiary">
                          {m.id}
                          {m.note ? ` · ${m.note}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
        );
      },
    },
    {
      key: 'baseUrl',
      title: '接入地址',
      width: 170,
      cellTitle: (ch) => ch.baseUrl,
      render: (ch) =>
        ch.baseUrl ? (
          <HoverTip tip={ch.baseUrl}>
            <code className="font-mono text-xs">{hostOf(ch.baseUrl)}</code>
          </HoverTip>
        ) : (
          <span className="text-xs text-text-tertiary">未填写</span>
        ),
    },
    {
      key: 'health',
      title: '健康',
      width: 180,
      render: (ch) => {
        const health = healthMeta(ch);
        const cached = testNonce >= 0 && !ch.synthetic ? readCachedTest(ch.id, ch.updatedAt) : null;
        return (
          <div className="flex flex-col gap-1">
            <HoverTip tip={health.hint}>
              <Chip variant="caption" color={TONE_CHIP_COLOR[health.tone]}>
                {health.label}
              </Chip>
            </HoverTip>
            {cached && (
              <span
                className={
                  cached.result.ok ? 'text-[11px] text-emerald-700' : 'text-[11px] text-rose-600'
                }
                title="测试只验证地址与模型可达，不代表真实生成健康"
              >
                {cached.result.ok ? '测试通过' : '测试失败'} · {fmtLatency(cached.result.latencyMs)} ·{' '}
                {fmtTime(cached.testedAt)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'priority',
      title: '顺序',
      width: 112,
      render: (ch, index) => {
        if (ch.synthetic) return <span className="text-xs text-text-tertiary">—</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-tertiary">第 {index + 1} 位</span>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              leadingIcon={ArrowUp}
              aria-label="上移"
              disabled={!canWrite || index === 0 || busyId === ch.id}
              onClick={() => onMove(ch, 'up')}
            />
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              leadingIcon={ArrowDown}
              aria-label="下移"
              disabled={!canWrite || index === channels.length - 1 || busyId === ch.id}
              onClick={() => onMove(ch, 'down')}
            />
          </div>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (ch) =>
        ch.synthetic ? (
          <Button variant="ghost" size="xs" disabled={!canWrite} onClick={() => onMaterialize(ch)}>
            转为可管理
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" disabled={!canWrite} onClick={() => onEdit(ch)}>
              编辑
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={!canTest || busyId === ch.id}
              onClick={() => onTest(ch)}
            >
              {busyId === ch.id ? '测试中' : '测试'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-rose-600"
              disabled={!canWrite}
              onClick={() => onDelete(ch)}
            >
              删除
            </Button>
          </div>
        ),
    },
  ];

  return (
    <AdminDataTable
      rows={channels}
      columns={columns}
      rowKey={(row) => row.id}
      minWidth={1080}
      density="compact"
      emptyText="该模态还没有线路"
    />
  );
}
