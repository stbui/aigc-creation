import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { adminModelChannelsApi } from '../../../lib/api';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { useDiscardConfirm, useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import { Drawer } from '../../../admin-ui/primitives/Drawer';
import { FormField, Notice } from '../../../admin-ui/primitives';
import { CheckBox, SelectBox, SwitchBox, TextInput } from '../../../admin-ui/controls';
import type {
  AdminChannelTestResult,
  AdminModelChannelRecord,
  Modality,
  ProtocolOption,
  VendorPreset,
} from '../../../types/api';
import { InlineConfirm } from './InlineConfirm';
import { ModelPicker } from './ModelPicker';
import {
  fmtLatency,
  fmtTime,
  MODALITY_LABEL,
  PROTOCOL_HINT,
  vendorDisplayLabel,
} from './meta';

type Mode = 'create' | 'edit';

interface FormState {
  name: string;
  protocol: string;
  baseUrl: string;
  token: string;
  clearToken: boolean;
  model: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  name: '',
  protocol: '',
  baseUrl: '',
  token: '',
  clearToken: false,
  model: '',
  enabled: true,
};

/** 「自定义（手动填写）」在两个下拉里的哨兵值 */
const CUSTOM = '__custom__';

/**
 * 线路编辑抽屉。
 *
 * 令牌只写不回显：空 = 保持原值，只有显式「清除令牌」才清空；
 * 草稿测试不保存也能验证当前表单，字段一改旧结果立即标过期。
 */
export function ChannelEditDrawer({
  open,
  mode,
  modality,
  channel,
  vendors,
  protocolOptions,
  canWrite,
  canTest,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  modality: Modality;
  channel?: AdminModelChannelRecord | null;
  vendors: VendorPreset[];
  protocolOptions: ProtocolOption[];
  canWrite: boolean;
  canTest: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [formRev, setFormRev] = useState(0);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ rev: number; result: AdminChannelTestResult } | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: FormState =
      mode === 'edit' && channel
        ? {
            name: channel.name,
            protocol: channel.protocol,
            baseUrl: channel.baseUrl,
            token: '',
            clearToken: false,
            model: channel.model,
            enabled: channel.enabled,
          }
        : {
            ...EMPTY,
            protocol:
              protocolOptions.find(
                (o) =>
                  o.value ===
                  (modality === 'image' ? 'openai' : modality === 'text' ? 'openai-chat' : 'minimax-video'),
              )?.value ??
              protocolOptions[0]?.value ??
              '',
          };
    setForm(next);
    setInitial(next);
    setFormRev(0);
    setTestResult(null);
    setError(null);
    setConfirmSave(false);
    setConfirmDelete(false);
  }, [open, mode, channel, protocolOptions, modality]);

  const patch = (p: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setFormRev((r) => r + 1);
    setError(null);
  };

  const dirty = useMemo(
    () =>
      form.name !== initial.name ||
      form.protocol !== initial.protocol ||
      form.baseUrl.replace(/\/+$/, '') !== initial.baseUrl.replace(/\/+$/, '') ||
      form.model !== initial.model ||
      form.enabled !== initial.enabled ||
      form.token.length > 0 ||
      form.clearToken,
    [form, initial],
  );
  useUnsavedGuard(open && dirty);
  const requestClose = useDiscardConfirm(open && dirty, onClose);

  const scheduleAffecting = useMemo(() => {
    if (mode === 'create') return true;
    return (
      form.protocol !== initial.protocol ||
      form.baseUrl.replace(/\/+$/, '') !== initial.baseUrl.replace(/\/+$/, '') ||
      form.enabled !== initial.enabled ||
      form.token.length > 0 ||
      form.clearToken
    );
  }, [mode, form, initial]);

  const vendor = vendors.find(
    (v) =>
      v.protocol === form.protocol &&
      v.baseUrl.replace(/\/+$/, '') === form.baseUrl.replace(/\/+$/, ''),
  );

  const pickVendor = (key: string) => {
    const v = vendors.find((x) => x.key === key);
    if (!v) return;
    patch({ protocol: v.protocol, baseUrl: v.baseUrl, model: v.models[0]?.id ?? form.model });
  };

  const runTest = async () => {
    if (!canTest) return;
    setTesting(true);
    setTestResult(null);
    const rev = formRev;
    try {
      const result = await adminModelChannelsApi.testDraft({
        modality,
        ...(mode === 'edit' && channel ? { id: channel.id } : {}),
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        token: form.clearToken ? '' : form.token || undefined,
        model: form.model,
        enabled: true,
      });
      setTestResult({ rev, result });
    } catch (e) {
      setTestResult({
        rev,
        result: {
          ok: false,
          latencyMs: 0,
          message: (e as Error).message || '测试失败',
          testedAt: new Date().toISOString(),
          target: 'draft',
          usedStoredToken: false,
        },
      });
    } finally {
      setTesting(false);
    }
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写线路名称';
    if (!form.protocol) return '请选择对接协议';
    if (form.enabled && !form.baseUrl.trim()) return '启用线路时必须填写接入地址';
    if (form.baseUrl && !/^https?:\/\//i.test(form.baseUrl.trim())) return '接入地址需以 http:// 或 https:// 开头';
    /*
     * 末尾 /v1 必须当场拦下 (2026-10-23)。
     *
     * 服务端也会归一化, 但运营需要在这一刻就知道「照抄厂商文档是错的」——
     * 否则他保存后看到地址变了, 会以为自己填错了别的地方。真正的后果是
     * 协议层再补一次 /v1 → 上游 404 api_route_not_found, 而生成侧只报
     * 「通道全部失败」, 根因藏在 404 正文里。
     */
    if (/\/v1\/?$/i.test(form.baseUrl.trim())) {
      return '接入地址不要带 /v1：/v1 由协议层自动补全，填了会拼成 /v1/v1/...（上游 404）。请删掉末尾的 /v1';
    }
    if (form.clearToken && form.token) return '不能同时输入新令牌与清除令牌';
    return null;
  };

  const doSave = async (_typed: string, reason: string) => {
    const err = validate();
    if (err) {
      setError(err);
      setConfirmSave(false);
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') {
        const r = await adminModelChannelsApi.create({
          modality,
          name: form.name.trim(),
          protocol: form.protocol,
          baseUrl: form.baseUrl.trim(),
          ...(form.token ? { token: form.token } : {}),
          model: form.model.trim(),
          enabled: form.enabled,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.success(
          r.materialized ? '已新增线路，并已把旧版配置转为第 1 条线路' : '已新增线路',
        );
      } else if (channel) {
        await adminModelChannelsApi.update(channel.id, {
          name: form.name.trim(),
          protocol: form.protocol,
          baseUrl: form.baseUrl.trim(),
          ...(form.token ? { token: form.token } : {}),
          ...(form.clearToken ? { clearToken: true } : {}),
          model: form.model.trim(),
          enabled: form.enabled,
          expectedUpdatedAt: channel.updatedAt ?? undefined,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        toast.success('已保存，下一条生成立即按新配置调度');
      }
      setConfirmSave(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message || '保存失败');
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const trySave = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (scheduleAffecting) setConfirmSave(true);
    else void doSave('', '');
  };

  const doDelete = async (_typed: string, reason: string) => {
    if (!channel) return;
    setSaving(true);
    try {
      const r = await adminModelChannelsApi.remove(channel.id, reason.trim() || undefined);
      const after =
        r.sourceAfter === 'legacy'
          ? '该模态已回落到旧版单通道配置'
          : r.sourceAfter === 'none'
            ? '该模态当前未接入，调用会失败并退款'
            : '其余线路继续按顺序调度';
      toast.success(`已删除线路。${after}`);
      setConfirmDelete(false);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const stale = testResult && testResult.rev !== formRev;
  const protocolDesc = protocolOptions.find((o) => o.value === form.protocol)?.desc;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        title={`${mode === 'create' ? '新增线路' : '编辑线路'} · ${MODALITY_LABEL[modality]}`}
        width={720}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {mode === 'edit' && (
                <Button
                  variant="danger"
                  size="small"
                  disabled={!canWrite || saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除线路
                </Button>
              )}
              <span className="text-xs text-text-tertiary">
                {dirty ? '有未保存的修改' : '保存后立即生效'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="small" onClick={requestClose} disabled={saving}>
                取消
              </Button>
              <Button
                variant="primary"
                size="small"
                disabled={!canWrite || saving || (mode === 'edit' && !dirty)}
                onClick={trySave}
              >
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        {error && <Notice tone="danger" title={error} />}

        <div className="flex flex-col gap-4">
          <SectionTitle title="基本信息" />

          <FormField
            label="线路名称"
            htmlFor="mc-name"
            required
            hint="只用于后台辨认，不影响生成。"
          >
            <TextInput
              value={form.name}
              maxLength={60}
              disabled={!canWrite}
              placeholder="如：硅基流动 · 主线路"
              onChange={(next) => patch({ name: next })}
              ariaLabel="线路名称"
            />
          </FormField>

          <FormField
            label="厂商预设"
            htmlFor="mc-vendor"
            hint="选中后自动填接入地址、协议与推荐模型；访问令牌仍需手填。"
          >
            <SelectBox
              value={vendor?.key ?? CUSTOM}
              onChange={(next) => {
                if (!next || next === CUSTOM) return;
                pickVendor(next);
              }}
              disabled={!canWrite}
              options={[
                ...vendors.map((v) => ({ value: v.key, label: vendorDisplayLabel(v.label) })),
                { value: CUSTOM, label: '自定义（手动填写）' },
              ]}
              ariaLabel="厂商预设"
              className="w-full"
            />
          </FormField>

          {/*
            协议说明常驻展示, 不再只挂 tooltip。

            旧版把「端点 + 尺寸写法 + 参考图」塞进 hover 才出现的「技术细节」,
            而这三项恰恰决定通道能不能配通 (例如把 MiniMax 配成 openai 协议,
            请求体缺 size 字段直接 404)。运营选协议的那一刻就该看到。
          */}
          <FormField label="对接协议" htmlFor="mc-protocol" required>
            {protocolOptions.length === 0 ? (
              <Notice tone="warn" title="该模态尚未接入任何协议" className="mb-0" />
            ) : (
              <SelectBox
                value={form.protocol || undefined}
                onChange={(next) => patch({ protocol: next ?? '' })}
                disabled={!canWrite}
                options={protocolOptions.map((o) => ({ value: o.value, label: o.label }))}
                ariaLabel="对接协议"
                className="w-full"
              />
            )}
            {form.protocol && (
              <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border-table bg-background-secondary-default px-3 py-2 text-xs leading-5 text-text-secondary">
                <span className="flex items-center gap-1 font-medium text-text-primary">
                  <Info className="size-3" aria-hidden />
                  协议说明
                </span>
                <span>{PROTOCOL_HINT[form.protocol] ?? '按协议层声明的端点与参数格式调用。'}</span>
                {protocolDesc && <span className="break-words text-text-tertiary">{protocolDesc}</span>}
              </div>
            )}
          </FormField>

          <FormField
            label="默认模型"
            hint="从内置预设或厂商实时清单里选；清单里没有的模型名也可以直接输入。"
          >
            <ModelPicker
              modality={modality}
              value={form.model}
              presetModels={vendor?.models ?? []}
              protocol={form.protocol}
              baseUrl={form.baseUrl}
              channelId={mode === 'edit' ? channel?.id : undefined}
              hasStoredToken={mode === 'edit' && Boolean(channel?.hasToken)}
              draftToken={form.token}
              clearToken={form.clearToken}
              canWrite={canWrite}
              canTest={canTest}
              onChange={(next) => patch({ model: next })}
            />
          </FormField>

          <SectionTitle title="连接信息" />

          <FormField
            label="接入地址"
            htmlFor="mc-baseurl"
            required
            hint="填厂商根地址（如 https://api.example.com），/v1 等路径由协议自动补全，请不要带 /v1。"
          >
            <TextInput
              value={form.baseUrl}
              disabled={!canWrite}
              placeholder="https://api.example.com"
              onChange={(next) => patch({ baseUrl: next })}
              ariaLabel="接入地址"
            />
          </FormField>

          <FormField
            label="访问令牌"
            htmlFor="mc-token"
            hint={
              mode === 'edit' && channel?.hasToken
                ? `当前已配置（${channel.tokenMasked}），留空保持不变。`
                : undefined
            }
          >
            <TextInput
              value={form.token}
              disabled={!canWrite || form.clearToken}
              type="password"
              placeholder={mode === 'edit' && channel?.hasToken ? '留空保持不变' : '尚未配置'}
              maxLength={200}
              onChange={(next) => patch({ token: next })}
              ariaLabel="访问令牌"
            />
            {mode === 'edit' && (
              <div className="mt-2">
                <CheckBox
                  checked={form.clearToken}
                  disabled={!canWrite || form.token.length > 0}
                  onChange={(next) => patch({ clearToken: next })}
                  label={
                    <span className="text-xs text-text-secondary">
                      清除已保存的访问令牌
                    </span>
                  }
                />
              </div>
            )}
          </FormField>

          <SectionTitle title="调度" />

          <FormField
            label="启用这条线路"
            hint="停用后不参与调度，但仍可测试；尝试顺序在列表里用上下移调整。"
          >
            <SwitchBox
              checked={form.enabled}
              disabled={!canWrite}
              onChange={(next) => patch({ enabled: next })}
              ariaLabel="启用这条线路"
            />
          </FormField>
          <p className="-mt-2 text-xs text-text-tertiary">
            超时与轮询按模态统一设置，不随单条线路保存。
          </p>

          <SectionTitle title="连通性测试" />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="small"
              disabled={!canTest || saving || testing}
              onClick={() => void runTest()}
              title={canTest ? '用当前表单值测试，不保存' : '需要「通道测试」权限'}
            >
              {testing ? '测试中…' : '测试这条草稿'}
            </Button>
            <span className="text-xs text-text-tertiary">
              {canTest
                ? '只探测地址与模型，不消耗模型额度、不修改健康状态。'
                : '当前角色没有通道测试权限。'}
            </span>
          </div>

          {testResult && (
            <Notice
              tone={testResult.result.ok ? 'success' : 'danger'}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {testResult.result.ok ? '连通正常' : '连通失败'} ·{' '}
                    {fmtLatency(testResult.result.latencyMs)}
                  </span>
                  <span className="rounded bg-black/10 px-1.5 py-0.5 text-[11px]">草稿</span>
                </span>
              }
              className="mb-0"
            >
              <div>{testResult.result.message}</div>
              <div className="mt-0.5 text-text-tertiary">
                {fmtTime(testResult.result.testedAt)}
                {testResult.result.usedStoredToken ? ' · 使用了已保存的访问令牌' : ''}
              </div>
              {testResult.result.detail && (
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
                  {testResult.result.detail}
                </pre>
              )}
              {stale && (
                <div className="mt-1 text-amber-700">草稿已修改，此结果已过期，请重新测试</div>
              )}
            </Notice>
          )}
        </div>
      </Drawer>

      <InlineConfirm
        open={confirmSave}
        title="确认保存线路变更"
        description={
          mode === 'create'
            ? '保存后立即生效。若该模态此前沿用旧版单通道配置，系统会先把它转为第 1 条线路，再追加这一条。'
            : '保存后立即生效，后续生成会按新配置调度。'
        }
        impact={[
          `线路：${form.name || '未命名'}`,
          `接入地址：${form.baseUrl || '未填写'}`,
          `协议：${form.protocol || '未选择'}`,
          `状态：${form.enabled ? '启用' : '停用'}`,
        ]}
        needReason
        confirmText="确认保存"
        loading={saving}
        onCancel={() => setConfirmSave(false)}
        onConfirm={(typed, reason) => void doSave(typed, reason)}
      />

      <InlineConfirm
        open={confirmDelete}
        danger
        title="确认删除线路"
        description="删除后该线路立即退出调度。若这是该模态最后一条线路，会回落到旧版单通道配置（仍启用时）。"
        impact={channel ? [`线路：${channel.name}`, `接入地址：${channel.baseUrl || '未填写'}`] : undefined}
        needReason
        reasonPlaceholder="如：线路已停用"
        confirmText="确认删除"
        loading={saving}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={(typed, reason) => void doDelete(typed, reason)}
      />
    </>
  );
}

/** 抽屉内的分段标题：一条发丝线 + 小标题 */
function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="border-b border-border-table pb-1.5 text-[13px] font-semibold text-text-primary">
      {title}
    </h3>
  );
}
