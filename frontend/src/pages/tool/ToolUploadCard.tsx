import { Upload as UploadIcon } from 'lucide-react';

import type { Asset, CapabilityDef } from '../../types/api';
import {
  Button,
  Card,
  Form,
  Typography,
  Upload,
  type FormInstance,
  type UploadFile,
} from './components';
import { MAX_IMAGE_MB, SUPPORTED_IMAGE_ACCEPT } from './utils';
import { ToolParamField } from './ToolParamField';

const { Text } = Typography;

interface ToolUploadCardProps {
  def: CapabilityDef;
  form: FormInstance;
  inputs: number;
  creditLabel: string | null;
  fileList: UploadFile[];
  assets: Asset[];
  generating: boolean;
  uploadingCount: number;
  beforeUpload: (file: File) => boolean | string;
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
  fileList,
  assets,
  generating,
  uploadingCount,
  beforeUpload,
  onRemoveFile,
  onOpenLibrary,
  onSubmit,
}: ToolUploadCardProps) {
  const busy = generating || uploadingCount > 0;

  return (
    <Card className="tool-form-card" title={inputs > 1 ? '输入素材' : '上传商品图'}>
      <Upload
        listType="picture-card"
        fileList={fileList}
        accept={SUPPORTED_IMAGE_ACCEPT}
        multiple={inputs > 1}
        maxCount={inputs}
        disabled={generating}
        beforeUpload={beforeUpload}
        onRemove={onRemoveFile}
      >
        <div className="tool-upload-trigger">
          <UploadIcon size={20} />
          <span>上传图片</span>
          <Text type="secondary" className="tool-upload-hint">
            ≤ {MAX_IMAGE_MB}MB
          </Text>
        </div>
      </Upload>

      <Button type="link" size="small" onClick={onOpenLibrary} disabled={busy}>
        从素材库导入
      </Button>

      <Form form={form} layout="vertical" className="tool-form">
        {/* hidden 的参数由具体页面代填（如遮罩素材 id），通用表单不渲染 */}
        {def.params
          .filter((param) => !param.hidden)
          .map((param) => (
            <ToolParamField key={param.key} param={param} />
          ))}
      </Form>

      <Button
        type="primary"
        size="large"
        block
        loading={generating}
        disabled={busy || assets.length < inputs}
        onClick={onSubmit}
        className="tool-submit"
      >
        {generating ? '生成中…' : uploadingCount > 0 ? '上传中…' : '立即生成'}
      </Button>
      {creditLabel && (
        <Text type="secondary" className="tool-credit-hint">
          {creditLabel}
        </Text>
      )}
    </Card>
  );
}
