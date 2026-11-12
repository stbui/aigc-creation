import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { A, type CaseGroup } from './constants';
import { caseTarget, uniqueCaseFiles } from './utils';

interface LandingCasesProps {
  groups: CaseGroup[];
}

/**
 * 优秀案例：分类平铺长式依次陈列，不切页签。
 *
 * 每个分类按商品去重后只陈列 5 张 —— 访客不必猜「别的能力能不能做」。
 */
export function LandingCases({ groups }: LandingCasesProps) {
  const navigate = useNavigate();

  return (
    <section className="lp-section">
      <div className="lp-cases-head">
        <div>
          <span className="lp-kicker">优秀案例</span>
          <h2>看看工具能做出什么</h2>
        </div>
      </div>
      <div className="lp-case-groups">
        {groups.map((group) => {
          const target = caseTarget(group.key);
          return (
            <article className="lp-case-group" key={group.key}>
              <header className="lp-case-group-head">
                <h3>{group.label}</h3>
                <button type="button" className="lp-text-link" onClick={() => navigate(target)}>
                  做同款
                  <ArrowRight size={14} aria-hidden />
                </button>
              </header>
              <div className="lp-case-strip">
                {uniqueCaseFiles(group.files)
                  .slice(0, 5)
                  .map((file) => (
                    <button
                      key={file}
                      type="button"
                      className="lp-case-card"
                      aria-label={`${group.label}示例，做同款`}
                      onClick={() => navigate(target)}
                    >
                      {/* 按钮已有 aria-label, 图片作为卡面内容不再重复同一句 alt */}
                      <img
                        src={`${A}/case/${file}`}
                        alt=""
                        width={600}
                        height={800}
                        loading="lazy"
                      />
                      <span className="lp-case-label">做同款</span>
                    </button>
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
