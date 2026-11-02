import {
  ActionButton,
  Drawer,
  FormField,
  Notice,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from './components';
import { EFFECTIVE_META, STATUS_OPTIONS, TYPE_OPTIONS, type FormState } from './constants';
import { inWindow } from './utils';
import type { AdminCampaign, CampaignStatus, CampaignType } from '../../../types/api';

interface CampaignFormDrawerProps {
  open: boolean;
  editing: AdminCampaign | null;
  form: FormState;
  formError: string | null;
  formDirty: boolean;
  busy: boolean;
  onPatch: (patch: Partial<FormState>) => void;
  onClose: () => void;
  onSave: () => void;
}

/**
 * 活动表单：payload 字段随类型切换，避免看到不相关的输入框。
 *
 * 编辑时额外展示派生状态 —— 人工状态是 `active` 但不在时间窗内时，
 * 保存成功也不会有任何曝光。
 */
export function CampaignFormDrawer({
  open,
  editing,
  form,
  formError,
  formDirty,
  busy,
  onPatch,
  onClose,
  onSave,
}: CampaignFormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={560}
      title={editing ? `编辑活动 · ${editing.name}` : '新建活动'}
      description={formDirty ? '有未保存修改' : undefined}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            取消
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={busy} onClick={onSave}>
            {busy ? '保存中…' : '保存'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <Notice tone="danger" className="mb-0">
            {formError}
          </Notice>
        )}

        <FormField label="活动名称">
          <TextField
            ariaLabel="活动名称"
            value={form.name}
            placeholder="如: 双十一大促"
            maxLength={60}
            onChange={(value) => onPatch({ name: value })}
          />
        </FormField>

        <FormField label="类型" hint="类型决定 payload 字段，切换类型后原有的内容不会保留">
          <SelectField
            ariaLabel="活动类型"
            value={form.type}
            onChange={(value) => onPatch({ type: value as CampaignType })}
            options={TYPE_OPTIONS}
          />
        </FormField>

        {/* payload 字段随类型切换, 避免看到不相关的输入框 */}
        {form.type === 'limited_price' && (
          <>
            <FormField label="目标商品 ID">
              <TextField
                ariaLabel="目标商品 ID"
                value={form.productId}
                placeholder="商品 ID"
                onChange={(value) => onPatch({ productId: value })}
              />
            </FormField>
            <FormField label="活动价 (元)" hint="表单内填元，入库换算成分">
              <TextField
                ariaLabel="活动价"
                inputMode="decimal"
                value={form.priceCents}
                placeholder="9.90"
                onChange={(value) => onPatch({ priceCents: value })}
              />
            </FormField>
          </>
        )}

        {form.type === 'limited_free' && (
          <FormField label="能力 ID (逗号分隔)" hint="这些能力在活动期内免费使用">
            <TextField
              ariaLabel="能力 ID"
              value={form.capabilityIds}
              placeholder="main_image, detail_image"
              onChange={(value) => onPatch({ capabilityIds: value })}
            />
          </FormField>
        )}

        {form.type === 'popup' && (
          <>
            <FormField label="弹窗标题">
              <TextField
                ariaLabel="弹窗标题"
                value={form.title}
                maxLength={60}
                onChange={(value) => onPatch({ title: value })}
              />
            </FormField>
            <FormField label="正文">
              <TextAreaField
                ariaLabel="弹窗正文"
                rows={3}
                value={form.body}
                maxLength={300}
                showCount
                onChange={(value) => onPatch({ body: value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="按钮文案">
                <TextField
                  ariaLabel="按钮文案"
                  value={form.ctaText}
                  maxLength={12}
                  onChange={(value) => onPatch({ ctaText: value })}
                />
              </FormField>
              <FormField label="跳转地址" hint="仅支持站内相对路径">
                <TextField
                  ariaLabel="跳转地址"
                  value={form.ctaUrl}
                  placeholder="/workbench"
                  onChange={(value) => onPatch({ ctaUrl: value })}
                />
              </FormField>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField label="开始时间">
            <TextField
              ariaLabel="开始时间"
              type="datetime-local"
              value={form.startAt}
              onChange={(value) => onPatch({ startAt: value })}
            />
          </FormField>
          <FormField label="结束时间">
            <TextField
              ariaLabel="结束时间"
              type="datetime-local"
              value={form.endAt}
              onChange={(value) => onPatch({ endAt: value })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 items-start gap-4">
          <FormField label="状态">
            <SelectField
              ariaLabel="状态"
              value={form.status}
              onChange={(value) => onPatch({ status: value as CampaignStatus })}
              options={STATUS_OPTIONS}
            />
          </FormField>
          <div className="pt-6">
            <SwitchField
              checked={form.onlyNewUsers}
              onChange={(checked) => onPatch({ onlyNewUsers: checked })}
              label={form.onlyNewUsers ? '仅投放新用户' : '投放全站用户'}
            />
          </div>
        </div>

        {editing && (
          <p className="text-[12px] leading-4 text-muted-foreground">
            当前派生状态：{EFFECTIVE_META[editing.effective]?.label ?? editing.statusLabel}
            {editing.status === 'active' && !inWindow(editing) && '（不在时间窗内，实际不会曝光）'}
          </p>
        )}
      </div>
    </Drawer>
  );
}
