import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Flex,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { adminModelApi } from '../../../lib/api';
import type { AdminModelConfig, AdminModelConfigItem, Modality } from '../../../types/api';
import { ConfigItemRow } from './ConfigItemRow';
import {
  DISPATCH_SOURCE_META,
  MODALITY_EMPTY_HINT,
  MODALITY_LABEL,
  MODALITY_ORDER,
  PROTOCOL_HINT,
  fmtLatency,
  fmtTime,
  tagColor,
  vendorDisplayLabel,
} from './meta';
import type { ModelConfigDraft } from './useModelConfigDraft';

const ADVANCED_KEY = 'admin.modelCfg.advancedOpen';

/**
 * 全局设置页签（antd Card / Collapse / Segmented / Alert）。
 *
 * 这里保留旧版配置，不是历史包袱：没有线路的部署仍靠它工作。
 * 一旦某模态有线路，对应分组会明确标注「不参与调度」。
 */
export function GlobalSettingsTab({
  config,
  draftState,
  canWrite,
  canTest,
}: {
  config: AdminModelConfig;
  draftState: ModelConfigDraft;
  canWrite: boolean;
  canTest: boolean;
}) {
  const { message } = App.useApp();
  const [modality, setModality] = useState<Modality>('image');
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ADVANCED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    detail?: string;
    latencyMs: number;
    testedAt?: string;
    target?: 'draft' | 'saved';
  } | null>(null);

  const channel = config.channels[modality];
  const dispatch = DISPATCH_SOURCE_META[channel?.dispatchSource ?? (channel?.enabled ? 'legacy' : 'none')];
  const prefix = `gateway.${modality}`;

  const itemsOf = (group: string, m?: Modality) =>
    config.groups
      .find((g) => g.key === group)
      ?.items.filter((it) => (m ? it.modality === m : it.modality == null)) ?? [];

  /*
   * provider / vendor 已由上方两个下拉承担，不在配置行里重复出现。
   */
  const baseItems = useMemo(
    () =>
      itemsOf('base', modality).filter(
        (it) => it.key !== `${prefix}.provider` && it.key !== `${prefix}.vendor`,
      ),
    [config, modality, prefix],
  );
  const timeoutItems = useMemo(() => itemsOf('timeout', modality), [config, modality]);
  const assetItems = useMemo(() => itemsOf('asset'), [config]);

  const itemOf = (key: string): AdminModelConfigItem | undefined =>
    config.groups.flatMap((g) => g.items).find((it) => it.key === key);

  const valueOf = (key: string) => {
    const item = itemOf(key);
    if (!item) return undefined;
    if (draftState.clears[key]) return item.default;
    return draftState.draft[key] ?? item.value ?? item.default;
  };

  /** 当前协议标识 —— 说明文案与厂商匹配共用同一个值, 避免两处各算一遍 */
  const currentProtocol = String(valueOf(`${prefix}.provider`) ?? '');
  /** 协议层派生的完整形状说明 (端点/尺寸写法/参考图), 由后端下发生成 */
  const protocolDesc = channel?.protocolOptions.find((o) => o.value === currentProtocol)?.desc;

  const currentVendor = (channel?.vendors ?? []).find(
    (v) =>
      v.protocol === String(valueOf(`${prefix}.provider`) ?? '') &&
      v.baseUrl.replace(/\/+$/, '') === String(valueOf(`${prefix}.baseUrl`) ?? '').replace(/\/+$/, ''),
  );

  const applyVendor = async (key: string) => {
    const v = (channel?.vendors ?? []).find((x) => x.key === key);
    if (!v) return;
    const patch: Record<string, string> = {
      [`${prefix}.vendor`]: v.key,
      [`${prefix}.provider`]: v.protocol,
      [`${prefix}.baseUrl`]: v.baseUrl,
      [`${prefix}.model`]: v.models[0]?.id ?? '',
    };
    try {
      const plan = await adminModelApi.vendorFillPlan(v.vendorKey);
      for (const f of plan.fills) {
        const p = `gateway.${f.modality}`;
        patch[`${p}.vendor`] = f.vendorPresetKey;
        patch[`${p}.baseUrl`] = f.baseUrl;
        patch[`${p}.provider`] = f.provider;
        patch[`${p}.model`] = f.model;
      }
      draftState.clearFlags(
        plan.fills.flatMap((f) => [`gateway.${f.modality}.baseUrl`, `gateway.${f.modality}.provider`]),
      );
      if (plan.fills.length > 1) {
        void message.info(
          `已按「${plan.label}」联动填入 ${plan.fills.length} 个模态的基址与模型（令牌仍需分别填写）`,
        );
      }
    } catch {
      // 拿不到联动方案时至少填当前模态
    }
    draftState.patchDraft(patch);
  };

  const changeProtocol = (protocol: string) => {
    const v = (channel?.vendors ?? []).find((x) => x.protocol === protocol);
    draftState.setValue(`${prefix}.provider`, protocol);
    draftState.setValue(`${prefix}.vendor`, v?.key ?? '');
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const tokenKey = `${prefix}.token`;
      const draftToken = draftState.draft[tokenKey];
      let token: string | undefined;
      if (draftState.clears[tokenKey]) token = '';
      else if (typeof draftToken === 'string' && draftToken.length > 0) token = draftToken;
      else token = undefined;

      const r = await adminModelApi.testConfig(modality, {
        protocol: String(valueOf(`${prefix}.provider`) ?? ''),
        baseUrl: String(valueOf(`${prefix}.baseUrl`) ?? ''),
        model: String(valueOf(`${prefix}.model`) ?? ''),
        enabled: true,
        ...(token !== undefined ? { token } : {}),
      });
      setTestResult(r);
      if (r.ok) void message.success(`${MODALITY_LABEL[modality]}草稿连通正常`);
      else void message.warning(`${MODALITY_LABEL[modality]}草稿测试失败：${r.message}`);
    } catch (e) {
      setTestResult({
        ok: false,
        message: (e as Error).message || '测试失败',
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        target: 'draft',
      });
    } finally {
      setTesting(false);
    }
  };

  const renderItem = (item: AdminModelConfigItem) => (
    <ConfigItemRow
      key={item.key}
      item={item}
      value={draftState.draft[item.key]}
      cleared={Boolean(draftState.clears[item.key])}
      canWrite={canWrite}
      onChange={(v) => draftState.setValue(item.key, v)}
      onToggleClear={() => draftState.toggleClear(item.key)}
    />
  );

  return (
    <Flex vertical gap={16}>
      <Segmented<Modality>
        value={modality}
        onChange={(m) => {
          setModality(m);
          setTestResult(null);
        }}
        options={MODALITY_ORDER.map((m) => ({ label: MODALITY_LABEL[m], value: m }))}
      />

      <Card
        size="small"
        title={
          <Space size={8}>
            <Typography.Text strong>旧版单通道配置</Typography.Text>
            <Tag color={tagColor(dispatch.tone)} variant="filled">
              {dispatch.label}
            </Tag>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          没有线路时由这里提供接入参数；有线路后仅超时与轮询仍生效。
        </Typography.Paragraph>

        {channel?.dispatchSource === 'channels' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title={`该模态已有 ${channel.channelCount ?? 0} 条线路，生成按线路列表调度`}
            description="以下基址/令牌/协议不再参与该模态的调度；只有在删除全部线路后才会恢复生效。"
          />
        )}
        {channel?.dispatchSource === 'none' && (
          <Alert
            type={modality === 'image' ? 'warning' : 'error'}
            showIcon
            style={{ marginBottom: 16 }}
            title={MODALITY_EMPTY_HINT[modality]}
          />
        )}

        <Row gutter={24}>
          <Col xs={24} md={12}>
            <Space orientation="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
              <Typography.Text strong>模型厂商</Typography.Text>
              <Select
                value={currentVendor?.key ?? '__custom__'}
                disabled={!canWrite}
                style={{ width: '100%' }}
                onChange={(v) =>
                  v === '__custom__' ? draftState.setValue(`${prefix}.vendor`, '') : void applyVendor(v)
                }
                options={[
                  ...(channel?.vendors ?? []).map((v) => ({
                    value: v.key,
                    label: vendorDisplayLabel(v.label),
                  })),
                  { value: '__custom__', label: '自定义（手动填写）' },
                ]}
              />
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Space orientation="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
              <Typography.Text strong>通道协议</Typography.Text>
              <Select
                value={String(valueOf(`${prefix}.provider`) ?? '')}
                disabled={!canWrite}
                style={{ width: '100%' }}
                onChange={changeProtocol}
                options={(channel?.protocolOptions ?? []).map((o) => ({
                  value: o.value,
                  label: o.label,
                  title: o.desc,
                }))}
              />
            </Space>
          </Col>
        </Row>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
          {PROTOCOL_HINT[currentProtocol] ?? '按协议层声明的端点与参数格式调用。'}
          {currentVendor && (
            <>
              {' '}
              <Typography.Link href={currentVendor.consoleUrl} target="_blank" rel="noreferrer">
                前往 {vendorDisplayLabel(currentVendor.label)} 控制台获取 API Key →
              </Typography.Link>
            </>
          )}
        </Typography.Paragraph>
        {/* 协议形状与线路抽屉同一份说明, 两处都常驻展示 */}
        {protocolDesc && (
          <Typography.Paragraph type="secondary" className="mc-protocol-note-tech" style={{ fontSize: 12 }}>
            {protocolDesc}
          </Typography.Paragraph>
        )}

        <div>{baseItems.map(renderItem)}</div>

        <Divider style={{ margin: '16px 0 12px' }} />

        <Space size={12} wrap style={{ marginBottom: 12 }}>
          <Button loading={testing} disabled={!canTest} onClick={() => void runTest()}>
            测试{MODALITY_LABEL[modality]}当前草稿
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {canTest ? '使用当前表单值测试，不需要先保存。' : '当前角色没有通道测试权限。'}
          </Typography.Text>
        </Space>

        {testResult && (
          <Alert
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            title={
              <Space size={8} wrap>
                <span>
                  {testResult.ok ? '连通正常' : '连通失败'} · {fmtLatency(testResult.latencyMs)}
                </span>
                <Tag variant="filled">草稿</Tag>
              </Space>
            }
            description={
              <Space orientation="vertical" size={2}>
                <Typography.Text>{testResult.message}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtTime(testResult.testedAt)}
                </Typography.Text>
                {testResult.detail && (
                  <Typography.Text code style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {testResult.detail}
                  </Typography.Text>
                )}
              </Space>
            }
          />
        )}
      </Card>

      <Collapse
        activeKey={advancedOpen ? ['advanced'] : []}
        onChange={(keys) => {
          const next = Array.isArray(keys) && keys.includes('advanced');
          setAdvancedOpen(next);
          try {
            localStorage.setItem(ADVANCED_KEY, next ? '1' : '0');
          } catch {
            // ignore
          }
        }}
        items={[
          {
            key: 'advanced',
            label: (
              <Space size={8}>
                <Typography.Text strong>超时与轮询</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  多数情况用默认值；排障轮询超时时再调。
                </Typography.Text>
                <Tag variant="filled">
                  {timeoutItems.length} 项 · {timeoutItems.filter((i) => i.overridden).length} 项已改
                </Tag>
              </Space>
            ),
            children: <div>{timeoutItems.map(renderItem)}</div>,
          },
        ]}
      />

      <Card size="small" title="素材回传地址">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          真实模型网关回拉参考图时使用的站内可达地址。
        </Typography.Paragraph>
        <div>{assetItems.map(renderItem)}</div>
      </Card>
    </Flex>
  );
}
