import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import { Cable, Plus, Search } from 'lucide-react';
import { adminModelChannelsApi } from '../../../lib/api';
import type {
  AdminChannelTestAllResult,
  AdminModelChannelRecord,
  AdminModelChannelsSnapshot,
  AdminModelConfig,
  Modality,
} from '../../../types/api';
import { AntConfirm } from './AntConfirm';
import { ChannelEditDrawer } from './ChannelEditDrawer';
import { ChannelHealthCard } from './ChannelHealthCard';
import { ChannelTable } from './ChannelTable';
import {
  DISPATCH_SOURCE_META,
  MODALITY_EMPTY_HINT,
  MODALITY_LABEL,
  MODALITY_ORDER,
  fmtTime,
  tagColor,
  writeCachedTest,
} from './meta';

type Filter = 'all' | Modality;

/**
 * 线路管理页签（antd 版）：健康卡 + 按模态分组的线路表 + 编辑抽屉。
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
  const { message } = App.useApp();
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
      void message.error((e as Error).message || '调整顺序失败');
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
      if (r.ok) void message.success(`${ch.name}：连通正常（${r.latencyMs}ms）`);
      else void message.warning(`${ch.name}：${r.message}`);
    } catch (e) {
      void message.error((e as Error).message || '测试失败');
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
      if (r.okCount === r.total) void message.success(`全部 ${r.total} 条线路连通正常（${r.elapsedMs}ms）`);
      else void message.warning(`${r.okCount}/${r.total} 条线路通过，失败项见逐条结果`);
    } catch (e) {
      void message.error(`批量测试失败：${(e as Error).message}`);
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
      void message.success(`已删除线路，${after}`);
      setDeleteTarget(null);
      await onReload();
    } catch (e) {
      void message.error((e as Error).message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const doMaterialize = async (_typed: string, reason: string) => {
    if (!materializeTarget) return;
    try {
      const r = await adminModelChannelsApi.materialize(materializeTarget.modality, reason.trim() || undefined);
      void message.success(r.materialized ? '已把旧版配置转为可管理线路' : '该模态已有线路，无需转换');
      setMaterializeTarget(null);
      await onReload();
    } catch (e) {
      void message.error((e as Error).message || '转换失败');
    }
  };

  const renderEmpty = (modality: Modality) => (
    <Flex
      align="center"
      gap={14}
      style={{ background: 'var(--surface)', borderRadius: 8, padding: 16 }}
    >
      <Avatar
        shape="circle"
        size={36}
        icon={<Cable size={18} />}
        style={{
          background: 'var(--card-bg)',
          color: 'var(--text-desc)',
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}
      />
      <Flex vertical style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong>尚未接入真实模型</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {MODALITY_EMPTY_HINT[modality]}
        </Typography.Text>
      </Flex>
      <Button type="primary" disabled={!canWrite} onClick={() => openCreate(modality)}>
        新增线路
      </Button>
    </Flex>
  );

  return (
    <Flex vertical gap={16}>
      <Row gutter={[12, 12]}>
        {MODALITY_ORDER.map((m) => (
          <Col key={m} xs={24} lg={8}>
            <ChannelHealthCard
              modality={m}
              snapshot={snapshot.modalities[m]}
              active={filter === m}
              onClick={() => setFilter((f) => (f === m ? 'all' : m))}
            />
          </Col>
        ))}
      </Row>

      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Space size={12} wrap>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { label: '全部', value: 'all' },
                ...MODALITY_ORDER.map((m) => ({ label: MODALITY_LABEL[m], value: m })),
              ]}
            />
            <Input
              allowClear
              prefix={<Search size={14} />}
              value={keyword}
              placeholder="搜索线路名称 / 地址 / 模型"
              style={{ width: 280 }}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Space>
          <Button
            style={{ marginLeft: 'auto' }}
            loading={testingAll}
            disabled={!canTest}
            onClick={() => void testAllChannels()}
          >
            测试全部线路
          </Button>
        </Flex>
      </Card>

      {testAll && (
        <Alert
          type={testAll.okCount === testAll.total ? 'success' : 'warning'}
          showIcon
          title={`${testAll.okCount}/${testAll.total} 条线路通过`}
          description={`耗时 ${testAll.elapsedMs}ms${
            testAll.results[0]?.testedAt ? ` · ${fmtTime(testAll.results[0].testedAt)}` : ''
          }`}
        />
      )}

      {keyword.trim() && visibleGroups.length === 0 ? (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有匹配的线路，试试其它关键词。"
          >
            <Button onClick={() => setKeyword('')}>清空搜索</Button>
          </Empty>
        </Card>
      ) : (
        visibleGroups.map(({ modality, snap, rows }) => {
          const source = snap?.source ?? 'none';
          const dispatch = DISPATCH_SOURCE_META[source];
          const allChannels = snap?.channels ?? [];
          const allDisabled = allChannels.length > 0 && (snap?.enabledCount ?? 0) === 0;
          const empty = rows.length === 0 && !keyword;

          return (
            <Card
              key={modality}
              size="small"
              title={
                <Space size={8} wrap>
                  <Typography.Text strong>{MODALITY_LABEL[modality]}</Typography.Text>
                  <Tag color={tagColor(dispatch.tone)} variant="filled">
                    {dispatch.label}
                  </Tag>
                  {(snap?.total ?? 0) > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                      {snap?.total ?? 0} 条线路 · {snap?.availableCount ?? 0} 可用
                      {snap && snap.coolingCount > 0 ? ` · ${snap.coolingCount} 冷却中` : ''}
                    </Typography.Text>
                  )}
                </Space>
              }
              extra={
                !empty && (
                  <Button icon={<Plus size={14} />} disabled={!canWrite} onClick={() => openCreate(modality)}>
                    新增线路
                  </Button>
                )
              }
            >
              {!empty && (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
                  {dispatch.hint}
                </Typography.Paragraph>
              )}

              {source === 'legacy' && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title="当前沿用旧版单通道配置（未落库）"
                  description="新增任意线路或点击「转为可管理」后，调度会改为按线路列表执行，旧版基址/令牌不再参与该模态的调度。"
                />
              )}
              {allDisabled && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  title={`该模态的 ${allChannels.length} 条线路均已停用，不会尝试远程`}
                  description={
                    modality === 'image'
                      ? '图像生成会回落本地算法。'
                      : '文生文/文生视频没有本地兜底，调用会直接失败。'
                  }
                />
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
            </Card>
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

      <AntConfirm
        open={Boolean(deleteTarget)}
        danger
        requireTyping
        typingText={deleteTarget?.name}
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

      <AntConfirm
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
    </Flex>
  );
}
