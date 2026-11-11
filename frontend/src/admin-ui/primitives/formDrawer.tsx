import type { ComponentType, ReactNode } from 'react';

import { useDiscardConfirm } from '../../hooks/useUnsavedGuard';
import { ActionButton } from './form';
import { Drawer, type DrawerSize } from './overlay';
import { Notice } from './display';

/**
 * 新建 / 编辑抽屉。
 *
 * ## 为什么要有这一层
 *
 * 迁移前 21 个抽屉各自拼页脚、各自决定能否关闭，于是同一件事长出了不同答案：
 *
 * | 抽屉 | 保存中能否关闭 | 有改动时关闭 | 主操作文案 |
 * |---|---|---|---|
 * | `ProjectFormDrawer` | 否 | 直接关，改动丢失 | 保存 / 创建项目 |
 * | `CouponFormDrawer` | **是** | 直接关，改动丢失 | 保存 |
 * | `ChannelFormDrawer` | **是** | 直接关，改动丢失 | 保存修改 / 接入 |
 * | `ModelFormDrawer` | 否 | 弹确认 | 保存 |
 *
 * 同一套「填表 → 保存」的交互，操作者关掉抽屉能不能保住内容，取决于从哪一页
 * 点进来 —— 这不是设计，是遗漏。本组件把三件事收成一份默认行为：
 *
 * 1. **保存中不可关闭**：请求已发出，中途关闭只会让操作者以为没保存成功，
 *    再点一次就是重复提交；
 * 2. **有改动时关闭先确认**：走 `useDiscardConfirm`，与路由跳转用的是同一套
 *    二次确认，不与页面级的「离开提醒」长出两种问法；
 * 3. **页脚固定两枚按钮**：取消 + 主操作，文案由 `submitLabel` 决定，加载态
 *    统一「保存中…」。
 *
 * ## 不用它的场合
 *
 * 只读详情用 `AdminDrawer` / `AdminModal`（它们负责取数与加载态）；批量操作类
 * 抽屉（结果页要换一套按钮）用裸 `Drawer`，因为它的页脚不是「取消 + 保存」。
 */
export function FormDrawer({
  open,
  onClose,
  title,
  description,
  size = 'md',
  busy = false,
  dirty = false,
  formError,
  submitLabel = '保存',
  submitIcon,
  submitDisabled = false,
  onSubmit,
  cancelLabel = '取消',
  extraFooter,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DrawerSize;
  /** 保存请求进行中：禁用页脚且拒绝关闭。 */
  busy?: boolean;
  /** 表单与服务端快照有差异：关闭前先确认。 */
  dirty?: boolean;
  /** 提交失败的原因，渲染在表单顶部。 */
  formError?: string | null;
  submitLabel?: string;
  submitIcon?: ComponentType<{ className?: string }>;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  /** 只读抽屉把「取消」换成「关闭」时用。 */
  cancelLabel?: string;
  /** 主次按钮之外的补充动作（如「删除」）。 */
  extraFooter?: ReactNode;
  children: ReactNode;
}) {
  const confirmDiscard = useDiscardConfirm(dirty && !busy, onClose);

  const requestClose = () => {
    // 请求在途时关闭会让操作者误判结果，直接拒绝
    if (busy) return;
    confirmDiscard();
  };

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      size={size}
      title={title}
      /*
       * 「有未保存修改」原先被三个抽屉塞进 `description`，把真正的说明文字挤掉了；
       * 这里两件事并存：状态在前，说明在后。
       */
      description={
        dirty ? (
          <>
            <span className="font-medium text-warn-text">有未保存修改</span>
            {description ? <> · {description}</> : null}
          </>
        ) : (
          description
        )
      }
      footer={
        <>
          <ActionButton variant="secondary" onClick={requestClose} disabled={busy}>
            {cancelLabel}
          </ActionButton>
          {extraFooter}
          {onSubmit && (
            <ActionButton
              variant="default"
              icon={submitIcon}
              disabled={busy || submitDisabled}
              onClick={onSubmit}
            >
              {busy ? '保存中…' : submitLabel}
            </ActionButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <Notice tone="danger" className="mb-0">
            {formError}
          </Notice>
        )}
        {children}
      </div>
    </Drawer>
  );
}
