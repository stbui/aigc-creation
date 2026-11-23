import { Upload as UploadIcon } from 'lucide-react';

import type { Asset, CapabilityDef } from '../../types/api';
import {
  Button,
  Form,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Upload,
  type FormInstance,
  type UploadFile,
} from './components';
import { ToolParamField } from './ToolParamField';
import { useUploadLimits } from '../../context/UploadLimitsContext';


interface ToolUploadCardProps {
  def: CapabilityDef;
  form: FormInstance;
  inputs: number;
  creditLabel: string | null;
  files: UploadFile[];
  assets: Asset[];
  generating: boolean;
  uploadingCount: number;
  onSelect: (file: File) => boolean | Promise<boolean>;
  onRemoveFile: (file: UploadFile) => void;
  onOpenLibrary: () => void;
  onSubmit: () => void;
}

/** 左栏：上传、素材库入口、参数表单与提交按钮。 */
export function ToolUploadCard({
  def,
  form,
  inputs,
  creditLabel,
  files,
  assets,
  generating,
  uploadingCount,
  onSelect,
  onRemoveFile,
  onOpenLibrary,
  onSubmit,
}: ToolUploadCardProps) {
  const busy = generating || uploadingCount > 0;
  const { accept, maxMb } = useUploadLimits();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{inputs > 1 ? '输入素材' : '上传商品图'}</CardTitle>
      </CardHeader>
      <CardContent>
      <Upload
        files={files}
        accept={accept}
        multiple={inputs > 1}
        maxCount={inputs}
        disabled={generating}
        onSelect={onSelect}
        onRemove={onRemoveFile}
      >
        <div className="flex flex-col items-center gap-1 text-[13px] text-muted-foreground">
          <UploadIcon size={20} />
          <span>上传图片</span>
          <span className="text-xs">≤ {maxMb}MB</span>
        </div>
      </Upload>

      <Button variant="link" size="sm" onClick={onOpenLibrary} disabled={busy}>
        从素材库导入
      </Button>

      <Form {...form}>
        <form className="mt-3.5" onSubmit={(event) => event.preventDefault()} noValidate>
          {/* hidden 的参数由具体页面代填（如遮罩素材 id），通用表单不渲染 */}
          {def.params
            .filter((param) => !param.hidden)
            .map((param) => (
              <ToolParamField key={param.key} param={param} />
            ))}
        </form>
      </Form>

      {/* 品牌色主 CTA：`bg-primary` 本身就是 `--brand`，这里只补字重、字距
          与置灰态（置灰用浅紫底 + 品牌字，与旧样式表一致）。 */}
      <Button
        size="lg"
        className="w-full font-semibold tracking-[0.125em] disabled:bg-brand-bg disabled:text-brand"
        disabled={busy || assets.length < inputs || generating}
        onClick={onSubmit}
      >
        {busy && <span className="state-spinner is-small" aria-hidden />}
        {generating ? '生成中…' : uploadingCount > 0 ? '上传中…' : '立即生成'}
      </Button>
      {creditLabel && (
        <span className="mt-2 block text-center text-xs text-muted-foreground">
          {creditLabel}
        </span>
      )}
    </CardContent>
    </Card>
  );
}
