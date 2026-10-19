import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Result,
  Select,
  Slider,
  Switch,
  Typography,
  Upload,
  App,
  Spin,
  Tag,
  Empty,
} from 'antd';
import type { UploadFile } from 'antd';
import { ArrowLeft, Upload as UploadIcon, Trash2, RefreshCw, Check, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { assetsApi, generateApi, toAbsoluteUrl } from '../lib/api';
import { capabilityById } from '../lib/capabilities';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { waitForTask } from '../lib/poll';
import { MODE_LABELS, MOCK_NOTICE } from '../lib/constants';
import { CapabilityIcon } from '../components/AppLayout';
import type { Asset, CapabilityParam, Task } from '../types/api';

const { Title, Paragraph, Text } = Typography;

/**
 * 工具页: 一个页面承载全部能力。
 *
 * 表单按后端下发的 params 声明自动渲染 (enum→Select / number→Slider+InputNumber /
 * text→TextArea / boolean→Switch), 因此新增能力不需要在这里加任何分支。
 */
export function ToolPage() {
  const { capability = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const def = capabilityById(capability);
  const { ensureProject } = useProject();
  const [form] = Form.useForm();

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const pollSignal = usePollAbort();

  const inputs = def?.inputs ?? 1;

  // 切换能力时重置表单与状态 (默认值来自后端声明)
  useEffect(() => {
    if (!def) return;
    form.setFieldsValue(def.defaultParams as Record<string, unknown>);
    setFileList([]);
    setAssets([]);
    setTask(null);
  }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const originalThumb = assets[0] ? toAbsoluteUrl(assets[0].sourceUrl) : undefined;

  if (!def) {
    return <Result status="404" title="能力不存在" subTitle={`未找到能力: ${capability}`} />;
  }

  if (def.mode === 'planned') {
    return (
      <Result
        status="info"
        title={`${def.name} 规划中`}
        subTitle="该能力已在产品路线中占位，尚未接入实现"
        extra={
          <Button type="primary" onClick={() => navigate('/workbench')}>
            返回工作台
          </Button>
        }
      />
    );
  }

  async function doUpload(file: File): Promise<Asset> {
    const projectId = await ensureProject();
    const res = await assetsApi.upload(file, projectId);
    return res;
  }

  async function pollTask(taskId: string) {
    const outcome = await waitForTask(taskId, { signal: pollSignal, onTick: setTask });
    if (!outcome.ok) throw new Error('生成超时');
    return outcome.task;
  }

  async function onSubmit() {
    if (fileList.length < inputs) {
      message.warning(`请先上传 ${inputs} 张图片`);
      return;
    }
    setSubmitting(true);
    setTask(null);
    try {
      const params = form.getFieldsValue();
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        inputAssetIds: assets.map((a) => a.id),
        capability: def!.id,
        params,
      });
      const done = await pollTask(taskId);
      if (done.status === 'failed') {
        message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      } else {
        message.success(`${def!.name} 已完成`);
      }
    } catch (e) {
      message.error((e as Error).message || '生成失败');
    } finally {
      setSubmitting(false);
    }
  }

  const resultUrl = task?.outputAsset ? toAbsoluteUrl(task.outputAsset.sourceUrl) : undefined;

  return (
    <div className="tool-page">
      <Button type="text" icon={<ArrowLeft size={15} />} onClick={() => navigate('/workbench')} className="tool-back">
        返回工作台
      </Button>

      <div className="tool-header">
        <span className="tool-header-icon">
          <CapabilityIcon id={def.id} size={22} />
        </span>
        <div>
          <Title level={3} className="tool-header-title">
            {def.name}
            {def.badge && <Tag className="tool-tag-free">{def.badge}</Tag>}
            <Tag className={`tool-tag-mode tool-tag-${def.mode}`}>{MODE_LABELS[def.mode]}</Tag>
          </Title>
          <Paragraph className="tool-header-sub">{def.summary}</Paragraph>
        </div>
      </div>

      {def.mode === 'mock' && (
        <div className="tool-notice">
          <Text>{MOCK_NOTICE}</Text>
        </div>
      )}
      {def.help && (
        <div className="tool-notice tool-notice-help">
          <Text type="secondary">{def.help}</Text>
        </div>
      )}

      <div className="tool-body">
        <Card className="tool-form-card" title={inputs > 1 ? '输入素材' : '上传商品图'}>
          <Upload
            listType="picture-card"
            fileList={fileList}
            accept="image/png,image/jpeg,image/webp"
            multiple={inputs > 1}
            maxCount={inputs}
            beforeUpload={(file) => {
              setSubmitting(true);
              doUpload(file)
                .then((asset) => {
                  setAssets((prev) => [...prev, asset]);
                  setFileList((prev) => [...prev, file]);
                  message.success(`${file.name} 上传成功`);
                })
                .catch((e: Error) => message.error(e.message || '上传失败'))
                .finally(() => setSubmitting(false));
              return false; // 阻止 antd 自动请求, 走自己的上传逻辑
            }}
            onRemove={(f) => {
              const idx = fileList.findIndex((x) => x.uid === f.uid);
              if (idx >= 0) setAssets((prev) => prev.filter((_, i) => i !== idx));
              setFileList((prev) => prev.filter((x) => x.uid !== f.uid));
            }}
          >
            <div className="tool-upload-trigger">
              <UploadIcon size={20} />
              <span>上传图片</span>
              <Text type="secondary" className="tool-upload-hint">
                ≤ 20MB
              </Text>
            </div>
          </Upload>

          <Form form={form} layout="vertical" className="tool-form">
            {def.params.map((p) => (
              <ParamField key={p.key} param={p} />
            ))}
          </Form>

          <Button
            type="primary"
            size="large"
            block
            loading={submitting}
            disabled={assets.length < inputs}
            onClick={onSubmit}
            className="tool-submit"
          >
            {submitting ? '生成中…' : '生 成'}
          </Button>
        </Card>

        <Card className="tool-result-card" title="生成结果">
          {submitting && !resultUrl ? (
            <div className="tool-result-loading">
              <Spin tip="生成中…" />
            </div>
          ) : resultUrl ? (
            <>
              <img className="tool-result-img" src={resultUrl} alt={def.name} />
              <div className="tool-result-meta">
                <Text type="secondary">
                  {task?.outputAsset?.width}×{task?.outputAsset?.height} · {task?.outputAsset?.format}
                </Text>
                <div className="tool-result-actions">
                  <Button
                    size="small"
                    icon={<RefreshCw size={13} />}
                    onClick={onSubmit}
                    loading={submitting}
                  >
                    重新生成
                  </Button>
                  <Button
                    size="small"
                    icon={<Trash2 size={13} />}
                    onClick={() => {
                      setTask(null);
                      message.info('已清空当前结果，素材仍保留在素材库');
                    }}
                  >
                    清空
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <Empty description="上传素材并点击生成后，结果会显示在这里" />
          )}
        </Card>
      </div>
    </div>
  );
}

/** 按参数声明渲染单个表单项 */
function ParamField({ param }: { param: CapabilityParam }) {
  switch (param.type) {
    case 'enum':
      return (
        <Form.Item name={param.key} label={param.label} tooltip={param.help}>
          <Radio.Group optionType="button" buttonStyle="solid">
            {(param.options ?? []).map((o) => (
              <Radio.Button key={String(o.value)} value={o.value}>
                {o.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>
      );
    case 'number':
      // Slider 与 InputNumber 共享同一个字段: 不能都塞进带 name 的 Form.Item
      // (antd 只会把值注入其中一个), 改为受控读写表单状态, 保证两边同步。
      return (
        <Form.Item
          label={param.label}
          tooltip={param.help}
          shouldUpdate={(prev, next) => prev[param.key] !== next[param.key]}
          noStyle
        >
          {({ getFieldValue, setFieldsValue }) => (
            <div className="tool-param-field">
              <span className="tool-param-label">{param.label}</span>
              <div className="tool-param-number">
                <Slider
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={getFieldValue(param.key) as number}
                  onChange={(v) => setFieldsValue({ [param.key]: v })}
                  tooltip={{ formatter: (v) => String(v) }}
                />
                <InputNumber
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={getFieldValue(param.key) as number}
                  onChange={(v) => setFieldsValue({ [param.key]: v })}
                />
              </div>
            </div>
          )}
        </Form.Item>
      );
    case 'boolean':
      return (
        <Form.Item name={param.key} label={param.label} valuePropName="checked" tooltip={param.help}>
          <Switch />
        </Form.Item>
      );
    case 'text':
    default:
      return (
        <Form.Item name={param.key} label={param.label} tooltip={param.help}>
          <Input.TextArea rows={3} placeholder={param.placeholder} maxLength={500} showCount />
        </Form.Item>
      );
  }
}
