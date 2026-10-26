import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Slider,
  Switch,
  Typography,
  Upload,
  App,
  Tag,
} from 'antd';
import type { UploadFile } from 'antd';
import { ArrowLeft, Upload as UploadIcon, Trash2, RefreshCw, Check, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { assetsApi, generateApi, assetSrc } from '../lib/api';
import { capabilityById } from '../lib/capabilities';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { waitForTask } from '../lib/poll';
import {
  IS_PROD,
  MAX_IMAGE_MB,
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
  MODE_LABELS,
  RUNTIME_LABELS,
  runtimeOf,
  taskErrorText,
} from '../lib/constants';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { CapabilityIcon } from '../components/AppLayout';
import { ExceptionPage } from '../components/ExceptionPage';
import { ResultMedia, formatDuration } from '../components/ResultMedia';
import { ProviderBadge } from '../components/ProviderBadge';
import { StateEmpty, StateSkeleton } from '../components/StateViews';
import type { Asset, CapabilityDef, CapabilityParam, Task } from '../types/api';

const { Title, Paragraph, Text } = Typography;

/**
 * 工具页: 一个页面承载全部能力。
 *
 * 表单按后端下发的 params 声明自动渲染 (enum→Select / number→Slider+InputNumber /
 * text→TextArea / boolean→Switch), 因此新增能力不需要在这里加任何分支。
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
   * 可用性判断放在表单组件之外：Form.useForm 一旦创建就必须挂上 <Form>，
   * 在全量不可用/能力不存在时提前 return 会触发 antd 的未连接警告。
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
            : `runtime: ${runtime.effective} · route=${runtime.route} · remoteAvailable=${runtime.remoteAvailable}`
        }
        action={{ to: '/workbench', label: '返回工作台' }}
      />
    );
  }

  return <ToolPageContent key={def.id} capability={capability} def={def} />;
}

function ToolPageContent({ capability, def }: { capability: string; def: CapabilityDef }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const [form] = Form.useForm();

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const pollSignal = usePollAbort();

  const inputs = def.inputs;
  /*
   * 消耗价文案与定制工具页同源。此前通用页**完全不提积分**, 用户点下去
   * 才发现余额少了 —— 同一个能力从不同入口进来, 说辞必须一致。
   */
  const creditLabel = useCreditLabel(capability);

  /*
   * 「从素材库导入」。定制页早就有这个入口, 通用页没有, 于是同一个能力
   * 换个入口就得多走一趟本地文件。onPick 返回 false 表示额度不足,
   * 弹窗保持打开让用户改选。
   */
  const library = useAssetLibrary((asset) => {
    if (assets.length >= inputs) {
      message.warning(`最多 ${inputs} 张`);
      return false;
    }
    if (assets.some((a) => a.id === asset.id)) {
      message.warning('这张素材已经在列表里了');
      return false;
    }
    setAssets((prev) => [...prev, asset]);
    setFileList((prev) => [
      ...prev,
      {
        uid: asset.id,
        name: `素材-${asset.id.slice(0, 6)}.${asset.format}`,
        status: 'done',
        url: assetSrc(asset),
      } as UploadFile,
    ]);
    return true;
  });

  // 切换能力时重置表单与状态 (默认值来自后端声明)
  useEffect(() => {
    form.setFieldsValue(def.defaultParams as Record<string, unknown>);
    setFileList([]);
    setAssets([]);
    setTask(null);
  }, [def.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const originalThumb = assets[0] ? assetSrc(assets[0]) : undefined;
  const runtime = runtimeOf(def);

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
        capability: def.id,
        params,
      });
      const done = await pollTask(taskId);
      if (done.status === 'failed') {
        message.error(`生成失败：${taskErrorText(done.errorCode)}`);
      } else {
        message.success(`${def.name} 已完成`);
      }
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  }

  const resultUrl = task?.outputAsset ? assetSrc(task.outputAsset) : undefined;

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
            {/*
              标注以**运行时结论**为准（云端模型 / 不可用），
              mode 只在后端未下发 runtime 时兜底 —— 同一项能力在不同部署下
              按下去走的路不同，标 mode 会把「没配通道的 real」说成「已接入」。
            */}
            <Tag className={`tool-tag-mode tool-tag-${runtime.effective === 'remote' ? 'real' : runtime.effective}`}>
              {RUNTIME_LABELS[runtime.effective] ?? MODE_LABELS[def.mode]}
            </Tag>
          </Title>
          <Paragraph className="tool-header-sub">{def.summary}</Paragraph>
        </div>
      </div>

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
            accept={SUPPORTED_IMAGE_ACCEPT}
            multiple={inputs > 1}
            maxCount={inputs}
            beforeUpload={(file) => {
              if (!isSupportedImageFile(file)) {
                message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
                return Upload.LIST_IGNORE;
              }
              // 体积上限与定制工具页同源; 超限直接拦下, 不再"传上去再说"
              if (file.size > MAX_IMAGE_BYTES) {
                message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${file.name}`);
                return Upload.LIST_IGNORE;
              }
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
                ≤ {MAX_IMAGE_MB}MB
              </Text>
            </div>
          </Upload>

          <Button type="link" size="small" onClick={library.openLibrary} disabled={submitting}>
            从素材库导入
          </Button>

          <Form form={form} layout="vertical" className="tool-form">
            {/* hidden 的参数由具体页面代填（如遮罩素材 id），通用表单不渲染 */}
            {def.params
              .filter((p) => !p.hidden)
              .map((p) => (
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
            {submitting ? '生成中…' : '立即生成'}
          </Button>
          {creditLabel && <Text type="secondary" className="tool-credit-hint">{creditLabel}</Text>}
        </Card>

        <Card className="tool-result-card" title="生成结果">
          {submitting && !resultUrl ? (
            /* 生成中 → 骨架占位 (与工具页结果栏同构), 不退回空态 */
            <div className="tool-result-loading">
              <StateSkeleton variant="block" count={1} />
              <p className="tool-result-loading-tip">正在生成，请稍候…</p>
            </div>
          ) : resultUrl ? (
            <>
              {/* 视频产出必须用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白预览 */}
              <ResultMedia
                className="tool-result-img"
                url={resultUrl}
                modality={task?.outputAsset?.modality}
                aigc={task?.outputAsset?.aigc}
                alt={def.name}
              />
              <div className="tool-result-meta">
                <div>
                  <Text type="secondary">
                    {task?.outputAsset?.width}×{task?.outputAsset?.height} · {task?.outputAsset?.format}
                    {/* 视频没有宽高 (Jimp 不解视频), 补一个时长 */}
                    {formatDuration(task?.outputAsset?.durationMs)
                      ? ` · ${formatDuration(task?.outputAsset?.durationMs)}`
                      : ''}
                  </Text>
                  {/* 这一单实际走哪条通道, 以 task.provider 为准 */}
                  <ProviderBadge provider={task?.provider} />
                </div>
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
            <StateEmpty
              compact
              title="还没有生成结果"
              desc="上传素材并点击生成后，结果会显示在这里。"
            />
          )}
        </Card>
      </div>

      <AssetLibraryModal
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={library.pick}
        maxSelectable={inputs}
      />
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
        <Form.Item
          name={param.key}
          label={param.label}
          tooltip={param.help}
          rules={
            param.pattern
              ? [{ pattern: new RegExp(param.pattern), message: `${param.label}格式不正确` }]
              : undefined
          }
        >
          <Input.TextArea
            rows={3}
            placeholder={param.placeholder}
            maxLength={param.maxLength ?? 500}
            showCount
          />
        </Form.Item>
      );
  }
}
