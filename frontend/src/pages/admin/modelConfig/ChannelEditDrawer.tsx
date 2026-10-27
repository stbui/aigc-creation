import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { Info } from 'lucide-react';
import { adminModelChannelsApi } from '../../../lib/api';
import type {
  AdminChannelTestResult,
  AdminModelChannelRecord,
  Modality,
  ProtocolOption,
  VendorPreset,
} from '../../../types/api';
import { AntConfirm } from './AntConfirm';
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

/**
 * 线路编辑抽屉（antd Form 版）。
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
  const { message } = App.useApp();
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
        void message.success(r.materialized ? '已新增线路，并已把旧版配置转为第 1 条线路' : '已新增线路');
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
        void message.success('已保存，下一条生成立即按新配置调度');
      }
      setConfirmSave(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message || '保存失败');
      void message.error((e as Error).message || '保存失败');
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
      void message.success(`已删除线路。${after}`);
      setConfirmDelete(false);
      onSaved();
      onClose();
    } catch (e) {
      void message.error((e as Error).message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => onClose();

  const stale = testResult && testResult.rev !== formRev;

  return (
    <>
      <Drawer
        open={open}
        size={720}
        title={`${mode === 'create' ? '新增线路' : '编辑线路'} · ${MODALITY_LABEL[modality]}`}
        onClose={requestClose}
        mask={{ closable: !saving }}
        keyboard={!saving}
        footer={
          <Flex justify="space-between" align="center" gap={12} wrap>
            <Space>
              {mode === 'edit' && (
                <Button danger disabled={!canWrite || saving} onClick={() => setConfirmDelete(true)}>
                  删除线路
                </Button>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {dirty ? '有未保存的修改' : '保存后立即生效'}
              </Typography.Text>
            </Space>
            <Space>
              <Button onClick={requestClose} disabled={saving}>
                取消
              </Button>
              <Button
                type="primary"
                loading={saving}
                disabled={!canWrite || (mode === 'edit' && !dirty)}
                onClick={trySave}
              >
                保存
              </Button>
            </Space>
          </Flex>
        }
      >
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}

        <Form layout="vertical" requiredMark={false}>
          <Divider titlePlacement="start">
            基本信息
          </Divider>

          <Form.Item
            htmlFor="mc-name"
            label={
              <span>
                线路名称 <span style={{ color: 'var(--danger-text)' }}>*</span>
              </span>
            }
            extra="只用于后台辨认，不影响生成。"
          >
            <Input
              id="mc-name"
              value={form.name}
              maxLength={60}
              disabled={!canWrite}
              placeholder="如：硅基流动 · 主线路"
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Form.Item>

          <Form.Item htmlFor="mc-vendor" label="厂商预设" extra="选中后自动填接入地址、协议与推荐模型；访问令牌仍需手填。">
            <Select
              id="mc-vendor"
              value={vendor?.key ?? '__custom__'}
              disabled={!canWrite}
              onChange={(v) => (v === '__custom__' ? undefined : pickVendor(v))}
              options={[
                ...vendors.map((v) => ({ value: v.key, label: vendorDisplayLabel(v.label) })),
                { value: '__custom__', label: '自定义（手动填写）' },
              ]}
            />
          </Form.Item>

          {/*
            协议说明常驻展示, 不再只挂 tooltip。

            旧版把「端点 + 尺寸写法 + 参考图」塞进 hover 才出现的「技术细节」,
            而这三项恰恰决定通道能不能配通 (例如把 MiniMax 配成 openai 协议,
            请求体缺 size 字段直接 404)。运营选协议的那一刻就该看到。
          */}
          <Form.Item
            htmlFor="mc-protocol"
            label={
              <span>
                对接协议 <span style={{ color: 'var(--danger-text)' }}>*</span>
              </span>
            }
            extra={
              form.protocol && (
                <div className="mc-protocol-note">
                  <div className="mc-protocol-note-title">
                    <Info size={12} />
                    协议说明
                  </div>
                  <div>{PROTOCOL_HINT[form.protocol] ?? '按协议层声明的端点与参数格式调用。'}</div>
                  {protocolOptions.find((o) => o.value === form.protocol)?.desc && (
                    <div className="mc-protocol-note-tech">
                      {protocolOptions.find((o) => o.value === form.protocol)?.desc}
                    </div>
                  )}
                </div>
              )
            }
          >
            {protocolOptions.length === 0 ? (
              <Alert type="warning" showIcon title="该模态尚未接入任何协议" />
            ) : (
              <Select
                id="mc-protocol"
                value={form.protocol || undefined}
                disabled={!canWrite}
                onChange={(v) => patch({ protocol: v })}
                options={protocolOptions.map((o) => ({ value: o.value, label: o.label, title: o.desc }))}
              />
            )}
          </Form.Item>

          <Form.Item
            htmlFor="mc-model"
            label="默认模型"
            extra="从内置预设或厂商实时清单里选；清单里没有的模型名也可以直接输入。"
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
              onChange={(v) => patch({ model: v })}
            />
          </Form.Item>

          <Divider titlePlacement="start">
            连接信息
          </Divider>

          <Form.Item
            htmlFor="mc-baseurl"
            label={
              <span>
                接入地址 <span style={{ color: 'var(--danger-text)' }}>*</span>
              </span>
            }
            extra="填厂商根地址（如 https://api.example.com），/v1 等路径由协议自动补全，请不要带 /v1。"
          >
            <Input
              id="mc-baseurl"
              value={form.baseUrl}
              disabled={!canWrite}
              placeholder="https://api.example.com"
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </Form.Item>

          <Form.Item
            htmlFor="mc-token"
            label="访问令牌"
            extra={
              mode === 'edit' && channel?.hasToken
                ? `当前已配置（${channel.tokenMasked}），留空保持不变。`
                : undefined
            }
          >
            <Input.Password
              id="mc-token"
              value={form.token}
              autoComplete="new-password"
              disabled={!canWrite || form.clearToken}
              placeholder={mode === 'edit' && channel?.hasToken ? '留空保持不变' : '尚未配置'}
              onChange={(e) => patch({ token: e.target.value })}
            />
            {mode === 'edit' && (
              <Checkbox
                style={{ marginTop: 8 }}
                checked={form.clearToken}
                disabled={!canWrite || form.token.length > 0}
                onChange={(e) => patch({ clearToken: e.target.checked })}
              >
                清除已保存的访问令牌
              </Checkbox>
            )}
          </Form.Item>

          <Divider titlePlacement="start">
            调度
          </Divider>

          <Form.Item
            label="启用这条线路"
            extra="停用后不参与调度，但仍可测试；尝试顺序在列表里用上下移调整。"
          >
            <Switch checked={form.enabled} disabled={!canWrite} onChange={(v) => patch({ enabled: v })} />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            超时与轮询按模态统一设置，不随单条线路保存。
          </Typography.Paragraph>

          <Divider titlePlacement="start">
            连通性测试
          </Divider>

          <Space size={12} wrap style={{ marginBottom: 12 }}>
            <Button
              loading={testing}
              disabled={!canTest || saving}
              onClick={() => void runTest()}
              title={canTest ? '用当前表单值测试，不保存' : '需要「通道测试」权限'}
            >
              测试这条草稿
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {canTest ? '只探测地址与模型，不消耗模型额度、不修改健康状态。' : '当前角色没有通道测试权限。'}
            </Typography.Text>
          </Space>

          {testResult && (
            <Alert
              type={testResult.result.ok ? 'success' : 'error'}
              showIcon
              title={
                <Space size={8} wrap>
                  <span>
                    {testResult.result.ok ? '连通正常' : '连通失败'} ·{' '}
                    {fmtLatency(testResult.result.latencyMs)}
                  </span>
                  <Tag variant="filled">草稿</Tag>
                </Space>
              }
              description={
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                  <Typography.Text>{testResult.result.message}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(testResult.result.testedAt)}
                    {testResult.result.usedStoredToken ? ' · 使用了已保存的访问令牌' : ''}
                  </Typography.Text>
                  {testResult.result.detail && (
                    <Typography.Text
                      code
                      style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 12 }}
                    >
                      {testResult.result.detail}
                    </Typography.Text>
                  )}
                  {stale && <Tag color="warning">草稿已修改，此结果已过期，请重新测试</Tag>}
                </Space>
              }
            />
          )}
        </Form>
      </Drawer>

      <AntConfirm
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

      <AntConfirm
        open={confirmDelete}
        danger
        requireTyping
        typingText={channel?.name}
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
