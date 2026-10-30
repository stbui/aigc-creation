import { useMemo, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { adminModelChannelsApi } from '../../../lib/api';
import { EmptyState, Notice } from '../../../admin-ui/primitives';
import { Panel } from '../../../components/admin/PageHeader';
import { HoverTip } from '../../../admin-ui/controls';
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
    <>
      <Notice
        tone="info"
        title="模型清单由「内置预设 + 厂商实时拉取」两部分组成"
        className="mb-3"
      >
        预设来自代码内置的厂商目录，离线可用但可能滞后；实时清单会用该厂商已保存线路的令牌请求厂商模型列表接口，返回的是账号下真正可用的模型。拉取失败不影响手填。
      </Notice>

      {MODALITY_ORDER.map((modality) => {
        const vendors = config.channels[modality]?.vendors ?? [];
        const channels = snapshot.modalities[modality]?.channels ?? [];
        const modelCount = vendors.reduce((n, v) => n + v.models.length, 0);
        // 有线路但匹配不到任何厂商预设 —— 这些是自定义接入，同样可以拉清单
        const customLines = channels.filter(
          (ch) => !ch.synthetic && !vendors.some((v) => matchesPreset(ch, v)),
        );

        return (
          <Panel
            key={modality}
            title={MODALITY_LABEL[modality]}
            note={`${vendors.length} 家厂商 · ${modelCount} 个预设模型${
              customLines.length > 0 ? ` · ${customLines.length} 条自定义线路` : ''
            }`}
          >
            {vendors.length === 0 && customLines.length === 0 ? (
              <EmptyState
                title={`${MODALITY_LABEL[modality]}暂无可选厂商预设`}
                description="在「线路管理」里新增一条线路后，这里会出现该厂商的模型清单。"
              />
            ) : (
              <div className="flex flex-col gap-3">
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
                    divided
                    onFetch={(id) => void load(`channel:${ch.id}`, { modality, id })}
                  />
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </>
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
    <div className={divided ? 'border-t border-border-table pt-3' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{title}</span>
            <Chip variant="caption" color="neutral">
              {protocol}
            </Chip>
            <code className="font-mono text-[11px] text-text-tertiary">
              {hostOf(baseUrl) || '未填写地址'}
            </code>
            {consoleUrl && (
              <a
                href={consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-xs text-accent-600 underline-offset-2 hover:underline"
              >
                获取令牌
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
          {note && <span className="text-xs text-text-tertiary">{note}</span>}
        </div>

        <HoverTip
          tip={
            !canTest
              ? '当前角色没有「通道测试」权限'
              : !tokenLine
                ? '该厂商还没有含令牌的已保存线路；请先在线路管理里配置并保存'
                : undefined
          }
        >
          <span>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={!canTest || !tokenLine}
              onClick={() => {
                if (tokenLine) onFetch(tokenLine.id);
              }}
            >
              {state?.loading ? '拉取中…' : '拉取实时清单'}
            </Button>
          </span>
        </HoverTip>
      </div>

      {models.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {models.map((m) => (
            <HoverTip key={m.id} tip={[m.id, m.note].filter(Boolean).join(' · ')}>
              <Chip variant="caption" color={usedModels.has(m.id) ? 'purple' : 'neutral'}>
                {m.label}
                {usedModels.has(m.id) ? ' · 使用中' : ''}
              </Chip>
            </HoverTip>
          ))}
        </div>
      )}

      {models.length === 0 && !remote && (
        <p className="mt-2 text-xs text-text-tertiary">
          没有内置预设模型；配置线路后可用令牌拉取厂商真实清单。
        </p>
      )}

      {state?.error && (
        <Notice tone="danger" title={state.error} className="mb-0 mt-2" />
      )}

      {state?.result && (
        <Notice
          tone={remote && remote.length > 0 ? 'success' : 'warn'}
          title={state.result.message}
          className="mb-0 mt-2"
        >
          {remote && remote.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {remote.slice(0, 80).map((id) => (
                <HoverTip key={id} tip={usedModels.has(id) ? '已有线路在使用' : undefined}>
                  <Chip variant="caption" color={usedModels.has(id) ? 'purple' : 'neutral'}>
                    {id}
                  </Chip>
                </HoverTip>
              ))}
              {remote.length > 80 && (
                <span className="text-text-tertiary">共 {remote.length} 个，仅展示前 80 个</span>
              )}
            </div>
          )}
          {state.result.usedStoredToken && (
            <div className="mt-1">使用该线路已保存的访问令牌请求厂商接口。</div>
          )}
          {!remote && state.result.endpoints.length > 0 && (
            <div className="mt-1">尝试过的端点：{state.result.endpoints.join('、')}</div>
          )}
        </Notice>
      )}
    </div>
  );
}
