import { Button, Flex, Popover, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { AdminModelChannelRecord, VendorPreset } from '../../../types/api';
import {
  fmtLatency,
  fmtTime,
  healthMeta,
  hostOf,
  matchVendor,
  readCachedTest,
  tagColor,
  vendorDisplayLabel,
} from './meta';

/**
 * 单模态线路表（antd Table）。
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
  const columns = [
    {
      title: '线路',
      dataIndex: 'name',
      key: 'name',
      width: 280,
      render: (_: unknown, ch: AdminModelChannelRecord) => {
        const health = healthMeta(ch);
        const vendor = matchVendor(ch, vendors);
        const vendorLabel = vendor ? vendorDisplayLabel(vendor.label) : '自定义';
        return (
          <Flex vertical gap={2}>
            <Space size={6} wrap>
              <Button
                type="link"
                size="small"
                style={{ padding: 0, fontWeight: 600 }}
                onClick={() => onEdit(ch)}
                disabled={ch.synthetic}
                title={ch.synthetic ? '旧版配置需先转为可管理线路' : '编辑线路'}
              >
                {ch.name}
              </Button>
              {ch.synthetic && (
                <Tag color="warning" variant="filled">
                  旧版配置
                </Tag>
              )}
              {!ch.enabled && (
                <Tag variant="filled" color="default">
                  已停用
                </Tag>
              )}
              {!ch.protocolKnown && (
                <Tooltip title="该协议在本项目尚未实现，启用后调用会失败">
                  <Tag color="error" variant="filled">
                    协议未接入
                  </Tag>
                </Tooltip>
              )}
              {health.tone === 'is-danger' && (
                <Tooltip title={health.hint}>
                  <Tag color="error" variant="filled">
                    冷却中
                  </Tag>
                </Tooltip>
              )}
            </Space>
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {vendorLabel}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ·
              </Typography.Text>
              <Typography.Text code style={{ fontSize: 11 }}>
                {ch.protocol}
              </Typography.Text>
            </Space>
          </Flex>
        );
      },
    },
    {
      title: '默认模型',
      dataIndex: 'model',
      key: 'model',
      width: 240,
      /*
       * 除了「这条线路用哪个模型」，还要回答「这家厂商还有哪些模型可选」——
       * 运营配下一跳或换模型时不必再点开编辑抽屉逐个找。
       */
      render: (v: string, ch: AdminModelChannelRecord) => {
        const vendor = matchVendor(ch, vendors);
        const models = vendor?.models ?? [];
        const others = models.filter((m) => m.id !== ch.model);
        return (
          <Flex vertical gap={2}>
            {v ? (
              <Tooltip title={v}>
                <Typography.Text code style={{ fontSize: 12 }}>
                  {v}
                </Typography.Text>
              </Tooltip>
            ) : (
              <Typography.Text type="secondary">按协议默认</Typography.Text>
            )}
            {vendor && models.length > 0 && (
              <Popover
                trigger="click"
                placement="bottomLeft"
                title={`${vendorDisplayLabel(vendor.label)} · 可选模型（${models.length}）`}
                content={
                  <Flex vertical gap={6} style={{ maxWidth: 380 }}>
                    {models.map((m) => (
                      <Flex key={m.id} vertical gap={0}>
                        <Space size={6} wrap>
                          <Typography.Text strong style={{ fontSize: 12 }}>
                            {m.label}
                          </Typography.Text>
                          {m.id === ch.model && (
                            <Tag color="purple" variant="filled" style={{ marginInlineEnd: 0 }}>
                              当前
                            </Tag>
                          )}
                        </Space>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {m.id}
                          {m.note ? ` · ${m.note}` : ''}
                        </Typography.Text>
                      </Flex>
                    ))}
                  </Flex>
                }
              >
                <Typography.Link style={{ fontSize: 11 }}>
                  {others.length > 0 ? `另有 ${others.length} 个可选模型` : '查看该厂商模型'}
                </Typography.Link>
              </Popover>
            )}
          </Flex>
        );
      },
    },
    {
      title: '接入地址',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      width: 170,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text code style={{ fontSize: 12 }}>
              {hostOf(v)}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">未填写</Typography.Text>
        ),
    },
    {
      title: '健康',
      key: 'health',
      width: 180,
      render: (_: unknown, ch: AdminModelChannelRecord) => {
        const health = healthMeta(ch);
        const cached = testNonce >= 0 && !ch.synthetic ? readCachedTest(ch.id, ch.updatedAt) : null;
        return (
          <Flex vertical gap={2}>
            <Tooltip title={health.hint}>
              <Tag color={tagColor(health.tone)} variant="filled" style={{ width: 'fit-content' }}>
                {health.label}
              </Tag>
            </Tooltip>
            {cached && (
              <Typography.Text
                type={cached.result.ok ? 'success' : 'danger'}
                style={{ fontSize: 11 }}
                title="测试只验证地址与模型可达，不代表真实生成健康"
              >
                {cached.result.ok ? '测试通过' : '测试失败'} · {fmtLatency(cached.result.latencyMs)} ·{' '}
                {fmtTime(cached.testedAt)}
              </Typography.Text>
            )}
          </Flex>
        );
      },
    },
    {
      title: '顺序',
      key: 'priority',
      width: 112,
      render: (_: unknown, ch: AdminModelChannelRecord, index: number) => {
        if (ch.synthetic) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Space size={2}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              第 {index + 1} 位
            </Typography.Text>
            <Button
              type="text"
              size="small"
              aria-label="上移"
              disabled={!canWrite || index === 0 || busyId === ch.id}
              onClick={() => onMove(ch, 'up')}
              icon={<ArrowUp size={13} />}
            />
            <Button
              type="text"
              size="small"
              aria-label="下移"
              disabled={!canWrite || index === channels.length - 1 || busyId === ch.id}
              onClick={() => onMove(ch, 'down')}
              icon={<ArrowDown size={13} />}
            />
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, ch: AdminModelChannelRecord) =>
        ch.synthetic ? (
          <Button type="link" size="small" disabled={!canWrite} onClick={() => onMaterialize(ch)}>
            转为可管理
          </Button>
        ) : (
          <Space size={4}>
            <Button type="link" size="small" disabled={!canWrite} onClick={() => onEdit(ch)}>
              编辑
            </Button>
            <Button type="link" size="small" disabled={!canTest || busyId === ch.id} onClick={() => onTest(ch)}>
              {busyId === ch.id ? '测试中' : '测试'}
            </Button>
            <Button type="link" size="small" danger disabled={!canWrite} onClick={() => onDelete(ch)}>
              删除
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <Table<AdminModelChannelRecord>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={channels}
      pagination={false}
      scroll={{ x: 1080 }}
      aria-label="模型线路列表"
    />
  );
}
