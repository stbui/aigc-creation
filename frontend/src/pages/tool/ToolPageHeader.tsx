import type { CapabilityDef } from '../../types/api';
import { CapabilityIcon, Badge } from './components';
import { MODE_LABELS, RUNTIME_LABELS, runtimeOf } from './utils';

interface ToolPageHeaderProps {
  def: CapabilityDef;
}

/** 工具页头：能力图标、名称、运行时标签与帮助文案。 */
export function ToolPageHeader({ def }: ToolPageHeaderProps) {
  const runtime = runtimeOf(def);

  return (
    <>
      <div className="mb-3 flex items-start gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-brand-bg text-brand">
          <CapabilityIcon id={def.id} size={22} />
        </span>
        <div>
          <h3 className="m-0 mb-0.5 flex flex-wrap items-center gap-2 text-xl">
            {def.name}
            {def.badge && (
              <Badge variant="secondary" className="border-0 bg-[color-mix(in_oklab,var(--color-cta)_12%,transparent)] text-[color:var(--color-cta-text)]">
                {def.badge}
              </Badge>
            )}
            {/*
              标注以**运行时结论**为准（云端模型 / 不可用），
              mode 只在后端未下发 runtime 时兜底 —— 同一项能力在不同部署下
              按下去走的路不同，标 mode 会把「没配通道的 real」说成「已接入」。
            */}
            <Badge
              variant="secondary"
              className={`border-0 text-xs ${
                runtime.effective === 'remote'
                  ? 'bg-[color-mix(in_oklab,var(--color-success-text)_12%,transparent)] text-[color:var(--color-success-text)]'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {RUNTIME_LABELS[runtime.effective] ?? MODE_LABELS[def.mode]}
            </Badge>
          </h3>
          <p className="m-0 text-muted-foreground">{def.summary}</p>
        </div>
      </div>

      {def.help && (
        <div className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span>{def.help}</span>
        </div>
      )}
    </>
  );
}