import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Input, InputNumber, Select, Switch, Tooltip } from 'antd';
import { adminModelApi } from '../../lib/api';
import { AdminListError, AdminListLoading } from '../../components/admin/AdminWidgets';
import {
  ConfirmAction,
} from '../../components/admin/AdminWidgets';
import { CollapsiblePanel, PageHeader, Panel } from '../../components/admin/PageHeader';
import { ChannelCard, MODALITY_LABEL, channelStateMeta, routeStateMeta } from '../../components/admin/ChannelOverviewCards';
import { useAdmin } from '../../context/AdminContext';
import type { AdminModelConfig, AdminModelConfigItem, Modality } from '../../types/api';

/**
 * 模型通道配置。
 *
 * 页面要解决的核心问题不是「改几个输入框」, 而是**让运营看清每一项当前到底被谁覆盖着**:
 *   - source=env  → 被部署环境变量覆盖, 后台改了不起作用 (最常见的困惑来源)
 *   - source=db   → 后台写入, 立即生效
 *   - source=default → 代码默认值
 * 所以每一项都带来源徽标, env 项的输入框直接禁用并说明原因 ——
 * 让运营「看得见改不动」, 而不是改了没反应再来问。
 *
 * 凭据项 (网关令牌) 遵循: 只写不回显。输入框始终为空, 提交留空 = 保持原值,
 * 清除需在保存时勾选显式清除。
 */

const SOURCE_META: Record<string, { label: string; tone: string; hint: string }> = {
  env: {
    label: '环境变量',
    tone: 'is-danger',
    hint: '该项被部署环境变量覆盖，后台修改不会生效。需改部署配置。',
  },
  db: { label: '后台已改', tone: 'is-success', hint: '当前使用后台写入的值，保存后立即生效。' },
  default: { label: '默认值', tone: 'is-muted', hint: '当前使用代码内置默认值。' },
};

const ROUTE_OPTIONS = [
  { value: 'auto', label: '自动（网关可用则远程）' },
  { value: 'local', label: '强制本地算法' },
  { value: 'remote', label: '强制远程' },
];

/** 尺寸写法 → 运营能看懂的说明（三家对「多大」的写法完全不同，配错直接被拒） */
const SIZE_STYLE_TEXT: Record<string, string> = {
  'openai-wh': '像素尺寸，如 1024x1024',
  'volc-tier': '档位（1K / 2K / 4K）',
  'ratio-only': '仅比例，分辨率由服务端决定',
};

/**
 * 分栏顺序 = 数据源顺序 (后端 MODALITIES)。
 *
 * 显式列出而不靠 map 生成的隐式顺序: 模态是有语义的一等维度,
 * 顺序变化会影响运营肌肉记忆, 故固定在这里并在注释里说明来源。
 */
const MODALITY_ORDER: Modality[] = ['image', 'text', 'video'];

export function AdminModelConfigPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const canWrite = can('model.config_write');

  const [data, setData] = useState<AdminModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});
  const [clears, setClears] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Modality | null>(null);
  const [testResult, setTestResult] = useState<
    Partial<Record<Modality, { ok: boolean; message: string; detail?: string }>>
  >({});
  /**
   * 批量测试进行中 (2026-10-20)。
   *
   * ⚠️ 与 `testing` 分开: `testing` 表示「正在测某个模态」(单模态按钮),
   * 这里是「正在测全部」。两者会同时存在 (批量测时各模态也在测),
   * 用一个 state 会互相覆盖。
   */
  const [testingAll, setTestingAll] = useState(false);
  /**
   * 「超时与轮询」面板的展开状态 (2026-10-20)。
   *
   * 这些是**低频**参数 (多数情况用默认值), 但排查轮询超时时又需要频繁调 ——
   * 故记住上次的状态, 不让运营每次都重新展开。
   */
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('admin.modelCfg.advancedOpen') === '1';
    } catch {
      return false;
    }
  });

  /** 批量测试的汇总 (一次看全) */
  const [testAllSummary, setTestAllSummary] = useState<{
    okCount: number;
    total: number;
    elapsedMs: number;
  } | null>(null);

  /** 当前查看的模态分栏 (2026-10-20 三模态) */
  const [activeModality, setActiveModality] = useState<Modality>('image');

  /**
   * 厂商下拉的当前值, **按模态分开**。
   *
   * 为什么不共用一个 state: 三家厂商互不相干 (DeepSeek 只服务文生文,
   * 优云智算只服务文生图), 共用一个值会导致切到别的模态时下拉里
   * 显示着另一模态的厂商, 运营会以为配串了。
   * null = 未选预设(手动自定义)。
   */
  const [vendorKeys, setVendorKeys] = useState<Record<Modality, string | null>>({
    text: null,
    image: null,
    video: null,
  });
  /** 协议下拉的当前值, 同样按模态分开 (协议名跨模态复用, 共用会串) */
  const [protocols, setProtocols] = useState<Record<Modality, string>>({
    text: 'openai-chat',
    image: 'openai',
    video: '',
  });
  /** 展开的厂商说明（默认展开当前协议下第一家，避免关键差异被忽略） */
  const [presetOpen, setPresetOpen] = useState(false);

  const channelOf = (m: Modality) => data?.channels?.[m] ?? null;
  const prefixOf = (m: Modality) => `gateway.${m}`;

  /** 当前模态通道的生效态标签 (三态, 见 ChannelOverviewCards.channelStateMeta) */
  const activeState = channelStateMeta(channelOf(activeModality));


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await adminModelApi.config();
      setData(d);
      // 用当前生效值初始化草稿; 凭据项不初始化 (拿不到明文, 保持空 = 不改)
      const init: Record<string, string | number | boolean> = {};
      for (const g of d.groups) {
        for (const it of g.items) {
          if (it.secret) continue;
          init[it.key] = it.value ?? it.default;
        }
      }
      setDraft(init);
      setClears({});

      /*
       * 厂商/协议选择回填: 存量配置也要能正确显示「当前用的是哪家」,
       * 否则下拉显示未选择, 运营会以为配错而重填一遍。
       *
       * 匹配依据是 baseUrl + protocol —— 模型名可能被手工改过, 不足以作为主键;
       * 且必须逐模态匹配, 因为基址相同的厂商在不同模态下是不同条目
       * (如硅基流动的图像预设与文本预设 baseUrl 相同、key 不同)。
       */
      const nextVendors: Record<Modality, string | null> = { text: null, image: null, video: null };
      const nextProtocols: Record<Modality, string> = { text: 'openai-chat', image: 'openai', video: '' };
      for (const m of MODALITY_ORDER) {
        const ch = d.channels?.[m];
        if (!ch) continue;
        nextProtocols[m] = ch.provider || '';
        const base = String(init[prefixOf(m) + '.baseUrl'] ?? '').replace(/\/+$/, '');
        const hit = (ch.vendors ?? []).find((v) => v.baseUrl.replace(/\/+$/, '') === base);
        nextVendors[m] = hit?.key ?? null;
      }
      setProtocols(nextProtocols);
      setVendorKeys(nextVendors);    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 只提交真正改过的项 —— 全量提交会把「没改」也写成 DB 覆盖, 污染来源标记 */
  const changed = useMemo(() => {
    if (!data) return [] as AdminModelConfigItem[];
    const out: AdminModelConfigItem[] = [];
    for (const g of data.groups) {
      for (const it of g.items) {
        if (it.secret) continue;
        const cur = draft[it.key];
        if (cur !== undefined && String(cur) !== String(it.value ?? it.default)) out.push(it);
      }
    }
    return out;
  }, [data, draft]);

  const clearKeys = useMemo(() => Object.keys(clears).filter((k) => clears[k]), [clears]);

  const dirty = changed.length > 0 || clearKeys.length > 0;

  /**
   * 某模态下的未保存变更数 (2026-10-20 通道总览卡片用)。
   *
   * 目的是让「改了就忘存」在**总览**上就能看见 —— 改造前要滚到页面底部
   * 才知道有未保存项, 而三模态并存时更容易漏看某一个。
   */
  const dirtyOfModality = (m: Modality) => {
    const p = prefixOf(m);
    const n = changed.filter((c) => c.key.startsWith(`${p}.`)).length;
    return n + clearKeys.filter((k) => k.startsWith(`${p}.`)).length;
  };

  const submit = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const settings: Record<string, unknown> = {};
      for (const it of changed) settings[it.key] = draft[it.key];
      await adminModelApi.updateConfig(settings, clearKeys, reason.trim() || undefined);
      void message.success(`已保存 ${changed.length + clearKeys.length} 项，立即生效`);
      setConfirmOpen(false);
      setReason('');
      await load();
    } catch (e) {
      void message.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /**
   * 选厂商 → 自动填「基址 + 协议 + 推荐模型」三项草稿。
   *
   * 五个刻意的设计:
   *   1. **只改草稿不直接保存** —— 仍走页面原有的「保存 → 二次确认 → 审计」链路。
   *      若这里直接调接口, 就绕过了既有的变更确认与操作原因记录。
   *   2. **不碰 token** —— 凭据只能手填; 换厂商通常需要换 key, 但不该由程序猜。
   *   3. **跨模态联动** —— 厂商聚合后, 同一家的图与文共享基址 (如硅基流动都是
   *      api.siliconflow.cn), 若只填当前模态, 运营得在每个模态里手填一遍同一个值。
   *      故取回厂商的填充方案, 一次填完所有该厂商支持的模态。
   *   4. 填完仍可手改 —— 下方原有输入框不受影响, 预设只是省掉手工对照文档。
   *   5. **token 仍按模态分开** —— 用户可能给图和文用不同的 key, 强行合并会覆盖
   *      合法配置。
   */
  const applyVendor = async (modality: Modality, key: string) => {
    const ch = channelOf(modality);
    const v = (ch?.vendors ?? []).find((x) => x.key === key);
    const p = prefixOf(modality);
    if (!v) {
      setVendorKeys((s) => ({ ...s, [modality]: null }));
      return;
    }
    setVendorKeys((s) => ({ ...s, [modality]: key }));
    setProtocols((s) => ({ ...s, [modality]: v.protocol }));
    setPresetOpen(true);

    /*
     * 跨模态联动: 取回厂商的填充方案, 把该厂商**所有**模态一次填好。
     *
     * ⚠️ 失败不阻断: 拿不到方案时至少把当前模态填上 (降级为单模态行为),
     * 而不是让点了厂商却什么都没发生 —— 那比慢一拍更难理解。
     */
    try {
      const plan = await adminModelApi.vendorFillPlan(v.vendorKey);
      setDraft((d) => {
        const next = { ...d };
        for (const f of plan.fills) {
          const fp = prefixOf(f.modality);
          next[`${fp}.vendor`] = f.vendorPresetKey;
          next[`${fp}.baseUrl`] = f.baseUrl;
          next[`${fp}.provider`] = f.provider;
          next[`${fp}.model`] = f.model;
        }
        return next;
      });
      // 联动填充的模态也要清掉「恢复默认」标记
      setClears((c) => {
        const next = { ...c };
        for (const f of plan.fills) {
          next[`${prefixOf(f.modality)}.baseUrl`] = false;
          next[`${prefixOf(f.modality)}.provider`] = false;
        }
        return next;
      });
      // 各模态的协议下拉状态同步更新
      setProtocols((s) => {
        const next = { ...s };
        for (const f of plan.fills) next[f.modality] = f.provider;
        return next;
      });
      setVendorKeys((s) => {
        const next = { ...s };
        for (const f of plan.fills) next[f.modality] = f.vendorPresetKey;
        return next;
      });
      if (plan.fills.length > 1) {
        void message.info(
          `已按「${plan.label}」联动填入 ${plan.fills.length} 个模态的基址与模型（令牌仍需分别填写）`,
        );
      }
    } catch (e) {
      // 降级: 至少填当前模态
      setDraft((d) => ({
        ...d,
        [`${p}.vendor`]: v.key,
        [`${p}.baseUrl`]: v.baseUrl,
        [`${p}.provider`]: v.protocol,
        [`${p}.model`]: v.models[0]?.id ?? '',
      }));
      setClears((c) => ({ ...c, [`${p}.baseUrl`]: false, [`${p}.provider`]: false }));
    }
  };

  /** 手动改协议时同步厂商标识（值与预设不符则清空，如实反映"自定义"） */
  const changeProtocol = (modality: Modality, protocol: string) => {
    const ch = channelOf(modality);
    const p = prefixOf(modality);
    setProtocols((s) => ({ ...s, [modality]: protocol }));
    const v = (ch?.vendors ?? []).find((x) => x.protocol === protocol);
    setVendorKeys((s) => ({ ...s, [modality]: v?.key ?? null }));
    setDraft((d) => ({ ...d, [`${p}.provider`]: protocol, [`${p}.vendor`]: v?.key ?? '' }));
  };

  /** 连通性测试按模态发起: 三种模态探测的是不同端点, 混用会得到无法区分真伪的结论 */
  const runTest = async (modality: Modality) => {
    setTesting(modality);
    setTestResult((s) => ({ ...s, [modality]: undefined }));
    try {
      const r = await adminModelApi.testConfig(modality);
      setTestResult((s) => ({ ...s, [modality]: { ok: r.ok, message: r.message, detail: r.detail } }));
    } catch (e) {
      setTestResult((s) => ({
        ...s,
        [modality]: { ok: false, message: (e as Error).message || '测试失败' },
      }));
    } finally {
      setTesting(null);
    }
  };

  /**
   * 批量测试所有通道 (2026-10-20, 抄 New API 的 "Test All Channels")。
   *
   * 为什么需要: 三个模态各有独立通道, 逐个点「测试」慢且容易漏;
   * 而「忘了配某个通道」在页面上是**看不出来的** —— 视频/文本未接入
   * 意味着调用必然失败, 但界面不会主动提醒。
   *
   * 批量结果**同时落到各模态** (setTestResult), 于是通道卡片上能直接
   * 看到每个模态的测试结论, 不必再逐个点开看。
   */
  const runTestAll = async () => {
    setTestingAll(true);
    setTestAllSummary(null);
    try {
      const r = await adminModelApi.testAllChannels();
      setTestResult((s) => ({ ...s, ...r.results }));
      setTestAllSummary({ okCount: r.okCount, total: r.total, elapsedMs: r.elapsedMs });
      if (r.okCount === r.total) {
        void message.success(`全部 ${r.total} 个通道连通正常（${r.elapsedMs}ms）`);
      } else {
        void message.warning(
          `${r.okCount}/${r.total} 个通道通过 —— 失败项见各通道卡片`,
        );
      }
    } catch (e) {
      void message.error(`批量测试失败：${(e as Error).message}`);
    } finally {
      setTestingAll(false);
    }
  };

  const renderItem = (it: AdminModelConfigItem) => {
    const meta = SOURCE_META[it.source] ?? SOURCE_META.default;
    const locked = it.source === 'env';
    const value = draft[it.key];

    return (
      <div className="adm-cfg-row" key={it.key}>
        <div className="adm-cfg-label">
          <div className="adm-cfg-label-top">
            <span className="adm-cfg-name">{it.label}</span>
            <Tooltip title={meta.hint}>
              <span className={`adm-tag ${meta.tone}`}>{meta.label}</span>
            </Tooltip>
            {it.overridden && !locked && (
              <Tooltip title="该项已被后台改过，可清除以恢复默认值">
                <button
                  type="button"
                  className="adm-link adm-link-sm"
                  disabled={!canWrite}
                  onClick={() => setClears((c) => ({ ...c, [it.key]: !c[it.key] }))}
                >
                  {clears[it.key] ? '取消清除' : '恢复默认'}
                </button>
              </Tooltip>
            )}
          </div>
          <div className="adm-cfg-desc">{it.description}</div>
          {/*
            存量键提示: 该项读的是改造前的旧单前缀键（如 gateway.baseUrl）。
            不提示的话, 运营改新键却看不到变化, 会认定功能坏了 —— 而实际上
            优先级是新键优先, 只要新键有值就会切过去。
          */}
          {it.legacyKey && (
            <code className="adm-cfg-env">
              兼容存量键 {it.legacyKey}：新键无取值时回落读取
            </code>
          )}
          {it.envName && (
            <code className="adm-cfg-env">
              {locked ? `被 ${it.envName} 覆盖` : `可用 ${it.envName} 覆盖`}
            </code>
          )}
        </div>

        <div className="adm-cfg-control">
          {clears[it.key] ? (
            <span className="adm-cfg-cleared">保存后恢复为默认值「{String(it.default)}」</span>
          ) : it.type === 'boolean' ? (
            <Switch
              checked={Boolean(value)}
              disabled={locked || !canWrite}
              onChange={(v) => setDraft((d) => ({ ...d, [it.key]: v }))}
            />
          ) : it.key.startsWith('gateway.route.') ? (
            <Select
              className="adm-cfg-select"
              value={String(value ?? 'auto')}
              options={ROUTE_OPTIONS}
              disabled={locked || !canWrite}
              onChange={(v) => setDraft((d) => ({ ...d, [it.key]: v }))}
            />
          ) : it.type === 'number' ? (
            <InputNumber
              className="adm-cfg-number"
              value={Number(value ?? 0)}
              disabled={locked || !canWrite}
              onChange={(v) => setDraft((d) => ({ ...d, [it.key]: Number(v ?? 0) }))}
            />
          ) : it.type === 'secret' ? (
            <div className="adm-cfg-secret">
              <Input.Password
                className="adm-cfg-input"
                placeholder={it.hasValue ? `已配置（${it.masked ?? '***'}），留空保持不变` : '尚未配置'}
                disabled={!canWrite || it.source === 'env'}
                autoComplete="new-password"
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) => ({ ...d, [it.key]: v }));
                  // 一旦输入就取消清除标记, 否则两个语义会打架
                  if (v) setClears((c) => ({ ...c, [it.key]: false }));
                }}
              />
              {it.source === 'env' ? (
                <Tooltip title="该项被部署环境变量覆盖，后台无法修改">
                  <span className="adm-tag is-danger">环境变量</span>
                </Tooltip>
              ) : it.hasValue ? (
                <span className="adm-tag is-success">已配置</span>
              ) : (
                <span className="adm-tag is-muted">未配置</span>
              )}
            </div>
          ) : (
            <Input
              className="adm-cfg-input"
              value={String(value ?? '')}
              disabled={locked || !canWrite}
              placeholder={String(it.default)}
              onChange={(e) => setDraft((d) => ({ ...d, [it.key]: e.target.value }))}
            />
          )}
        </div>
      </div>
    );
  };

  if (loading && !data) return <AdminListLoading tip="加载模型配置…" />;
  if (error) return <AdminListError error={error} onRetry={() => void load()} />;
  if (!data) return null;

  const ch = channelOf(activeModality);
  const activeTest = testResult[activeModality];

  return (
    <>
      <PageHeader
        title="模型配置"
        description="按模态分别配置真实模型网关的接入参数与逐能力路由。保存后立即生效，无需重启。"
        actions={
          <div className="adm-page-actions">
            <button
              type="button"
              className="adm-btn"
              onClick={() => void runTest(activeModality)}
              disabled={testing !== null || testingAll}
            >
              {testing === activeModality
                ? '测试中…'
                : `测试${ch?.label ?? ''}连通性`}
            </button>
            {/*
              批量测试 (2026-10-20): 三个模态各有独立通道, 逐个点既慢又易漏;
              而「忘了配某个通道」在界面上看不出来 (视频/文本无兜底, 未接入 = 必失败)。
              结果直接落在各通道卡片上。
            */}
            <button
              type="button"
              className="adm-btn"
              onClick={() => void runTestAll()}
              disabled={testingAll || testing !== null}
            >
              {testingAll ? '测试全部中…' : '测试全部通道'}
            </button>
            <button
              type="button"
              className="adm-btn is-primary"
              disabled={!canWrite || !dirty}
              onClick={() => setConfirmOpen(true)}
            >
              保存{dirty ? `（${changed.length + clearKeys.length} 项变更）` : ''}
            </button>
          </div>
        }
      />

      {!canWrite && (
        <div className="adm-notice">
          你当前的角色只有查看权限。模型配置属生产关键路径，写权限仅授予管理员。
        </div>
      )}

      {/*
        通道总览 (2026-10-20 重设计): 三模态并排, 一屏看清。
        设计动因: 改造前用 Segmented 切换, 页面上永远只看得见一个模态 ——
        于是「文生图配好了 / 视频根本没配」这件事在界面上完全看不出来,
        而视频没有本地兜底, 没配就是**必然失败**, 恰恰是最该被一眼看见的事。
      */}
      <div className="adm-chgrid">
        {MODALITY_ORDER.map((m) => (
          <ChannelCard
            key={m}
            channel={channelOf(m)}
            active={m === activeModality}
            dirtyCount={dirtyOfModality(m)}
            test={testResult[m]}
            onOpen={() => setActiveModality(m)}
          />
        ))}
      </div>

      {/* 批量测试的汇总 —— 一眼看全三个通道的结论 */}
      {testAllSummary && (
        <div
          className={`adm-cfg-test ${testAllSummary.okCount === testAllSummary.total ? 'is-ok' : 'is-fail'}`}
        >
          <strong>
            {testAllSummary.okCount === testAllSummary.total
              ? `全部 ${testAllSummary.total} 个通道通过`
              : `${testAllSummary.okCount}/${testAllSummary.total} 个通道通过`}
          </strong>
          <span>并发测试耗时 {testAllSummary.elapsedMs}ms</span>
        </div>
      )}

      {/* 只展示当前模态的通道状态 —— 三模态摘要已由上面的卡片承担 */}
      <Panel title={`${ch?.label ?? ''}通道详情`} note={ch?.desc}>
        <div className="adm-cfg-status">
          <span className={`adm-tag ${activeState.tone}`}>{activeState.label}</span>
          {/*
            「配了但协议未接入」必须显式警告。配了却必然失败是最容易被忽略的坑:
            界面看着配好了, 实际每次生成都失败。
          */}
          {ch?.configuredButUnsupported && (
            <span className="adm-tag is-danger">
              协议「{ch.provider}」在本模态下尚未接入，生成时必然失败
            </span>
          )}
          <dl className="adm-cfg-status-list">
            <div>
              <dt>网关基址</dt>
              <dd>{ch?.baseUrl || <span className="adm-cell-sub">未配置</span>}</dd>
            </div>
            <div>
              <dt>当前厂商</dt>
              <dd>
                {ch?.vendorLabel || (
                  <span className="adm-cell-sub">未选预设（下方按字段手填）</span>
                )}
              </dd>
            </div>
            <div>
              <dt>默认模型</dt>
              <dd>{ch?.model || <span className="adm-cell-sub">由厂商预设决定</span>}</dd>
            </div>
            <div>
              <dt>超时 / 轮询</dt>
              <dd>
                {ch?.timeoutMs}ms · 每 {ch?.pollMs}ms × {ch?.maxPolls} 次
              </dd>
            </div>
            <div>
              <dt>素材基址</dt>
              <dd>
                <code>{ch?.assetBase}</code>
              </dd>
            </div>
          </dl>
        </div>

        {activeTest && (
          <div className={`adm-cfg-test ${activeTest.ok ? 'is-ok' : 'is-fail'}`}>
            <strong>{activeTest.ok ? '连通正常' : '连通失败'}</strong>
            <span>{activeTest.message}</span>
            {activeTest.detail && <code>{activeTest.detail}</code>}
          </div>
        )}
      </Panel>

      {/* 厂商选择: 放最上面, 因为换厂商时最容易错的就是「基址/协议/模型」三项的组合 */}
      <Panel
        title={`${ch?.label ?? ''}厂商预设`}
        note="选择厂商后自动填写基址、协议与推荐模型；令牌仍需手填。下方所有字段均可再手动微调。"
      >
        {/*
          空协议下拉 = 该模态尚未取证任何一家端点。此时明确说明原因,
          而不是渲染一个空下拉 —— 空控件会被误认为「加载失败」或「我漏了什么」。
        */}
        {(ch?.protocolOptions ?? []).length === 0 ? (
          <div className="adm-notice">
            本模态尚未接入任何协议。配置项已就位，但生成时不会调用任何远端服务 ——
            待任一家视频端点完成实测取证后再开放。
          </div>
        ) : (
          <>
            <div className="adm-vendor-picker">
              <div className="adm-vendor-field">
                <label className="adm-cfg-label" htmlFor="adm-vendor-select">
                  <span className="adm-cfg-name">{ch?.label}模型厂商</span>
                </label>
                <Select
                  id="adm-vendor-select"
                  className="adm-vendor-select"
                  value={vendorKeys[activeModality] ?? '__custom__'}
                  disabled={!canWrite}
                  onChange={(v) =>
                    v === '__custom__'
                      ? (setVendorKeys((s) => ({ ...s, [activeModality]: null })),
                        setDraft((d) => ({ ...d, [`${prefixOf(activeModality)}.vendor`]: '' })))
                      : applyVendor(activeModality, v)
                  }
                  options={[
                    ...(ch?.vendors ?? []).map((v) => ({
                      value: v.key,
                      label: v.label,
                    })),
                    { value: '__custom__', label: '自定义（手动填写）' },
                  ]}
                />
              </div>

              <div className="adm-vendor-field">
                <label className="adm-cfg-label" htmlFor="adm-protocol-select">
                  <span className="adm-cfg-name">通道协议</span>
                </label>
                <Select
                  id="adm-protocol-select"
                  className="adm-vendor-select"
                  value={protocols[activeModality]}
                  disabled={!canWrite}
                  onChange={(v) => changeProtocol(activeModality, v)}
                  options={(ch?.protocolOptions ?? []).map((o) => ({
                    value: o.value,
                    label: o.label,
                    title: o.desc,
                  }))}
                />
              </div>
            </div>

            {/* 协议说明: 各家请求形状不同, 配错的表现是静默失败, 必须让运营看见 */}
            {(ch?.protocolOptions ?? [])
              .filter((o) => o.value === protocols[activeModality])
              .map((o) => (
                <p key={o.value} className="adm-vendor-desc">
                  {o.desc}
                  {!ch?.protocolKnown && protocols[activeModality] === ch?.provider && (
                    <strong style={{ color: 'var(--danger-text)' }}>
                      {' '}
                      · 该协议在本模态下尚未实现，生成时会直接失败并回落
                    </strong>
                  )}
                </p>
              ))}
          </>
        )}

        {(() => {
          const v = (ch?.vendors ?? []).find((x) => x.key === vendorKeys[activeModality]);
          if (!v) return null;
          const modelKey = `${prefixOf(activeModality)}.model`;
          return (
            <div className="adm-vendor-card">
              <div className="adm-vendor-card-head">
                <strong>{v.label}</strong>
                <button type="button" className="adm-link adm-link-sm" onClick={() => setPresetOpen((o) => !o)}>
                  {presetOpen ? '收起说明' : '展开说明'}
                </button>
              </div>
              {/*
                尺寸/参考图标签只在生图模态有意义 —— 文生文没有 size 也没有参考图,
                渲染出来会是空白 tag, 运营会以为该厂商不支持这些参数。
              */}
              <div className="adm-vendor-tags">
                {v.sizeStyle && (
                  <span className="adm-tag is-muted">{SIZE_STYLE_TEXT[v.sizeStyle] ?? v.sizeStyle}</span>
                )}
                {typeof v.maxRefImages === 'number' && (
                  <span className="adm-tag is-muted">参考图最多 {v.maxRefImages} 张</span>
                )}
                {v.refStyle && (
                  <span className="adm-tag is-muted">
                    参考图走 {v.refStyle === 'base64' ? 'base64' : '公网 URL'}
                  </span>
                )}
              </div>
              {presetOpen && (
                <>
                  {v.note && <p className="adm-vendor-desc">{v.note}</p>}
                  <div className="adm-vendor-models">
                    <span className="adm-cfg-desc">可选模型：</span>
                    {v.models.map((m) => {
                      const active = String(draft[modelKey] ?? '') === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`adm-vendor-model${active ? ' is-active' : ''}`}
                          disabled={!canWrite}
                          title={m.note}
                          onClick={() => setDraft((d) => ({ ...d, [modelKey]: m.id }))}
                        >
                          {m.label}
                          {m.note ? <em>{m.note}</em> : null}
                        </button>
                      );
                    })}
                  </div>
                  <a className="adm-link adm-link-sm" href={v.consoleUrl} target="_blank" rel="noreferrer">
                    前往 {v.label} 控制台获取 API Key →
                  </a>
                </>
              )}
            </div>
          );
        })()}
      </Panel>

      {/*
        配置分组按模态过滤:
          base/timeout → 只显示当前模态的项 (跨模态显示会让人误以为改一处能同时生效)
          asset       → 跨模态共用, 每次都显示
          route       → 逐能力路由, 与模态无关 (能力 id 全局唯一), 每次都显示
      */}
      {data.groups.map((g) => {
        const items =
          g.key === 'base' || g.key === 'timeout'
            ? g.items.filter((it) => it.modality === activeModality)
            : g.items;
        if (items.length === 0) return null;

        /*
         * 「超时与轮询」默认折叠 (2026-10-20, 抄 New API)。
         *
         * 它们是低频参数 (多数情况用默认值), 但与必填项同权重平铺时
         * 会把必填项淹没 —— 9 个数字输入框对「运营只想填个基址」的场景是噪声。
         *
         * 折叠时给出摘要, 让运营知道「里面还有 3 项, 且都没改过」,
         * 而不是以为这个面板不存在。
         */
        if (g.key === 'timeout') {
          const overridden = items.filter((it) => it.overridden).length;
          return (
            <CollapsiblePanel
              key={g.key}
              title={g.label}
              note={g.desc}
              open={advancedOpen}
              onToggle={(next) => {
                setAdvancedOpen(next);
                try {
                  localStorage.setItem('admin.modelCfg.advancedOpen', next ? '1' : '0');
                } catch {
                  // 隐私模式下 localStorage 不可用 → 忽略, 不影响功能
                }
              }}
              collapsedHint={
                <span className="adm-tag is-muted">
                  {items.length} 项{overridden > 0 ? ` · ${overridden} 项已改` : ' · 全部默认值'}
                </span>
              }
            >
              <div className="adm-cfg-list">{items.map(renderItem)}</div>
            </CollapsiblePanel>
          );
        }

        return (
          <Panel key={g.key} title={g.label} note={g.desc}>
            <div className="adm-cfg-list">{items.map(renderItem)}</div>
          </Panel>
        );
      })}

      {/*
        逐能力路由总览 (2026-10-20 重设计): **按模态分组**而非平铺 16 张卡。
        动因: 平铺时运营看不出「哪些能力没兜底」—— 而图像能力失败会回落本地
        (体验降级), 文本/视频能力失败是**直接报错**。两类混在一起平铺,
        那个最重要的区别就看不见了。
      */}
      <Panel
        title="逐能力路由总览"
        note="路由按能力 id 全局唯一。图像能力失败会回落本地算法；文本与视频没有本地兜底，未接入时直接失败。"
      >
        {MODALITY_ORDER.map((m) => {
          const rows = data.routes.filter((r) => r.modality === m);
          if (rows.length === 0) return null;
          const noneCount = rows.filter((r) => r.effective === 'none').length;
          return (
            <div key={m} className="adm-route-group">
              <div className="adm-route-group-head">
                <span className="adm-route-group-name">{MODALITY_LABEL[m]}</span>
                <span className="adm-cell-sub">{rows.length} 项能力</span>
                {/* ⚠️ 「无兜底」是本页最需要被看见的状态, 单独计数并前置 */}
                {noneCount > 0 && (
                  <span className="adm-tag is-danger">{noneCount} 项无兜底 · 调用会失败</span>
                )}
              </div>
              <div className="adm-route-grid">
                {rows.map((r) => {
                  const st = routeStateMeta(r);
                  return (
                    <div key={r.capability} className="adm-route-item">
                      <div className="adm-route-name">{r.name}</div>
                      <code className="adm-route-cap">{r.capability}</code>
                      <div className="adm-route-tags">
                        <span className="adm-tag is-muted">{r.route}</span>
                        <span className={`adm-tag ${st.tone}`}>{st.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Panel>

      {/* ConfirmAction 的遮罩是无条件渲染的 (open 只影响按钮态),
          必须像 AdminAssetsPage/AdminBackupPage 那样用条件渲染包裹,
          否则遮罩会常驻并拦截整页点击 */}
      {confirmOpen && (
        <ConfirmAction
          open
          title="确认保存模型配置"
          description={
            <>
              配置保存后<strong>立即生效</strong>，无需重启。错误的网关地址会让生图静默回落到本地算法。
              {changed.some((c) => c.key.startsWith('gateway.route.')) && (
                <div style={{ marginTop: 8 }}>
                  涉及逐能力路由：会改变对应能力的实际产出通道。
                </div>
              )}
              {clearKeys.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  涉及恢复默认：{clearKeys.length} 项将回到代码默认值。
                </div>
              )}
            </>
          }
          impact={changed.map((c) => `${c.label}：${String(c.value ?? '')} → ${String(draft[c.key] ?? '')}`)}
          extra={
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="adm-cfg-reason"
                style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}
              >
                变更原因（建议填写，便于审计追溯）
              </label>
              <input
                id="adm-cfg-reason"
                className="adm-confirm-input"
                style={{ width: '100%' }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：接入图像模型网关"
                maxLength={200}
              />
            </div>
          }
          confirmText="确认保存"
          loading={saving}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void submit()}
        />
      )}
    </>
  );
}