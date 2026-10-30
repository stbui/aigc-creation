import { useMemo, useState } from 'react';
import { Cable, Plus, Search } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { adminModelChannelsApi } from '../../../lib/api';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { EmptyState, Notice } from '../../../admin-ui/primitives';
import { Panel } from '../../../components/admin/PageHeader';
import { SegmentedBox, TextInput } from '../../../admin-ui/controls';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
import type {
  AdminChannelTestAllResult,
  AdminModelChannelRecord,
  AdminModelChannelsSnapshot,
  AdminModelConfig,
  Modality,
} from '../../../types/api';
import { InlineConfirm } from './InlineConfirm';
import { ChannelEditDrawer } from './ChannelEditDrawer';
import { ChannelHealthCard } from './ChannelHealthCard';
import { ChannelTable } from './ChannelTable';
import {
  DISPATCH_SOURCE_META,
  MODALITY_EMPTY_HINT,
  MODALITY_LABEL,
  MODALITY_ORDER,
  fmtTime,
  writeCachedTest,
} from './meta';

type Filter = 'all' | Modality;

/**
 * 线路管理页签。
 *
 * 首屏三张健康卡既是总览也是筛选器；下面是按模态分组的线路表。
 */
export function ChannelManagementTab({
  config,
  snapshot,
  canWrite,
  canTest,
  onReload,
}: {
  config: AdminModelConfig;
  snapshot: AdminModelChannelsSnapshot;
  canWrite: boolean;
  canTest: boolean;
  onReload: () => Promise<void>;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');
  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    modality: Modality;
    channel: AdminModelChannelRecord | null;
  }>({ open: false, mode: 'create', modality: 'image', channel: null });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testNonce, setTestNonce] = useState(0);
  const [testAll, setTestAll] = useState<AdminChannelTestAllResult | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminModelChannelRecord | null>(null);
  const [materializeTarget, setMaterializeTarget] = useState<AdminModelChannelRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const modalities = filter === 'all' ? MODALITY_ORDER : [filter];

  const grouped = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return modalities.map((m) => {
      const snap = snapshot.modalities[m];
      const rows = (snap?.channels ?? []).filter((ch) => {
        if (!kw) return true;
        return [ch.name, ch.baseUrl, ch.model, ch.protocol].some((x) => x.toLowerCase().includes(kw));
      });
      return { modality: m, snap, rows };
    });
  }, [modalities, snapshot, keyword]);

  const visibleGroups = keyword.trim() ? grouped.filter((g) => g.rows.length > 0) : grouped;

  const openCreate = (modality: Modality) => {
    setDrawer({ open: true, mode: 'create', modality, channel: null });
  };
  const openEdit = (modality: Modality, channel: AdminModelChannelRecord) => {
    setDrawer({ open: true, mode: 'edit', modality, channel });
  };

  const move = async (ch: AdminModelChannelRecord, dir: 'up' | 'down') => {
    setBusyId(ch.id);
    try {
      await adminModelChannelsApi.move(ch.id, dir);
      await onReload();
    } catch (e) {
      toast.error((e as Error).message || '调整顺序失败');
    } finally {
      setBusyId(null);
    }
  };

  const testOne = async (ch: AdminModelChannelRecord) => {
    setBusyId(ch.id);
    try {
      const r = await adminModelChannelsApi.testSaved(ch.id);
      writeCachedTest(ch.id, ch.updatedAt, r);
      setTestNonce((n) => n + 1);
      if (r.ok) toast.success(`${ch.name}：连通正常（${r.latencyMs}ms）`);
      else toast.warning(`${ch.name}：${r.message}`);
    } catch (e) {
      toast.error((e as Error).message || '测试失败');
    } finally {
      setBusyId(null);
    }
  };

  const testAllChannels = async () => {
    setTestingAll(true);
    setTestAll(null);
    try {
      const r = await adminModelChannelsApi.testAll(filter === 'all' ? undefined : filter);
      for (const item of r.results) {
        if (item.channelId && !item.synthetic) {
          const row = snapshot.modalities[item.modality]?.channels.find((c) => c.id === item.channelId);
          writeCachedTest(item.channelId, row?.updatedAt ?? null, item);
        }
      }
      setTestNonce((n) => n + 1);
      setTestAll(r);
      if (r.okCount === r.total) toast.success(`全部 ${r.total} 条线路连通正常（${r.elapsedMs}ms）`);
      else toast.warning(`${r.okCount}/${r.total} 条线路通过，失败项见逐条结果`);
    } catch (e) {
      toast.error(`批量测试失败：${(e as Error).message}`);
    } finally {
      setTestingAll(false);
    }
  };

  const doDelete = async (_typed: string, reason: string) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await adminModelChannelsApi.remove(deleteTarget.id, reason.trim() || undefined);
      const after =
        r.sourceAfter === 'legacy'
          ? '该模态已回落到旧版单通道配置'
          : r.sourceAfter === 'none'
            ? '该模态当前未接入'
            : '其余线路继续按顺序调度';
      toast.success(`已删除线路，${after}`);
      setDeleteTarget(null);
      await onReload();
    } catch (e) {
      toast.error((e as Error).message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const doMaterialize = async (_typed: string, reason: string) => {
    if (!materializeTarget) return;
    try {
      const r = await adminModelChannelsApi.materialize(materializeTarget.modality, reason.trim() || undefined);
      toast.success(r.materialized ? '已把旧版配置转为可管理线路' : '该模态已有线路，无需转换');
      setMaterializeTarget(null);
      await onReload();
    } catch (e) {
      toast.error((e as Error).message || '转换失败');
    }
  };

  const renderEmpty = (modality: Modality) => (
    <div className="flex items-center gap-4 rounded-xl border border-border-table bg-background-secondary-default px-4 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-table bg-white text-text-tertiary">
        <Cable className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">尚未接入真实模型</p>
        <p className="mt-0.5 text-xs leading-5 text-text-tertiary">{MODALITY_EMPTY_HINT[modality]}</p>
      </div>
      <Button variant="primary" size="small" disabled={!canWrite} onClick={() => openCreate(modality)}>
        新增线路
      </Button>
    </div>
  );

  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-3">
        {MODALITY_ORDER.map((m) => (
          <ChannelHealthCard
            key={m}
            modality={m}
            snapshot={snapshot.modalities[m]}
            active={filter === m}
            onClick={() => setFilter((f) => (f === m ? 'all' : m))}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border-table bg-white px-3 py-2.5">
        <SegmentedBox
          value={filter}
          onChange={(next) => setFilter(next as Filter)}
          ariaLabel="按模态筛选"
          options={[
            { value: 'all', label: '全部' },
            ...MODALITY_ORDER.map((m) => ({ value: m, label: MODALITY_LABEL[m] })),
          ]}
        />
        <div className="relative w-[280px]">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <TextInput
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索线路名称 / 地址 / 模型"
            ariaLabel="搜索线路"
            className="pl-7"
          />
        </div>
        <Button
          variant="secondary"
          size="small"
          className="ml-auto"
          disabled={!canTest || testingAll}
          onClick={() => void testAllChannels()}
        >
          {testingAll ? '测试中…' : '测试全部线路'}
        </Button>
      </div>

      {testAll && (
        <Notice
          tone={testAll.okCount === testAll.total ? 'success' : 'warn'}
          title={`${testAll.okCount}/${testAll.total} 条线路通过`}
          className="mb-3"
        >
          耗时 {testAll.elapsedMs}ms
          {testAll.results[0]?.testedAt ? ` · ${fmtTime(testAll.results[0].testedAt)}` : ''}
        </Notice>
      )}

      {keyword.trim() && visibleGroups.length === 0 ? (
        <Panel>
          <EmptyState
            title="没有匹配的线路"
            description="试试其它关键词，或清空搜索查看全部模态。"
            action={
              <Button variant="secondary" size="small" onClick={() => setKeyword('')}>
                清空搜索
              </Button>
            }
          />
        </Panel>
      ) : (
        visibleGroups.map(({ modality, snap, rows }) => {
          const source = snap?.source ?? 'none';
          const dispatch = DISPATCH_SOURCE_META[source];
          const allChannels = snap?.channels ?? [];
          const allDisabled = allChannels.length > 0 && (snap?.enabledCount ?? 0) === 0;
          const empty = rows.length === 0 && !keyword;

          return (
            <Panel
              key={modality}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{MODALITY_LABEL[modality]}</span>
                  <Chip variant="caption" color={TONE_CHIP_COLOR[dispatch.tone]}>
                    {dispatch.label}
                  </Chip>
                  {(snap?.total ?? 0) > 0 && (
                    <span className="text-xs font-normal text-text-tertiary">
                      {snap?.total ?? 0} 条线路 · {snap?.availableCount ?? 0} 可用
                      {snap && snap.coolingCount > 0 ? ` · ${snap.coolingCount} 冷却中` : ''}
                    </span>
                  )}
                </span>
              }
              extra={
                !empty && (
                  <Button
                    variant="secondary"
                    size="small"
                    leadingIcon={Plus}
                    disabled={!canWrite}
                    onClick={() => openCreate(modality)}
                  >
                    新增线路
                  </Button>
                )
              }
            >
              {!empty && <p className="mb-3 text-xs leading-5 text-text-tertiary">{dispatch.hint}</p>}

              {source === 'legacy' && (
                <Notice
                  tone="info"
                  title="当前沿用旧版单通道配置（未落库）"
                  className="mb-3"
                >
                  新增任意线路或点击「转为可管理」后，调度会改为按线路列表执行，旧版基址/令牌不再参与该模态的调度。
                </Notice>
              )}
              {allDisabled && (
                <Notice
                  tone="danger"
                  title={`该模态的 ${allChannels.length} 条线路均已停用，不会尝试远程`}
                  className="mb-3"
                >
                  {modality === 'image'
                    ? '图像能力将不可提交；直调任务会失败并退款。'
                    : '文生文/文生视频调用会直接失败并退款。'}
                </Notice>
              )}

              {empty ? (
                renderEmpty(modality)
              ) : (
                <ChannelTable
                  channels={rows}
                  vendors={config.channels[modality]?.vendors ?? []}
                  canWrite={canWrite}
                  canTest={canTest}
                  busyId={busyId}
                  testNonce={testNonce}
                  onEdit={(ch) => openEdit(modality, ch)}
                  onTest={(ch) => void testOne(ch)}
                  onMove={(ch, dir) => void move(ch, dir)}
                  onDelete={setDeleteTarget}
                  onMaterialize={setMaterializeTarget}
                />
              )}
            </Panel>
          );
        })
      )}

      <ChannelEditDrawer
        open={drawer.open}
        mode={drawer.mode}
        modality={drawer.modality}
        channel={drawer.channel}
        vendors={config.channels[drawer.modality]?.vendors ?? []}
        protocolOptions={config.channels[drawer.modality]?.protocolOptions ?? []}
        canWrite={canWrite}
        canTest={canTest}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={onReload}
      />

      <InlineConfirm
        open={Boolean(deleteTarget)}
        danger
        title="确认删除线路"
        description="删除后该线路立即退出调度；若这是该模态最后一条线路，会回落到旧版单通道配置（仍启用时）。"
        impact={
          deleteTarget
            ? [`线路：${deleteTarget.name}`, `接入地址：${deleteTarget.baseUrl || '未填写'}`]
            : undefined
        }
        needReason
        reasonPlaceholder="如：线路已停用"
        confirmText="确认删除"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(typed, reason) => void doDelete(typed, reason)}
      />

      <InlineConfirm
        open={Boolean(materializeTarget)}
        title="把旧版配置转为可管理线路？"
        description="系统会把当前生效的旧版单通道配置（含令牌）复制为一条线路并落库。转换后，旧版基址/令牌不再参与调度，但超时与轮询仍按模态生效。"
        impact={
          materializeTarget
            ? [`模态：${MODALITY_LABEL[materializeTarget.modality]}`, `当前线路：${materializeTarget.name}`]
            : undefined
        }
        needReason
        reasonPlaceholder="如：开始使用多渠道调度"
        confirmText="确认转换"
        onCancel={() => setMaterializeTarget(null)}
        onConfirm={(typed, reason) => void doMaterialize(typed, reason)}
      />
    </>
  );
}
