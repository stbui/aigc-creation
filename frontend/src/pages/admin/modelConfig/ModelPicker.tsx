import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Flex, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { Download } from 'lucide-react';
import { adminModelChannelsApi } from '../../../lib/api';
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
  /** antd 的 option 类型带索引签名，这里补一份以保持可赋值 */
  [name: string]: unknown;
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
 *   3. 自定义 —— 输入清单里没有的名字, 下拉末尾会出现「使用 ...」选项。
 *
 * ⚠️ 拉取需要「通道测试」权限, 且会把令牌发给厂商 —— 与草稿测试同一档权限。
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
    // 已保存的自定义模型名不在任何清单里时，也要能在下拉里显示出来
    if (value && !seen.has(value)) {
      out.push({ value, label: value, note: '当前手填（不在预设/实时清单中）', source: 'custom' });
    }
    // 搜索词不在清单中 → 末项提供「使用自定义模型」
    if (search && !out.some((o) => o.value === search)) {
      out.push({ value: search, label: search, note: '使用这个自定义模型名', source: 'custom' });
    }
    return out;
  }, [presetModels, remoteIds, value, search]);

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
    <Flex vertical gap={8}>
      <Select<string>
        id="mc-model"
        allowClear
        disabled={!canWrite}
        value={value || undefined}
        placeholder="留空则使用协议默认模型；输入模型名可筛选或选用自定义名"
        options={options}
        showSearch={{
          onSearch: setSearch,
          filterOption: (input, option) => {
            const q = input.trim().toLowerCase();
            if (!q) return true;
            if (!option) return false;
            const o = option as unknown as ModelOption;
            return o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q);
          },
        }}
        onChange={(v) => {
          setSearch('');
          onChange(v ?? '');
        }}
        notFoundContent={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            没有匹配的模型；直接输入完整模型名即可使用
          </Typography.Text>
        }
        optionRender={(option) => {
          const o = option.data as ModelOption;
          return (
            <Flex vertical gap={2} style={{ padding: '2px 0' }}>
              <Space size={6} wrap>
                <Typography.Text>{o.label}</Typography.Text>
                {o.source === 'remote' && (
                  <Tag color="success" variant="filled" style={{ marginInlineEnd: 0 }}>
                    实时
                  </Tag>
                )}
                {o.source === 'custom' && (
                  <Tag color="warning" variant="filled" style={{ marginInlineEnd: 0 }}>
                    自定义
                  </Tag>
                )}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {o.value}
                {o.note ? ` · ${o.note}` : ''}
              </Typography.Text>
            </Flex>
          );
        }}
      />

      <Flex justify="space-between" align="center" gap={8} wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          内置预设 {presetModels.length} 个
          {remote
            ? ` · 厂商返回 ${remote.remote?.length ?? 0} 个`
            : ' · 可向厂商拉取实时清单'}
        </Typography.Text>
        <Tooltip title={fetchDisabledReason}>
          <span>
            <Button
              size="small"
              icon={<Download size={13} />}
              loading={loading}
              disabled={Boolean(fetchDisabledReason)}
              onClick={() => void fetchModels()}
            >
              从厂商拉取模型清单
            </Button>
          </span>
        </Tooltip>
      </Flex>

      {presetModels.length > 0 && (
        <Flex vertical gap={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            内置预设（点击选用）：
          </Typography.Text>
          <Space size={[6, 6]} wrap>
            {presetModels.map((m) => (
              <Tooltip key={m.id} title={m.note ? `${m.id} · ${m.note}` : m.id}>
                <Tag
                  color={value === m.id ? 'purple' : undefined}
                  variant={value === m.id ? 'filled' : 'outlined'}
                  style={{ cursor: canWrite ? 'pointer' : 'default', marginInlineEnd: 0 }}
                  onClick={() => {
                    if (canWrite) onChange(m.id);
                  }}
                >
                  {m.label}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </Flex>
      )}

      {presetModels.length === 0 && !remote && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          当前厂商/协议没有内置预设。可直接手填模型名，或点「从厂商拉取模型清单」获取真实列表。
        </Typography.Text>
      )}

      {remote && (
        <Alert
          type={remote.remote && remote.remote.length > 0 ? 'success' : 'warning'}
          showIcon
          title={remote.message}
          description={
            <Flex vertical gap={4}>
              {remote.remote && remote.remote.length > 0 && (
                <Space size={[6, 6]} wrap>
                  {remote.remote.slice(0, 60).map((id) => (
                    <Tag
                      key={id}
                      color={value === id ? 'purple' : undefined}
                      variant={value === id ? 'filled' : 'outlined'}
                      style={{ cursor: canWrite ? 'pointer' : 'default', marginInlineEnd: 0 }}
                      onClick={() => {
                        if (canWrite) onChange(id);
                      }}
                    >
                      {id}
                    </Tag>
                  ))}
                  {remote.remote.length > 60 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      共 {remote.remote.length} 个，下拉里可搜索全部
                    </Typography.Text>
                  )}
                </Space>
              )}
              {remote.usedStoredToken && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  使用已保存的访问令牌请求厂商接口。
                </Typography.Text>
              )}
              {!remote.remote && remote.endpoints.length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  尝试过的端点：{remote.endpoints.join('、')}
                </Typography.Text>
              )}
            </Flex>
          }
          style={{ marginTop: 4 }}
        />
      )}

      {error && <Alert type="error" showIcon title={error} />}
    </Flex>
  );
}
