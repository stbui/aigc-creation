import { lazy, Suspense } from 'react';
import type { ModelDraft } from './constants';
import type {
  AdminChannelModelView,
  ProtocolTestResultView,
  UpstreamModelPreview,
} from '../../../types/model';

/*
 * 编辑器、上游导入与调价只在用户主动打开时出现。把它们留在初始 chunk 会
 * 把图片能力合同、价格档编辑器等低频表单一起下载；按需加载后，渠道列表和
 * 模型清单可以先渲染，首次打开对应弹窗时再取 form / dialog chunk。
 */
const ChannelModelFormDialog = lazy(() =>
  import('./ChannelModelFormDialog').then((module) => ({
    default: module.ChannelModelFormDialog,
  })),
);
const ChannelModelRepriceDialog = lazy(() =>
  import('./ChannelModelRepriceDialog').then((module) => ({
    default: module.ChannelModelRepriceDialog,
  })),
);
const ChannelOrderDialog = lazy(() =>
  import('./ChannelOrderDialog').then((module) => ({
    default: module.ChannelOrderDialog,
  })),
);
const ChannelUpstreamDialog = lazy(() =>
  import('./ChannelUpstreamDialog').then((module) => ({
    default: module.ChannelUpstreamDialog,
  })),
);

interface ChannelModelDialogsProps {
  channelId: string;
  channelName: string;
  form: {
    open: boolean;
    editing: AdminChannelModelView | null;
    draft: ModelDraft;
    testResult: ProtocolTestResultView | null;
    testing: boolean;
    saving: boolean;
    writable: boolean;
    previousProviderModelKey: string;
    onTest: () => Promise<void>;
    onClose: () => void;
    onSubmit: (draft: ModelDraft) => void;
  };
  upstream: {
    models: UpstreamModelPreview[] | null;
    existingKeys: Set<string>;
    importing: boolean;
    onClose: () => void;
    onImport: (ids: string[]) => void;
  };
  reprice: {
    open: boolean;
    models: AdminChannelModelView[];
    onClose: () => void;
    onSaved: () => Promise<void> | void;
  };
  order: {
    open: boolean;
    onClose: () => void;
    onSaved: () => Promise<void> | void;
  };
}

/**
 * 渠道模型工作台的按需弹窗层。
 *
 * 与详情区平级渲染：调价 / 排序弹窗如果套进详情区内部，React Aria 的嵌套
 * 模态焦点作用域会互相抢，关闭后焦点评回不到触发按钮。表单、上游导入和
 * 两个批量弹窗都只在对应状态打开后才挂载，避免把整套模型编辑器下载到渠道
 * 页面首屏。
 */
export function ChannelModelDialogs({
  channelId,
  channelName,
  form,
  upstream,
  reprice,
  order,
}: ChannelModelDialogsProps) {
  return (
    <>
      {form.open && (
        <Suspense fallback={null}>
          <ChannelModelFormDialog
            open
            editing={form.editing}
            draft={form.draft}
            testResult={form.testResult}
            testing={form.testing}
            saving={form.saving}
            writable={form.writable}
            onTest={form.onTest}
            onClose={form.onClose}
            onSubmit={form.onSubmit}
            previousProviderModelKey={form.previousProviderModelKey}
          />
        </Suspense>
      )}

      {upstream.models !== null && (
        <Suspense fallback={null}>
          <ChannelUpstreamDialog
            open
            models={upstream.models}
            existingKeys={upstream.existingKeys}
            importing={upstream.importing}
            onClose={upstream.onClose}
            onImport={upstream.onImport}
          />
        </Suspense>
      )}

      {reprice.open && channelId && (
        <Suspense fallback={null}>
          <ChannelModelRepriceDialog
            channelId={channelId}
            channelName={channelName}
            models={reprice.models}
            onClose={reprice.onClose}
            onSaved={reprice.onSaved}
          />
        </Suspense>
      )}

      {order.open && channelId && (
        <Suspense fallback={null}>
          <ChannelOrderDialog
            open
            channelId={channelId}
            channelName={channelName}
            onClose={order.onClose}
            onSaved={order.onSaved}
          />
        </Suspense>
      )}
    </>
  );
}
