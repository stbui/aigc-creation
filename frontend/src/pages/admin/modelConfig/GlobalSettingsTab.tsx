import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { adminModelApi } from '../../../lib/api';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { CollapsiblePanel, Panel } from '../../../components/admin/PageHeader';
import { Notice } from '../../../admin-ui/primitives';
import { SegmentedBox, SelectBox } from '../../../admin-ui/controls';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
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
  vendorDisplayLabel,
} from './meta';
import type { ModelConfigDraft } from './useModelConfigDraft';

const ADVANCED_KEY = 'admin.modelCfg.advancedOpen';

/** 「自定义（手动填写）」在厂商下拉里的哨兵值 */
const CUSTOM = '__custom__';

/**
 * 全局设置页签。
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
  const toast = useToast();
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
        toast.info(
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
      if (r.ok) toast.success(`${MODALITY_LABEL[modality]}草稿连通正常`);
      else toast.warning(`${MODALITY_LABEL[modality]}草稿测试失败：${r.message}`);
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
    <>
      <div className="mb-3">
        <SegmentedBox
          value={modality}
          onChange={(next) => {
            setModality(next as Modality);
            setTestResult(null);
          }}
          ariaLabel="按模态切换"
          options={MODALITY_ORDER.map((m) => ({ value: m, label: MODALITY_LABEL[m] }))}
        />
      </div>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <span>旧版单通道配置</span>
            <Chip variant="caption" color={TONE_CHIP_COLOR[dispatch.tone]}>
              {dispatch.label}
            </Chip>
          </span>
        }
        note="没有线路时由这里提供接入参数；有线路后仅超时与轮询仍生效。"
      >
        {channel?.dispatchSource === 'channels' && (
          <Notice
            tone="info"
            className="mb-3"
            title={`该模态已有 ${channel.channelCount ?? 0} 条线路，生成按线路列表调度`}
          >
            以下基址/令牌/协议不再参与该模态的调度；只有在删除全部线路后才会恢复生效。
          </Notice>
        )}
        {channel?.dispatchSource === 'none' && (
          <Notice
            tone={modality === 'image' ? 'warn' : 'danger'}
            className="mb-3"
            title={MODALITY_EMPTY_HINT[modality]}
          />
        )}

        <div className="mb-3 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">模型厂商</span>
            <SelectBox
              value={currentVendor?.key ?? CUSTOM}
              onChange={(next) => {
                if (!next) return;
                if (next === CUSTOM) draftState.setValue(`${prefix}.vendor`, '');
                else void applyVendor(next);
              }}
              disabled={!canWrite}
              options={[
                ...(channel?.vendors ?? []).map((v) => ({
                  value: v.key,
                  label: vendorDisplayLabel(v.label),
                })),
                { value: CUSTOM, label: '自定义（手动填写）' },
              ]}
              ariaLabel="模型厂商"
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">通道协议</span>
            <SelectBox
              value={String(valueOf(`${prefix}.provider`) ?? '') || undefined}
              onChange={(next) => {
                if (next) changeProtocol(next);
              }}
              disabled={!canWrite}
              options={(channel?.protocolOptions ?? []).map((o) => ({ value: o.value, label: o.label }))}
              ariaLabel="通道协议"
              className="w-full"
            />
          </div>
        </div>

        <p className="mb-1 text-xs leading-5 text-text-tertiary">
          {PROTOCOL_HINT[currentProtocol] ?? '按协议层声明的端点与参数格式调用。'}
          {currentVendor && (
            <>
              {' '}
              <a
                href={currentVendor.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-accent-600 underline-offset-2 hover:underline"
              >
                前往 {vendorDisplayLabel(currentVendor.label)} 控制台获取 API Key
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </>
          )}
        </p>
        {/* 协议形状与线路抽屉同一份说明, 两处都常驻展示 */}
        {protocolDesc && (
          <p className="mb-3 text-xs leading-5 text-text-tertiary">{protocolDesc}</p>
        )}

        <div>{baseItems.map(renderItem)}</div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-table pt-3">
          <Button
            variant="secondary"
            size="small"
            disabled={!canTest || testing}
            onClick={() => void runTest()}
          >
            {testing ? '测试中…' : `测试${MODALITY_LABEL[modality]}当前草稿`}
          </Button>
          <span className="text-xs text-text-tertiary">
            {canTest ? '使用当前表单值测试，不需要先保存。' : '当前角色没有通道测试权限。'}
          </span>
        </div>

        {testResult && (
          <Notice
            tone={testResult.ok ? 'success' : 'danger'}
            className="mb-0 mt-3"
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  {testResult.ok ? '连通正常' : '连通失败'} · {fmtLatency(testResult.latencyMs)}
                </span>
                <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">草稿</span>
              </span>
            }
          >
            <div>{testResult.message}</div>
            <div className="mt-0.5 text-text-tertiary">{fmtTime(testResult.testedAt)}</div>
            {testResult.detail && (
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                {testResult.detail}
              </pre>
            )}
          </Notice>
        )}
      </Panel>

      <CollapsiblePanel
        title="超时与轮询"
        note="多数情况用默认值；排障轮询超时时再调。"
        open={advancedOpen}
        onToggle={(next) => {
          setAdvancedOpen(next);
          try {
            localStorage.setItem(ADVANCED_KEY, next ? '1' : '0');
          } catch {
            // ignore
          }
        }}
        collapsedHint={
          <span className="rounded bg-background-secondary-default px-1.5 py-0.5 text-[11px]">
            {timeoutItems.length} 项 · {timeoutItems.filter((i) => i.overridden).length} 项已改
          </span>
        }
      >
        {timeoutItems.map(renderItem)}
      </CollapsiblePanel>

      <Panel title="素材回传地址" note="真实模型网关回拉参考图时使用的站内可达地址。">
        <div>{assetItems.map(renderItem)}</div>
      </Panel>
    </>
  );
}
