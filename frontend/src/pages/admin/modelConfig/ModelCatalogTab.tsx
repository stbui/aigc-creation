import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { Download, ExternalLink } from 'lucide-react';
import { adminModelChannelsApi } from '../../../lib/api';
import type {
  AdminModelChannelRecord,
  AdminModelChannelsSnapshot,
  AdminModelConfig,
  AdminModelListResult,
  Modality,
  VendorPreset,
} from '../../../types/api';
import { hostOf, MODALITY_LABEL, MODALITY_ORDER, vendorDisplayLabel } from './meta';

interface FetchState {
  loading?: boolean;
  result?: AdminModelListResult;
  error?: string;
}

/**
 * 可用模型清单（只读）。
 *
 * 回答的是「这个平台/这家厂商到底有哪些模型」。数据分两层:
 *   1. 内置预设 —— vendor.catalog.ts 收录的模型, 带中文说明, 离线可用;
 *   2. 厂商实时清单 —— 用已保存线路的令牌向厂商模型列表接口拉取。
 *
 * ⚠️ 实时拉取只会用**已保存线路的令牌**, 不在这里手填凭据 ——
 * 本页是总览, 不该成为另一个凭据入口; 要试新令牌请回线路编辑抽屉。
 */
export function ModelCatalogTab({
  config,
  snapshot,
  canTest,
}: {
  config: AdminModelConfig;
  snapshot: AdminModelChannelsSnapshot;
  canTest: boolean;
}) {
  const [states, setStates] = useState<Record<string, FetchState>>({});

  const load = async (key: string, body: { modality: Modality; id: string }) => {
    setStates((s) => ({ ...s, [key]: { loading: true } }));
    try {
      const result = await adminModelChannelsApi.listModels(body);
      setStates((s) => ({ ...s, [key]: { result } }));
    } catch (e) {
      setStates((s) => ({ ...s, [key]: { error: (e as Error).message || '拉取失败' } }));
    }
  };

  return (
    <Flex vertical gap={16}>
      <Alert
        type="info"
        showIcon
        title="模型清单由「内置预设 + 厂商实时拉取」两部分组成"
        description="预设来自代码内置的厂商目录，离线可用但可能滞后；实时清单会用该厂商已保存线路的令牌请求厂商模型列表接口，返回的是账号下真正可用的模型。拉取失败不影响手填。"
      />

      {MODALITY_ORDER.map((modality) => {
        const vendors = config.channels[modality]?.vendors ?? [];
        const channels = snapshot.modalities[modality]?.channels ?? [];
        const modelCount = vendors.reduce((n, v) => n + v.models.length, 0);
        // 有线路但匹配不到任何厂商预设 —— 这些是自定义接入，同样可以拉清单
        const customLines = channels.filter(
          (ch) => !ch.synthetic && !vendors.some((v) => matchesPreset(ch, v)),
        );

        return (
          <Card
            key={modality}
            size="small"
            title={
              <Space size={8} wrap>
                <Typography.Text strong>{MODALITY_LABEL[modality]}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  {vendors.length} 家厂商 · {modelCount} 个预设模型
                  {customLines.length > 0 ? ` · ${customLines.length} 条自定义线路` : ''}
                </Typography.Text>
              </Space>
            }
          >
            {vendors.length === 0 && customLines.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`${MODALITY_LABEL[modality]}暂无可选厂商预设`}
              />
            ) : (
              <Flex vertical gap={12}>
                {vendors.map((vendor, index) => (
                  <VendorBlock
                    key={vendor.key}
                    vendor={vendor}
                    lines={channels.filter((ch) => !ch.synthetic && matchesPreset(ch, vendor))}
                    state={states[`preset:${modality}:${vendor.key}`]}
                    canTest={canTest}
                    divided={index > 0}
                    onFetch={(id) => void load(`preset:${modality}:${vendor.key}`, { modality, id })}
                  />
                ))}

                {customLines.map((ch) => (
                  <VendorBlock
                    key={ch.id}
                    customLine={ch}
                    lines={[ch]}
                    state={states[`channel:${ch.id}`]}
                    canTest={canTest}
                    divided={true}
                    onFetch={(id) => void load(`channel:${ch.id}`, { modality, id })}
                  />
                ))}
              </Flex>
            )}
          </Card>
        );
      })}
    </Flex>
  );
}

function matchesPreset(ch: AdminModelChannelRecord, vendor: VendorPreset): boolean {
  return (
    ch.protocol === vendor.protocol &&
    ch.baseUrl.replace(/\/+$/, '') === vendor.baseUrl.replace(/\/+$/, '')
  );
}

/** 一家厂商（或一条自定义线路）的模型清单块 */
function VendorBlock({
  vendor,
  customLine,
  lines,
  state,
  canTest,
  divided,
  onFetch,
}: {
  vendor?: VendorPreset;
  customLine?: AdminModelChannelRecord;
  lines: AdminModelChannelRecord[];
  state?: FetchState;
  canTest: boolean;
  divided: boolean;
  onFetch: (lineId: string) => void;
}) {
  const tokenLine = lines.find((l) => l.hasToken);
  const usedModels = useMemo(() => new Set(lines.map((l) => l.model).filter(Boolean)), [lines]);

  const title = vendor ? vendorDisplayLabel(vendor.label) : customLine?.name ?? '未命名线路';
  const protocol = vendor?.protocol ?? customLine?.protocol ?? '';
  const baseUrl = vendor?.baseUrl ?? customLine?.baseUrl ?? '';
  const note = vendor?.note;
  const consoleUrl = vendor?.consoleUrl;

  const models = vendor?.models ?? [];
  const remote = state?.result?.remote ?? null;

  return (
    <Flex
      vertical
      gap={8}
      style={divided ? { borderTop: '1px solid var(--border-row)', paddingTop: 12 } : undefined}
    >
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Space size={8} wrap>
            <Typography.Text strong>{title}</Typography.Text>
            <Tag variant="filled">{protocol}</Tag>
            <Typography.Text code style={{ fontSize: 12 }}>
              {hostOf(baseUrl) || '未填写地址'}
            </Typography.Text>
            {consoleUrl && (
              <Typography.Link href={consoleUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                <Space size={4}>
                  获取令牌 <ExternalLink size={11} />
                </Space>
              </Typography.Link>
            )}
          </Space>
          {note && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {note}
            </Typography.Text>
          )}
        </Flex>

        <Tooltip
          title={
            !canTest
              ? '当前角色没有「通道测试」权限'
              : !tokenLine
                ? '该厂商还没有含令牌的已保存线路；请先在线路管理里配置并保存'
                : undefined
          }
        >
          <span>
            <Button
              size="small"
              icon={<Download size={13} />}
              loading={state?.loading}
              disabled={!canTest || !tokenLine}
              onClick={() => {
                if (tokenLine) onFetch(tokenLine.id);
              }}
            >
              拉取实时清单
            </Button>
          </span>
        </Tooltip>
      </Flex>

      {models.length > 0 && (
        <Space size={[6, 6]} wrap>
          {models.map((m) => (
            <Tooltip
              key={m.id}
              title={[m.id, m.note].filter(Boolean).join(' · ')}
            >
              <Tag
                color={usedModels.has(m.id) ? 'purple' : undefined}
                variant={usedModels.has(m.id) ? 'filled' : 'outlined'}
                style={{ marginInlineEnd: 0 }}
              >
                {m.label}
                {usedModels.has(m.id) ? ' · 使用中' : ''}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      )}

      {models.length === 0 && !remote && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          没有内置预设模型；配置线路后可用令牌拉取厂商真实清单。
        </Typography.Text>
      )}

      {state?.error && <Alert type="error" showIcon title={state.error} />}

      {state?.result && (
        <Alert
          type={remote && remote.length > 0 ? 'success' : 'warning'}
          showIcon
          title={state.result.message}
          description={
            <Flex vertical gap={6}>
              {remote && remote.length > 0 && (
                <Space size={[6, 6]} wrap>
                  {remote.slice(0, 80).map((id) => (
                    <Tooltip key={id} title={usedModels.has(id) ? '已有线路在使用' : undefined}>
                      <Tag
                        color={usedModels.has(id) ? 'purple' : undefined}
                        variant={usedModels.has(id) ? 'filled' : 'outlined'}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {id}
                      </Tag>
                    </Tooltip>
                  ))}
                  {remote.length > 80 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      共 {remote.length} 个，仅展示前 80 个
                    </Typography.Text>
                  )}
                </Space>
              )}
              {state.result.usedStoredToken && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  使用该线路已保存的访问令牌请求厂商接口。
                </Typography.Text>
              )}
              {!remote && state.result.endpoints.length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  尝试过的端点：{state.result.endpoints.join('、')}
                </Typography.Text>
              )}
            </Flex>
          }
        />
      )}
    </Flex>
  );
}
