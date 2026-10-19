import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { generateApi, toAbsoluteUrl } from '../lib/api';
import type { Task } from '../types/api';

/**
 * 历史记录区 —— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前只长在 ToolShell 内部，导致 ProductKit / ProductDetail /
 * ViralClone / FreeCreation / MultiFusion 五个自建页**都没有历史记录**（功能缺失，
 * 不只是代码重复）。抽出后五页接上，数据源与 ToolShell 完全一致。
 *
 * 数据为真实任务（`GET /tasks` 按能力过滤取最近 12 条），不是占位。
 */
export function ToolHistoryPanel({ capability, refreshKey }: { capability: string; refreshKey?: unknown }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Task[]>([]);

  useEffect(() => {
    let alive = true;
    generateApi
      .list()
      .then((all) => {
        if (!alive) return;
        setHistory(all.filter((t) => t.capability === capability).slice(0, 12));
      })
      .catch(() => {
        if (alive) setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, [capability, refreshKey]);

  return (
    <section className="pk-config-card tool-history-card">
      <button type="button" className="tool-history-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <strong className="pk-section-title">历史记录</strong>
        <ChevronDown size={14} className={`tool-history-chevron${open ? ' tool-history-chevron-open' : ''}`} />
      </button>
      {open && (
        <div className="tool-history-body">
          {history.length === 0 ? (
            <p className="tool-history-empty">暂无该工具的历史记录</p>
          ) : (
            <div className="tool-history-grid">
              {history.map((t) => (
                <div key={t.id} className="tool-history-item">
                  {t.outputAsset ? (
                    <img src={toAbsoluteUrl(t.outputAsset.sourceUrl)} alt={t.id} loading="lazy" />
                  ) : (
                    <span className="tool-history-failed">{t.status === 'failed' ? '失败' : '进行中'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}