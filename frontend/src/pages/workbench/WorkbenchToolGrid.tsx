import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CapabilityDef } from '../../types/api';
import { WORKBENCH_ART } from './constants';
import { runtimeOf, toolPath } from './utils';
import { CapabilityIcon } from './components';

/**
 * 工作台工具网格。
 *
 * 卡片全部来自后端下发的 `workbenchIds` + 能力注册表，前端不硬编码任何能力；
 * 运营下线的能力保留位置但不可点，运行时无可用线路的标「暂不可用」。
 */
export interface WorkbenchToolGridProps {
  cards: CapabilityDef[];
}

export function WorkbenchToolGrid({ cards }: WorkbenchToolGridProps) {
  const navigate = useNavigate();

  return (
    <section className="wb-tool-section" aria-label="创作工具">
      <div className="wb-tool-grid">
        {cards.map((c) => {
          const art = WORKBENCH_ART[c.id];
          // 运行时结论：运营下线的能力不可点，占位只在「确实走占位」时才标
          const rt = runtimeOf(c);
          const closed = c.mode === 'planned' || rt.effective === 'disabled';
          const unavailable = rt.effective === 'unavailable';
          return (
            <button
              key={c.id}
              type="button"
              className={`wb-tool-card wb-card-${c.mode}`}
              onClick={() => (closed ? undefined : navigate(toolPath(c.id)))}
              disabled={closed}
              title={
                rt.effective === 'disabled'
                  ? rt.reason || '该能力已下线'
                  : unavailable
                    ? rt.reason || '该能力暂无可用模型通道'
                    : undefined
              }
            >
              <div className={`wb-tool-visual${art ? '' : ' wb-tool-visual--empty'}`}>
                {art ? (
                  <img src={art.image} alt={`${c.name}示例`} loading="lazy" />
                ) : (
                  <CapabilityIcon id={c.id} size={26} />
                )}
              </div>
              <span
                className="wb-tool-icon"
                style={art ? ({ '--wb-tool-icon': `url(${art.icon})` } as CSSProperties) : undefined}
              >
                {art ? <img src={art.icon} alt="" aria-hidden /> : <CapabilityIcon id={c.id} size={22} />}
              </span>
              <div className="wb-tool-copy">
                <div className="wb-tool-title">
                  <strong>{c.name}</strong>
                  {c.badge && <em>{c.badge}</em>}
                  {c.mode === 'planned' && <em>规划中</em>}
                  {c.mode !== 'planned' && rt.effective === 'disabled' && <em>已下线</em>}
                  {c.mode !== 'planned' && rt.effective === 'unavailable' && <em>暂不可用</em>}
                </div>
                {/* 卡片固定高 108px, 描述单行省略; 原句走原生 tooltip 兜底 */}
                <span title={c.summary}>{c.summary}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
