import { Plus, Trash2 } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
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
import { BADGE_STYLE_OPTIONS, type GroupDraft, type OverrideDraft } from './constants';
import type { ChannelOrderItemView, UserGroupView } from '../../../types/model';

interface UserGroupFormDrawerProps {
  open: boolean;
  editing: UserGroupView | null;
  draft: GroupDraft;
  formDirty: boolean;
  saving: boolean;
  writable: boolean;
  channels: ChannelOrderItemView[];
  onPatch: (patch: Partial<GroupDraft>) => void;
  onToggleChannel: (channelId: string) => void;
  onAddOverride: () => void;
  onUpdateOverride: (index: number, patch: Partial<OverrideDraft>) => void;
  onRemoveOverride: (index: number) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 分组表单：基础信息、价格、可见渠道、按模型覆盖。
 *
 * 编码与默认分组的关键约束（不可改码、不可删除）在这里直接禁用控件，
 * 真正的校验仍在后端。
 */
export function UserGroupFormDrawer({
  open,
  editing,
  draft,
  formDirty,
  saving,
  writable,
  channels,
  onPatch,
  onToggleChannel,
  onAddOverride,
  onUpdateOverride,
  onRemoveOverride,
  onClose,
  onSubmit,
}: UserGroupFormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={700}
      title={editing ? `编辑分组 · ${editing.name}` : '新建用户分组'}
      description={formDirty ? '有未保存修改' : editing ? '编码创建后不可修改' : '编码用于会员套餐映射'}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={saving || !writable} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="编码" hint={editing ? '不可修改' : '小写字母 / 数字 / _ / -'}>
            <TextField
              ariaLabel="分组编码"
              value={draft.code}
              onChange={(value) => onPatch({ code: value })}
              placeholder="default"
              disabled={!!editing?.isDefault}
              maxLength={40}
            />
          </FormField>
          <FormField label="名称">
            <TextField
              ariaLabel="分组名称"
              value={draft.name}
              onChange={(value) => onPatch({ name: value })}
              placeholder="普通用户"
              maxLength={40}
            />
          </FormField>
          <FormField label="排序值">
            <NumberField
              ariaLabel="排序值"
              value={Number(draft.sortOrder) || 0}
              min={0}
              onChange={(value) => onPatch({ sortOrder: String(value ?? 0) })}
            />
          </FormField>
        </div>

        <FormField label="描述">
          <TextAreaField
            ariaLabel="分组描述"
            value={draft.description}
            onChange={(value) => onPatch({ description: value })}
            rows={2}
            maxLength={200}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="徽标文字" hint="用户侧展示，如「VIP」">
            <TextField
              ariaLabel="徽标文字"
              value={draft.badgeLabel}
              onChange={(value) => onPatch({ badgeLabel: value })}
              placeholder="VIP"
              maxLength={16}
            />
          </FormField>
          <FormField label="徽标样式">
            <SelectField
              ariaLabel="徽标样式"
              value={draft.badgeStyle}
              options={BADGE_STYLE_OPTIONS}
              onChange={(value) => onPatch({ badgeStyle: value ?? 'none' })}
            />
          </FormField>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">价格</div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="倍率（%）" hint="100 = 原价；50 = 五折">
              <TextField
                ariaLabel="倍率"
                inputMode="numeric"
                value={draft.ratioPercent}
                onChange={(value) => onPatch({ ratioPercent: value })}
              />
            </FormField>
            <FormField label="1 USD = 积分">
              <TextField
                ariaLabel="美元点数汇率"
                inputMode="decimal"
                value={draft.pointsPerUsd}
                onChange={(value) => onPatch({ pointsPerUsd: value })}
              />
            </FormField>
            <FormField label="1 CNY = 积分">
              <TextField
                ariaLabel="人民币点数汇率"
                inputMode="decimal"
                value={draft.pointsPerCny}
                onChange={(value) => onPatch({ pointsPerCny: value })}
              />
            </FormField>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-foreground">可见渠道</div>
              <div className="text-[12px] text-muted-foreground">
                不在可见范围内的渠道，其模型不会出现在该分组的目录里
              </div>
            </div>
            <SwitchField
              checked={draft.allChannels}
              label="全部渠道"
              ariaLabel="全部渠道可见"
              onChange={(checked) => onPatch({ allChannels: checked })}
            />
          </div>
          {!draft.allChannels && (
            <div className="grid grid-cols-2 gap-2">
              {channels.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">尚无渠道可勾选</p>
              ) : (
                channels.map((channel) => (
                  <CheckboxField
                    key={channel.id}
                    checked={draft.channelIds.includes(channel.id)}
                    label={channel.name}
                    onChange={() => onToggleChannel(channel.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-foreground">按模型覆盖</div>
              <div className="text-[12px] text-muted-foreground">
                按前台模型编码覆盖倍率与汇率；未命中时用分组默认值
              </div>
            </div>
            <ActionButton variant="secondary" size="xs" icon={Plus} disabled={!writable} onClick={onAddOverride}>
              添加覆盖
            </ActionButton>
          </div>
          {draft.overrides.length === 0 ? (
            <p className="py-2 text-center text-[12px] text-muted-foreground">没有覆盖项</p>
          ) : (
            <div className="flex flex-col gap-2">
              {draft.overrides.map((item, index) => (
                <div key={index} className="grid grid-cols-[1fr_70px_90px_90px_32px] items-end gap-2">
                  <TextField
                    ariaLabel="模型编码"
                    value={item.modelKey}
                    onChange={(value) => onUpdateOverride(index, { modelKey: value })}
                    placeholder="ecom-image-pro"
                  />
                  <TextField
                    ariaLabel="覆盖倍率"
                    inputMode="numeric"
                    value={item.ratioPercent}
                    onChange={(value) => onUpdateOverride(index, { ratioPercent: value })}
                  />
                  <TextField
                    ariaLabel="覆盖美元汇率"
                    inputMode="decimal"
                    value={item.pointsPerUsd}
                    onChange={(value) => onUpdateOverride(index, { pointsPerUsd: value })}
                  />
                  <TextField
                    ariaLabel="覆盖人民币汇率"
                    inputMode="decimal"
                    value={item.pointsPerCny}
                    onChange={(value) => onUpdateOverride(index, { pointsPerCny: value })}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除覆盖"
                    size="xs"
                    onClick={() => onRemoveOverride(index)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {editing?.isDefault && (
          <Notice tone="info" title="默认分组">
            没有有效会员的用户都会落在默认分组；它的编码不可修改，也不允许删除。
          </Notice>
        )}

      </div>
    </Drawer>
  );
}
