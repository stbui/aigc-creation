import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

import { Button } from './components';

/** 没有任何作品时的引导面板。 */
export function StatsEmptyPanel() {
  const navigate = useNavigate();

  return (
    <article className="stats-panel stats-empty-panel">
      <span className="stats-empty-mark" aria-hidden>
        <Sparkles size={20} />
      </span>
      <div className="stats-empty-copy">
        <h3>从第一次创作开始积累作品</h3>
        <p>去工作台选择一个能力，提交创作后这里会展示你的作品趋势和常用能力。</p>
      </div>
      <Button type="primary" onClick={() => navigate('/workbench')}>
        开始创作
      </Button>
    </article>
  );
}
