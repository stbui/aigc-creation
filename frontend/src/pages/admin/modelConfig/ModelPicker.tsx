import { useEffect, useMemo, useRef, useState } from 'react';
import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { Download } from 'lucide-react';
import { adminModelChannelsApi } from '../../../lib/api';
import { Notice } from '../../../admin-ui/primitives';
import { HoverTip, TextInput } from '../../../admin-ui/controls';
import type { AdminModelListResult, Modality } from '../../../types/api';

export interface PresetModel {
  id: string;
  label: string;
  note?: string;
}

interface ModelOption {
  value: string;
  label: string;
  note?: string;
  source: 'preset' | 'remote' | 'custom';
}

/**
 * 默认模型选择器。
 *
 * ## 解决什么问题 (2026-10-21)
 *
 * 旧版是一个 AutoComplete: 下拉只在**输入时**出现, 且按当前值过滤 ——
 * 已填了模型名之后再点开, 只剩它自己。运营既看不到「这家厂商还有哪些模型」,
 * 也不知道该手填什么, 只能去翻厂商控制台或抄旧文档, 抄错的表现是
 * 「连通测试通过、生成永远 404」。
 *
 * 现在把三层来源都摆出来:
 *   1. 内置预设 —— vendor.catalog.ts 收录的模型, 带中文说明, 离线可用;
 *   2. 厂商实时清单 —— 用当前线路令牌向厂商模型列表接口拉取, 可选;
 *   3. 自定义 —— 输入清单里没有的名字, 末项会出现「使用这个自定义模型名」。
 *
 * ⚠️ 拉取需要「通道测试」权限, 且会把令牌发给厂商 —— 与草稿测试同一档权限。
 *
 * ## 为什么不是下拉框
 *
 * BoardUI 免费层没有可搜索的 Select（vendor 的 `Select` 是单选菜单，没有
 * 自由输入）。而这个字段必须允许「清单里没有的模型名直接手填」——
 * 那是运营换新模型最常见的动作，做成下拉就只能选不能填。
 * 故这里用「可输入的文本框 + 常驻候选列表」：输入即筛选，候选随时可见。
 */
export function ModelPicker({
  modality,
  value,
  presetModels,
  protocol,
  baseUrl,
  channelId,
  hasStoredToken,
  draftToken,
  clearToken,
  canWrite,
  canTest,
  onChange,
}: {
  modality: Modality;
  value: string;
  presetModels: PresetModel[];
  protocol: string;
  baseUrl: string;
  channelId?: string;
  /** 已保存线路是否带令牌（编辑态才有意义） */
  hasStoredToken: boolean;
  /** 表单里尚未保存的令牌；空串 = 未输入 */
  draftToken: string;
  clearToken: boolean;
  canWrite: boolean;
  canTest: boolean;
  onChange: (value: string) => void;
}) {
  const [remote, setRemote] = useState<AdminModelListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  /**
   * 配置一变，已拉的清单就不再对应该配置 —— 直接清掉，
   * 避免运营拿着上一个厂商的模型名往新地址里填。
   */
  const fetchKey = `${protocol}|${baseUrl}|${draftToken}|${clearToken}`;
  /** 请求返回时配置可能已经变了 —— 只用最新配置对应的结果 */
  const keyRef = useRef(fetchKey);
  useEffect(() => {
    keyRef.current = fetchKey;
    setRemote(null);
    setError(null);
  }, [fetchKey]);

  const remoteIds = remote?.remote ?? [];

  const options = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const out: ModelOption[] = [];
    for (const m of presetModels) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ value: m.id, label: m.label, note: m.note, source: 'preset' });
    }
    for (const id of remoteIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ value: id, label: id, note: '厂商模型列表返回', source: 'remote' });
    }
    // 已保存的自定义模型名不在任何清单里时，也要能在列表里显示出来
    if (value && !seen.has(value)) {
      out.push({ value, label: value, note: '当前手填（不在预设/实时清单中）', source: 'custom' });
    }
    // 搜索词不在清单中 → 末项提供「使用自定义模型」
    if (search && !out.some((o) => o.value === search)) {
      out.push({ value: search, label: search, note: '使用这个自定义模型名', source: 'custom' });
    }
    return out;
  }, [presetModels, remoteIds, value, search]);

  /** 候选列表按当前搜索词过滤；搜索为空时展示全部 */
  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, search]);

  const fetchModels = async () => {
    const key = fetchKey;
    setLoading(true);
    setError(null);
    try {
      const result = await adminModelChannelsApi.listModels({
        modality,
        protocol,
        baseUrl,
        ...(channelId ? { id: channelId } : {}),
        // undefined = 复用已保存令牌；'' = 明确不带令牌
        token: clearToken ? '' : draftToken || undefined,
      });
      if (keyRef.current === key) setRemote(result);
    } catch (e) {
      if (keyRef.current === key) setError((e as Error).message || '拉取失败');
    } finally {
      setLoading(false);
    }
  };

  /** 有可用令牌才请求厂商接口：草稿里新填的，或已保存线路上的 */
  const tokenAvailable = Boolean(draftToken) || (hasStoredToken && !clearToken);
  const fetchDisabledReason = !canTest
    ? '当前角色没有「通道测试」权限'
    : !baseUrl.trim()
      ? '请先填写接入地址'
      : !tokenAvailable
        ? '请先填写访问令牌，或先保存线路后再拉取'
        : undefined;

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        value={search}
        onChange={setSearch}
        disabled={!canWrite}
        placeholder="输入模型名筛选，或直接手填清单里没有的模型"
        ariaLabel="默认模型"
      />

      {/* 当前生效的模型名常驻显示 —— 输入框只是筛选器，真正生效的值在这里 */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-text-tertiary">当前模型</span>
        {value ? (
          <code className="rounded bg-background-secondary-default px-1.5 py-0.5 font-mono text-text-primary">
            {value}
          </code>
        ) : (
          <span className="text-text-tertiary">留空则使用协议默认模型</span>
        )}
      </div>

      <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border-table">
        {visibleOptions.length === 0 ? (
          <p className="px-3 py-3 text-xs text-text-tertiary">
            没有匹配的模型；直接输入完整模型名即可使用
          </p>
        ) : (
          <ul className="flex flex-col">
            {visibleOptions.map((option) => {
              const active = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => {
                      setSearch('');
                      onChange(option.value);
                    }}
                    className={
                      active
                        ? 'flex w-full flex-col gap-0.5 bg-accent-50 px-3 py-2 text-left'
                        : 'flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-background-secondary-default disabled:cursor-not-allowed'
                    }
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-text-primary">{option.label}</span>
                      {option.source === 'remote' && (
                        <Chip variant="caption" color="lime">
                          实时
                        </Chip>
                      )}
                      {option.source === 'custom' && (
                        <Chip variant="caption" color="yellow">
                          自定义
                        </Chip>
                      )}
                      {active && (
                        <Chip variant="caption" color="purple">
                          使用中
                        </Chip>
                      )}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {option.value}
                      {option.note ? ` · ${option.note}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-tertiary">
          内置预设 {presetModels.length} 个
          {remote ? ` · 厂商返回 ${remote.remote?.length ?? 0} 个` : ' · 可向厂商拉取实时清单'}
        </span>
        <HoverTip tip={fetchDisabledReason}>
          <span>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={Boolean(fetchDisabledReason) || loading}
              onClick={() => void fetchModels()}
            >
              {loading ? '拉取中…' : '从厂商拉取模型清单'}
            </Button>
          </span>
        </HoverTip>
      </div>

      {presetModels.length === 0 && !remote && (
        <p className="text-xs text-text-tertiary">
          当前厂商/协议没有内置预设。可直接手填模型名，或点「从厂商拉取模型清单」获取真实列表。
        </p>
      )}

      {remote && (
        <Notice
          tone={remote.remote && remote.remote.length > 0 ? 'success' : 'warn'}
          title={remote.message}
          className="mb-0"
        >
          {remote.remote && remote.remote.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {remote.remote.slice(0, 60).map((id) => (
                <HoverTip key={id} tip={id}>
                  <Chip variant="caption" color={value === id ? 'purple' : 'neutral'}>
                    {id}
                  </Chip>
                </HoverTip>
              ))}
              {remote.remote.length > 60 && (
                <span className="text-text-tertiary">
                  共 {remote.remote.length} 个，上方列表可搜索全部
                </span>
              )}
            </div>
          )}
          {remote.usedStoredToken && (
            <div className="mt-1">使用已保存的访问令牌请求厂商接口。</div>
          )}
          {!remote.remote && remote.endpoints.length > 0 && (
            <div className="mt-1">尝试过的端点：{remote.endpoints.join('、')}</div>
          )}
        </Notice>
      )}

      {error && <Notice tone="danger" title={error} className="mb-0" />}
    </div>
  );
}
