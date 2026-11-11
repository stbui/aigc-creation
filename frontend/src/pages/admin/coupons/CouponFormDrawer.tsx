import { FormDrawer, FormField, SelectField, TextField } from '~/admin-ui/primitives';
import { SCOPE_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS, type FormState } from './constants';
import type { AdminCoupon, CouponScope, CouponStatus, CouponType } from '../../../types/api';

/**
 * 新建 / 编辑优惠券。
 *
 * 券码创建后不可修改 —— 改券码等于让用户手里已发放的券集体失效；编辑时
 * 留空即不改，表单里也不展示券码输入框。
 */
export function CouponFormDrawer({
  open,
  editing,
  form,
  formError,
  dirty,
  busy,
  onPatch,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AdminCoupon | null;
  form: FormState;
  formError: string | null;
  dirty: boolean;
  busy: boolean;
  onPatch: (patch: Partial<FormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `编辑优惠券 · ${editing.code}` : '新建优惠券'}
      busy={busy}
      dirty={dirty}
      formError={formError}
      /* 编辑态没有改动时不必再发一次保存：成功 toast 会让人误以为改了什么 */
      submitDisabled={Boolean(editing) && !dirty}
      onSubmit={onSave}
    >
      {!editing && (
        <FormField label="券码" hint="用户手动输入此码。创建后不可修改。">
          <TextField
            ariaLabel="券码"
            value={form.code}
            placeholder="4~24 位大写字母或数字"
            maxLength={24}
            onChange={(value) => onPatch({ code: value.toUpperCase() })}
          />
        </FormField>
      )}

      <FormField label="券名称">
        <TextField
          ariaLabel="券名称"
          value={form.name}
          placeholder="如: 新客立减 10 元"
          maxLength={60}
          onChange={(value) => onPatch({ name: value })}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="类型">
          <SelectField
            ariaLabel="类型"
            value={form.type}
            // 换类型要清空面额: 折扣的万分比与金额的分是两套单位, 留着旧值必然算错
            onChange={(value) => onPatch({ type: value as CouponType, value: '' })}
            options={TYPE_OPTIONS}
          />
        </FormField>
        <FormField
          label={form.type === 'discount' ? '折扣 (万分比)' : '减免金额 (元)'}
          hint={form.type === 'discount' ? '8500 表示 8.5 折' : '表单内填元，入库换算成分'}
        >
          <TextField
            ariaLabel="面额"
            inputMode="decimal"
            value={form.value}
            placeholder={form.type === 'discount' ? '8500 = 8.5折' : '10.00'}
            onChange={(value) => onPatch({ value })}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="使用门槛 (元)" hint="0 表示无门槛">
          <TextField
            ariaLabel="使用门槛"
            inputMode="decimal"
            value={form.threshold}
            onChange={(value) => onPatch({ threshold: value })}
          />
        </FormField>
        <FormField label="适用范围">
          <SelectField
            ariaLabel="适用范围"
            value={form.scope}
            onChange={(value) => onPatch({ scope: value as CouponScope })}
            options={SCOPE_OPTIONS}
          />
        </FormField>
      </div>

      {form.scope === 'product' && (
        <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-[12px] leading-4 text-muted-foreground">
          商品范围由后端按订单明细校验，此处留空表示不限具体商品（仅限制在指定范围订单内）。
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="发行总量" hint="0 表示不限量">
          <TextField
            ariaLabel="发行总量"
            inputMode="numeric"
            value={form.totalCount}
            onChange={(value) => onPatch({ totalCount: value })}
          />
        </FormField>
        <FormField label="每人限用" hint="0 表示不限">
          <TextField
            ariaLabel="每人限用"
            inputMode="numeric"
            value={form.perUserLimit}
            onChange={(value) => onPatch({ perUserLimit: value })}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="生效时间">
          <TextField
            ariaLabel="生效时间"
            type="datetime-local"
            value={form.validFrom}
            onChange={(value) => onPatch({ validFrom: value })}
          />
        </FormField>
        <FormField label="失效时间">
          <TextField
            ariaLabel="失效时间"
            type="datetime-local"
            value={form.validTo}
            onChange={(value) => onPatch({ validTo: value })}
          />
        </FormField>
      </div>

      <FormField label="状态" hint="过期、未开始、售罄由时间与库存派生，列表里优先展示派生结果">
        <SelectField
          ariaLabel="状态"
          value={form.status}
          onChange={(value) => onPatch({ status: value as CouponStatus })}
          options={STATUS_OPTIONS}
        />
      </FormField>

      {editing && (
        <p className="text-[12px] leading-4 text-muted-foreground">
          已核销 {editing.usedCount} 张 · 待支付预占 {editing.pendingReserved} 张 ·
          券码不可修改，停用后已发放的券立即失效
        </p>
      )}
    </FormDrawer>
  );
}
