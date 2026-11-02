import { Plus, Trash2 } from 'lucide-react';
import {
  ActionButton,
  Drawer,
  FormField,
  IconButton,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from './components';
import {
  BILLING_MODE_OPTIONS,
  CAPABILITY_SPEC_PLACEHOLDER,
  PRICE_POLICY_OPTIONS,
  type ModelDraft,
  type RouteDraft,
} from './constants';
import type { AdminLogicalModelView } from '../../../types/model';

/**
 * 新建 / 编辑前台模型。
 *
 * 全量提交：未填字段按默认值落库，保存即生成新 revision 并重建线路。
 * 因此这里不做字段级脏标记，整张表单共用一个 dirty 判定，关闭前统一确认。
 */
export function ModelFormDrawer({
  open,
  editing,
  draft,
  dirty,
  saving,
  writable,
  capabilityOptions,
  channelModelOptions,
  onClose,
  onChange,
  onAddRoute,
  onUpdateRoute,
  onRemoveRoute,
  onSave,
}: {
  open: boolean;
  editing: AdminLogicalModelView | null;
  draft: ModelDraft;
  dirty: boolean;
  saving: boolean;
  writable: boolean;
  capabilityOptions: Array<{ value: string; label: string }>;
  channelModelOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onChange: (patch: Partial<ModelDraft>) => void;
  onAddRoute: () => void;
  onUpdateRoute: (key: string, patch: Partial<RouteDraft>) => void;
  onRemoveRoute: (key: string) => void;
  onSave: () => void;
}) {
  const unavailableReasons = editing
    ? [editing.configurationError, editing.availabilityError].filter(Boolean)
    : [];

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title={editing ? `编辑 · ${editing.name}` : '新建前台模型'}
      description={
        dirty ? '有未保存修改' : '全量提交：未填字段按默认值落库，保存后生成新 revision'
      }
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            disabled={saving || !writable}
            onClick={onSave}
          >
            {saving ? '保存中…' : editing ? '保存（新 revision）' : '创建'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {unavailableReasons.length > 0 && (
          <Notice tone="warn" title="当前模型不可用">
            <ul className="mt-1 list-disc pl-4">
              {unavailableReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Notice>
        )}

        <div className="grid grid-cols-3 gap-3">
          <FormField label="编码" hint={editing ? '创建后不可修改' : '小写字母 / 数字 / . _ -'}>
            <TextField
              ariaLabel="编码"
              value={draft.code}
              onChange={(value) => onChange({ code: value })}
              placeholder="ecom-image-pro"
              disabled={!!editing}
              maxLength={80}
            />
          </FormField>
          <FormField label="名称">
            <TextField
              ariaLabel="名称"
              value={draft.name}
              onChange={(value) => onChange({ name: value })}
              placeholder="电商主图 Pro"
              maxLength={60}
            />
          </FormField>
          <FormField label="图标" hint="emoji 或短字符">
            <TextField
              ariaLabel="图标"
              value={draft.icon}
              onChange={(value) => onChange({ icon: value })}
              placeholder="🎨"
              maxLength={8}
            />
          </FormField>
        </div>

        <FormField label="描述" hint="面向用户展示的一句话说明">
          <TextAreaField
            ariaLabel="描述"
            value={draft.description}
            onChange={(value) => onChange({ description: value })}
            rows={2}
            maxLength={200}
            placeholder="高质量商品主图生成，支持多尺寸"
          />
        </FormField>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="C 端能力" hint="准入按这个 id 选模型">
            <SelectField
              ariaLabel="C 端能力"
              value={draft.capability || undefined}
              options={capabilityOptions}
              onChange={(value) => onChange({ capability: value ?? '' })}
              placeholder="选择能力"
            />
          </FormField>
          <FormField label="排序值" hint="数字越小越靠前">
            <NumberField
              ariaLabel="排序值"
              value={Number(draft.sortOrder) || 0}
              min={0}
              onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
            />
          </FormField>
          <FormField label="上架">
            <div className="flex h-8 items-center">
              <SwitchField
                checked={draft.enabled}
                label="对用户可见"
                ariaLabel="上架"
                onChange={(checked) => onChange({ enabled: checked })}
              />
            </div>
          </FormField>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">计费</div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="价格策略" hint="「跟随渠道」按渠道模型的价格档计费">
              <SelectField
                ariaLabel="价格策略"
                value={draft.pricePolicy}
                options={PRICE_POLICY_OPTIONS}
                onChange={(value) => onChange({ pricePolicy: value ?? 'channel' })}
              />
            </FormField>
            <FormField label="计费方式">
              <SelectField
                ariaLabel="计费方式"
                value={draft.billingMode}
                options={BILLING_MODE_OPTIONS}
                onChange={(value) => onChange({ billingMode: value ?? 'fixed_request' })}
              />
            </FormField>
          </div>
          {draft.pricePolicy === 'unified' && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              <FormField label="单价（积分）">
                <TextField
                  ariaLabel="单价"
                  inputMode="decimal"
                  value={draft.unitPrice}
                  onChange={(value) => onChange({ unitPrice: value })}
                />
              </FormField>
              <FormField label="输入 Token 价">
                <TextField
                  ariaLabel="输入 Token 价"
                  inputMode="decimal"
                  value={draft.inputPrice}
                  onChange={(value) => onChange({ inputPrice: value })}
                />
              </FormField>
              <FormField label="输出 Token 价">
                <TextField
                  ariaLabel="输出 Token 价"
                  inputMode="decimal"
                  value={draft.outputPrice}
                  onChange={(value) => onChange({ outputPrice: value })}
                />
              </FormField>
              <FormField label="缓存 Token 价">
                <TextField
                  ariaLabel="缓存 Token 价"
                  inputMode="decimal"
                  value={draft.cachedPrice}
                  onChange={(value) => onChange({ cachedPrice: value })}
                />
              </FormField>
            </div>
          )}
        </div>

        <FormField
          label="能力合同（capabilitySpec）"
          hint="声明本模型接受的 input / operation / 参数范围；线路按它做匹配，写错会让模型选不到线路"
        >
          <TextAreaField
            ariaLabel="能力合同"
            value={draft.capabilitySpecText}
            onChange={(value) => onChange({ capabilitySpecText: value })}
            rows={8}
            placeholder={CAPABILITY_SPEC_PLACEHOLDER}
          />
        </FormField>

        <FormField label="默认参数" hint="用户未显式给出时使用的默认值（JSON 对象）">
          <TextAreaField
            ariaLabel="默认参数"
            value={draft.defaultOptionsText}
            onChange={(value) => onChange({ defaultOptionsText: value })}
            rows={4}
          />
        </FormField>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-foreground">线路</div>
              <div className="text-[12px] text-muted-foreground">
                同一 priority 内按 weight 随机；priority 更小的层先被尝试
              </div>
            </div>
            <ActionButton
              variant="secondary"
              size="xs"
              icon={Plus}
              disabled={!writable}
              onClick={onAddRoute}
            >
              添加线路
            </ActionButton>
          </div>
          {draft.routes.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-muted-foreground">
              没有线路时模型永远不可用（C 端会收到 42204）。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {draft.routes.map((route) => (
                <div
                  key={route.key}
                  className="grid grid-cols-[1fr_64px_64px_72px_32px] items-end gap-2"
                >
                  <SelectField
                    ariaLabel="线路渠道模型"
                    value={route.channelModelId || undefined}
                    options={channelModelOptions}
                    onChange={(value) => onUpdateRoute(route.key, { channelModelId: value ?? '' })}
                    placeholder="选择渠道模型"
                  />
                  <NumberField
                    ariaLabel="优先级"
                    value={Number(route.priority) || 0}
                    min={0}
                    onChange={(value) => onUpdateRoute(route.key, { priority: String(value ?? 0) })}
                  />
                  <NumberField
                    ariaLabel="权重"
                    value={Number(route.weight) || 0}
                    min={0}
                    onChange={(value) => onUpdateRoute(route.key, { weight: String(value ?? 0) })}
                  />
                  <SwitchField
                    checked={route.enabled}
                    label="启用"
                    ariaLabel="线路启用"
                    onChange={(checked) => onUpdateRoute(route.key, { enabled: checked })}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除线路"
                    size="xs"
                    onClick={() => onRemoveRoute(route.key)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <FormField label="变更原因" hint="写入审计">
          <TextField
            ariaLabel="变更原因"
            value={draft.reason}
            onChange={(value) => onChange({ reason: value })}
            placeholder="如：新增备用线路"
            maxLength={200}
          />
        </FormField>
      </div>
    </Drawer>
  );
}
