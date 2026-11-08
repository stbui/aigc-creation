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
} from '~/admin-ui/primitives';
import {
  BILLING_MODE_OPTIONS,
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
      description={dirty ? '有未保存修改' : undefined}
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
            {saving ? '保存中…' : editing ? '保存修改' : '创建模型'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {unavailableReasons.length > 0 && (
          <Notice tone="warn" title="模型暂不可用">
            <ul className="mt-1 list-disc pl-4">
              {unavailableReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Notice>
        )}

        <section className="flex flex-col gap-3">
          <div className="text-xs font-semibold text-foreground">模型信息</div>
          <div className="grid grid-cols-3 gap-3">
            <FormField
              label="模型编号"
              required
              hint={editing ? '创建后不可修改' : undefined}
            >
              <TextField
                ariaLabel="模型编号"
                value={draft.code}
                onChange={(value) => onChange({ code: value })}
                placeholder="例如：ecom-image-pro"
                disabled={!!editing}
                maxLength={80}
              />
            </FormField>
            <FormField label="模型名称" required>
              <TextField
                ariaLabel="模型名称"
                value={draft.name}
                onChange={(value) => onChange({ name: value })}
                placeholder="例如：电商主图 Pro"
                maxLength={60}
              />
            </FormField>
            <FormField label="模型图标">
              <TextField
                ariaLabel="模型图标"
                value={draft.icon}
                onChange={(value) => onChange({ icon: value })}
                placeholder="🎨"
                maxLength={8}
              />
            </FormField>
          </div>

          <FormField label="模型描述">
            <TextAreaField
              ariaLabel="模型描述"
              value={draft.description}
              onChange={(value) => onChange({ description: value })}
              rows={2}
              maxLength={200}
              placeholder="例如：高质量商品主图生成，支持多尺寸"
            />
          </FormField>
        </section>

        <section className="flex flex-col gap-3">
          <div className="text-xs font-semibold text-foreground">上架设置</div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="所属能力" required>
              <SelectField
                ariaLabel="所属能力"
                value={draft.capability || undefined}
                options={capabilityOptions}
                onChange={(value) => onChange({ capability: value ?? '' })}
                placeholder="选择所属能力"
              />
            </FormField>
            <FormField label="展示排序" hint="数字越小，展示越靠前">
              <NumberField
                ariaLabel="展示排序"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
              />
            </FormField>
            <FormField label="上架状态">
              <div className="flex h-8 items-center">
                <SwitchField
                  checked={draft.enabled}
                  label={draft.enabled ? '已上架' : '未上架'}
                  ariaLabel="上架状态"
                  onChange={(checked) => onChange({ enabled: checked })}
                />
              </div>
            </FormField>
          </div>
        </section>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">价格设置</div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="定价方式">
              <SelectField
                ariaLabel="定价方式"
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
            draft.billingMode === 'token' ? (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <FormField label="输入内容单价">
                  <TextField
                    ariaLabel="输入内容单价"
                    inputMode="decimal"
                    value={draft.inputPrice}
                    onChange={(value) => onChange({ inputPrice: value })}
                  />
                </FormField>
                <FormField label="输出内容单价">
                  <TextField
                    ariaLabel="输出内容单价"
                    inputMode="decimal"
                    value={draft.outputPrice}
                    onChange={(value) => onChange({ outputPrice: value })}
                  />
                </FormField>
                <FormField label="缓存内容单价">
                  <TextField
                    ariaLabel="缓存内容单价"
                    inputMode="decimal"
                    value={draft.cachedPrice}
                    onChange={(value) => onChange({ cachedPrice: value })}
                  />
                </FormField>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <FormField
                  label={draft.billingMode === 'per_second' ? '每秒价格' : '每次价格'}
                >
                  <TextField
                    ariaLabel="单价"
                    inputMode="decimal"
                    value={draft.unitPrice}
                    onChange={(value) => onChange({ unitPrice: value })}
                  />
                </FormField>
              </div>
            )
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-foreground">服务来源</div>
              <div className="text-[12px] text-muted-foreground">
                优先顺位数值越小，越先使用；同一顺位按比例分流
              </div>
            </div>
            <ActionButton
              variant="secondary"
              size="xs"
              icon={Plus}
              disabled={!writable}
              onClick={onAddRoute}
            >
              添加服务来源
            </ActionButton>
          </div>
          {draft.routes.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-muted-foreground">
              尚未添加服务来源，模型暂不可用。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_96px_32px] gap-2 px-1 text-[12px] text-muted-foreground">
                <span>服务来源</span>
                <span>优先顺位</span>
                <span>分流比例</span>
                <span>状态</span>
                <span />
              </div>
              {draft.routes.map((route) => (
                <div
                  key={route.key}
                  className="grid grid-cols-[minmax(0,1fr)_72px_72px_96px_32px] items-end gap-2"
                >
                  <SelectField
                    ariaLabel="服务来源"
                    value={route.channelModelId || undefined}
                    options={channelModelOptions}
                    onChange={(value) => onUpdateRoute(route.key, { channelModelId: value ?? '' })}
                    placeholder="选择服务来源"
                  />
                  <NumberField
                    ariaLabel="服务来源优先顺位"
                    value={Number(route.priority) || 0}
                    min={0}
                    onChange={(value) => onUpdateRoute(route.key, { priority: String(value ?? 0) })}
                  />
                  <NumberField
                    ariaLabel="服务来源分流比例"
                    value={Number(route.weight) || 0}
                    min={0}
                    onChange={(value) => onUpdateRoute(route.key, { weight: String(value ?? 0) })}
                  />
                  <SwitchField
                    checked={route.enabled}
                    label={route.enabled ? '已启用' : '已停用'}
                    ariaLabel="服务来源状态"
                    onChange={(checked) => onUpdateRoute(route.key, { enabled: checked })}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除服务来源"
                    size="xs"
                    onClick={() => onRemoveRoute(route.key)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              更多设置
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <FormField label="能力范围" hint="限制可提供的服务与规格">
                <TextAreaField
                  ariaLabel="能力范围"
                  value={draft.capabilitySpecText}
                  onChange={(value) => onChange({ capabilitySpecText: value })}
                  rows={6}
                />
              </FormField>
              <FormField label="默认选项" hint="用户未选择时自动采用">
                <TextAreaField
                  ariaLabel="默认选项"
                  value={draft.defaultOptionsText}
                  onChange={(value) => onChange({ defaultOptionsText: value })}
                  rows={6}
                />
              </FormField>
            </div>
          </details>
        )}

      </div>
    </Drawer>
  );
}
