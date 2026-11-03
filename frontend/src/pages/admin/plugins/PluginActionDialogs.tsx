import { ConfirmAction } from '~/admin-ui/primitives';
import type { PluginView } from '../../../types/model';

/**
 * 插件的三个写操作确认：启停、上传安装、卸载。
 *
 * 审计原因由页面按操作上下文生成；启停与卸载都会立即影响协议注册表，因此确认框里
 * 直接列出影响面，而不是等用户点完再看后端报错。
 */
export function TogglePluginConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: PluginView | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAction
      open={target !== null}
      title={`${target?.enabled ? '停用' : '启用'}插件「${target?.name ?? ''}」？`}
      description="启停会立即重注册协议，已保存的渠道模型不受影响，但下发调用的协议解析会随注册表变化。"
      impact={
        target?.enabled
          ? [
              `该插件当前生效 ${target.activeProtocols} 个协议`,
              '引用这些协议的渠道模型在下一次调用时会失败并退款',
            ]
          : [`启用后重新注册该插件的 ${target?.activeProtocols ?? 0} 个协议`]
      }
      danger={!!target?.enabled}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function InstallPluginConfirm({
  file,
  loading,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAction
      open={file !== null}
      title={`安装插件包「${file?.name ?? ''}」？`}
      description="上传的包会写入独立安装目录（不覆盖内置插件），解析校验通过后立即注册协议。"
      impact={[
        `文件大小 ${file ? (file.size / 1024 / 1024).toFixed(2) : '0'} MB`,
        '与已安装插件同 id 会被拒绝，不做覆盖安装',
        '安装后默认启用，渠道模型可立即选择它的协议',
      ]}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function UninstallPluginConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: PluginView | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAction
      open={target !== null}
      title={`卸载插件「${target?.name ?? ''}」？`}
      description="只会删除上传安装的包；内置插件随代码发布，不能卸载。"
      impact={[
        `该插件当前生效 ${target?.activeProtocols ?? 0} 个协议`,
        '仍有渠道模型引用这些协议时会被拒绝（先去渠道工作台改协议）',
        '卸载后协议从注册表移除，引用它的模型调用会失败并退款',
      ]}
      danger
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
