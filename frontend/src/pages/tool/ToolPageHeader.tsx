import type { CapabilityDef } from '../../types/api';
import { CapabilityIcon, Tag, Typography } from './components';
import { MODE_LABELS, RUNTIME_LABELS, runtimeOf } from './utils';

const { Title, Paragraph, Text } = Typography;

interface ToolPageHeaderProps {
  def: CapabilityDef;
}

/** 工具页头：能力图标、名称、运行时标签与帮助文案。 */
export function ToolPageHeader({ def }: ToolPageHeaderProps) {
  const runtime = runtimeOf(def);

  return (
    <>
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
            <Tag
              className={`tool-tag-mode tool-tag-${runtime.effective === 'remote' ? 'real' : runtime.effective}`}
            >
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
    </>
  );
}
