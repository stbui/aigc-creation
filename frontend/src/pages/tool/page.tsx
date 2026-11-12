import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import type { CapabilityDef } from '../../types/api';
import { AssetLibraryModal, Button, ExceptionPage, Form } from './components';
import { useDocumentMeta, useToolPageTask } from './hooks';
import { IS_PROD, capabilityById, runtimeOf, toolPath } from './utils';
import { ToolPageHeader } from './ToolPageHeader';
import { ToolResultCard } from './ToolResultCard';
import { ToolUploadCard } from './ToolUploadCard';

/**
 * 工具页: 一个页面承载全部能力。
 *
 * 表单按后端下发的 params 声明自动渲染 (enum→Select / number→Slider+InputNumber /
 * text→TextArea / boolean→Switch), 因此新增能力不需要在这里加任何分支。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：页头 `ToolPageHeader`、
 * 上传与参数 `ToolUploadCard`（单项 `ToolParamField`）、结果 `ToolResultCard`；
 * 上传 / 建任务 / 轮询状态落 `hooks.ts` 的 `useToolPageTask`。
 */
export function ToolPage() {
  const { capability = '' } = useParams();
  const def = capabilityById(capability);

  if (!def) {
    return (
      <ExceptionPage
        kind="not-found"
        title="工具不存在"
        desc={`没有找到标识为 ${capability} 的能力，可能是链接已失效，或后端尚未下发该能力。`}
        detail={`requested capability: ${capability}`}
        action={{ to: '/workbench', label: '返回工作台' }}
      />
    );
  }

  /*
   * 有独立工作台页的能力, 通用工具页不再承接。
   *
   * `/tools/:capability` 是**兜底**路由。商品主图、带货图文等复刻了独立页面的
   * 能力, 直接给用户看通用表单既不是设计意图, 也会出现「同一个能力两个页面
   * 长得完全不一样」。这里按 `toolPath()` 的同一份映射重定向 ——
   * 映射只维护在 `lib/capabilities.ts` 一处, 本页不重复判断。
   */
  const canonical = toolPath(def.id);
  if (canonical !== `/tools/${def.id}`) {
    return <Navigate to={canonical} replace />;
  }

  if (def.mode === 'planned') {
    return (
      <ExceptionPage
        kind="info"
        title={`${def.name} 规划中`}
        desc="该能力已在产品路线中占位，尚未接入实现。可以先回工作台看看其他已可用的工具。"
        action={{ to: '/workbench', label: '返回工作台' }}
      />
    );
  }

  /*
   * 运行时结论（2026-10-21）。`planned` 已在上方拦掉，这里处理运营侧的
   * 下线与「模型通道没配」两种情况 —— 两者的共同点是
   * **按下去必然失败**，所以直接换成说明页，而不是让用户上传完图才收到报错。
   *
   * 可用性判断放在表单组件之外：`Form.useForm` 一旦创建就必须挂上 <Form>，
   * 在全量不可用/能力不存在时提前 return 会触发未连接警告。
   */
  const runtime = runtimeOf(def);
  const blocked = runtime.effective === 'disabled' || runtime.effective === 'unavailable';
  if (blocked) {
    return (
      <ExceptionPage
        kind="info"
        title={`${def.name}${runtime.effective === 'disabled' ? ' 已下线' : ' 暂不可用'}`}
        desc={runtime.reason || '该能力当前不可提交，请稍后再试或联系客服。'}
        detail={
          IS_PROD
            ? undefined
            : `runtime: ${runtime.effective} · remoteAvailable=${runtime.remoteAvailable}`
        }
        action={{ to: '/workbench', label: '返回工作台' }}
      />
    );
  }

  return <ToolPageContent key={def.id} def={def} />;
}

function ToolPageContent({ def }: { def: CapabilityDef }) {
  useDocumentMeta(`${def.name} · 货觉AI`, def.summary);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const state = useToolPageTask(def, form);

  return (
    <div className="tool-page">
      <Button
        type="text"
        icon={<ArrowLeft size={15} />}
        onClick={() => navigate('/workbench')}
        className="tool-back"
      >
        返回工作台
      </Button>

      <ToolPageHeader def={def} />

      <div className="tool-body">
        <ToolUploadCard
          def={def}
          form={form}
          inputs={state.inputs}
          creditLabel={state.creditLabel}
          fileList={state.fileList}
          assets={state.assets}
          generating={state.generating}
          uploadingCount={state.uploadingCount}
          beforeUpload={state.beforeUpload}
          onRemoveFile={state.removeFile}
          onOpenLibrary={state.library.openLibrary}
          onSubmit={() => void state.onSubmit()}
        />

        <ToolResultCard
          name={def.name}
          generating={state.generating}
          resultUrl={state.resultUrl}
          task={state.task}
          onRegenerate={() => void state.onSubmit()}
          onClear={state.clearResult}
        />
      </div>

      <AssetLibraryModal
        open={state.library.open}
        loading={state.library.loading}
        items={state.library.items}
        error={state.library.error}
        onCancel={state.library.closeLibrary}
        onPick={state.library.pick}
        maxSelectable={Math.max(0, state.inputs - state.assets.length)}
      />
    </div>
  );
}
