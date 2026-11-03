import {
  ActionButton,
  Drawer,
  FormField,
  NumberField,
  SwitchField,
  TextField,
} from './components';
import type { PlanDraft } from './constants';
import type { AdminMembershipPlan } from '../../../types/api';

interface PlanFormDrawerProps {
  open: boolean;
  editing: AdminMembershipPlan | null;
  draft: PlanDraft;
  formDirty: boolean;
  saving: boolean;
  onPatch: (patch: Partial<PlanDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 会员套餐表单。
 *
 * 编码创建后禁用；新建默认下架 —— 确认权益与价格无误后再手动上架。
 */
export function PlanFormDrawer({
  open,
  editing,
  draft,
  formDirty,
  saving,
  onPatch,
  onClose,
  onSubmit,
}: PlanFormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={540}
      title={editing ? '编辑会员套餐' : '新建会员套餐'}
      description={
        formDirty
          ? '有未保存修改'
          : editing
            ? `编码 ${editing.code} 不可修改`
            : '创建后默认为下架状态'
      }
      footer={
        <>
          <ActionButton variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton disabled={saving} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="套餐编码"
            hint={editing ? '创建后不可修改' : '小写字母、数字、下划线或短横线'}
          >
            <TextField
              ariaLabel="套餐编码"
              value={draft.code}
              disabled={editing !== null}
              onChange={(value) => onPatch({ code: value })}
              placeholder="如 pro"
              maxLength={40}
            />
          </FormField>
          <FormField label="套餐名称">
            <TextField
              ariaLabel="套餐名称"
              value={draft.name}
              onChange={(value) => onPatch({ name: value })}
              placeholder="如 专业会员"
              maxLength={40}
            />
          </FormField>
        </div>

        <FormField label="套餐说明" hint="展示在 C 端会员卡上">
          <TextField
            ariaLabel="套餐说明"
            value={draft.description}
            onChange={(value) => onPatch({ description: value })}
            placeholder="一句话说明适合谁"
            maxLength={300}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="订阅价（元）" hint="整数分入库；free 套餐必须为 0">
            <TextField
              ariaLabel="订阅价"
              value={draft.priceYuan}
              onChange={(value) => onPatch({ priceYuan: value })}
              placeholder="如 29.00"
            />
          </FormField>
          <FormField label="周期（天）" hint="0 = 永久，仅 free 套餐可用">
            <NumberField
              ariaLabel="周期天数"
              value={Number(draft.durationDays) || 0}
              min={0}
              max={3650}
              onChange={(next) => onPatch({ durationDays: String(next ?? 0) })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="每月赠送积分">
            <NumberField
              ariaLabel="每月赠送积分"
              value={Number(draft.monthlyCredits) || 0}
              min={0}
              onChange={(next) => onPatch({ monthlyCredits: String(next ?? 0) })}
            />
          </FormField>
          <FormField label="并发任务上限" hint="0 = 不限">
            <NumberField
              ariaLabel="并发任务上限"
              value={Number(draft.maxConcurrent) || 0}
              min={0}
              max={100}
              onChange={(next) => onPatch({ maxConcurrent: String(next ?? 0) })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="加油包折扣" hint="100 = 无折扣，95 = 95 折">
            <NumberField
              ariaLabel="加油包折扣"
              value={Number(draft.discountPercent) || 100}
              min={1}
              max={100}
              onChange={(next) => onPatch({ discountPercent: String(next ?? 100) })}
            />
          </FormField>
          <FormField label="排序" hint="数字越小越靠前">
            <NumberField
              ariaLabel="排序"
              value={Number(draft.sortOrder) || 0}
              onChange={(next) => onPatch({ sortOrder: String(next ?? 0) })}
            />
          </FormField>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <div className="text-xs font-medium text-foreground">专享快速通道</div>
            <div className="text-[12px] text-muted-foreground">开启后该套餐会员走快速生成队列</div>
          </div>
          <SwitchField
            checked={draft.fastChannel}
            onChange={(checked) => onPatch({ fastChannel: checked })}
            ariaLabel="专享快速通道"
          />
        </div>

      </div>
    </Drawer>
  );
}
