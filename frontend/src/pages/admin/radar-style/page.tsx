import { useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FlaskConical,
  Layers,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Stethoscope,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import '../../../styles/radar-admin.css';
import {
  Button,
  CodeChip,
  Drawer,
  KindBadge,
  ObtainBadge,
  Panel,
  ScoreBadge,
  SheetModal,
  Toast,
} from '../../../admin-ui/radar';

/**
 * 中性风格后台示例页（freebie-radar 设计语言落地演示）。
 *
 * 本页刻意独立于产品品牌紫 / shadcn 后台：使用 radar-* 命名空间令牌与原语
 * （Panel / Button / Badge / Drawer / SheetModal / Toast），零阴影、细线、颜色编码语义。
 * 仅作为设计系统验证页；接入后台外壳后可在「系统 → 中性风格示例」进入。
 */

type Tab = 'rules' | 'ai' | 'push' | 'ops';
const TABS: { key: Tab; label: string; icon: typeof Bell }[] = [
  { key: 'rules', label: '订阅与屏蔽', icon: ShieldBan },
  { key: 'ai', label: 'AI 引擎', icon: Bot },
  { key: 'push', label: '多路由推送', icon: Send },
  { key: 'ops', label: '数据源运维', icon: Database },
];

export function AdminRadarStylePage() {
  const [tab, setTab] = useState<Tab>('rules');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1900);
  };
  const onCopyCode = (code: string) => {
    setCopiedCode(code);
    showToast('兑换码已复制');
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-5">
      {/* 页头 */}
      <div className="mb-4 flex items-end justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-radar-brand-subtle text-radar-accent">
            <Radar className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold text-radar-ink-950">中性风格后台示例</h1>
            <p className="text-[12.5px] text-radar-ink-500">
              freebie-radar 设计语言落地：中性灰 + 墨黑 + 零阴影 + 细线 + 颜色编码语义
            </p>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 rounded-md bg-radar-surface-muted px-2 py-1 text-[11px] font-medium text-radar-ink-600 sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5 text-radar-deal" /> 设计验证页
        </span>
      </div>

      {/* 内部 Tab 导航（中性分段控件） */}
      <div className="mb-5 flex flex-wrap gap-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                'inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                (active
                  ? 'bg-radar-ink-100 text-radar-ink-950'
                  : 'text-radar-ink-600 hover:bg-radar-ink-100')
              }
            >
              <Icon className="h-3.5 w-3.5 -translate-y-px" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'rules' && (
        <RulesPanel
          onOpenModal={() => setModalOpen(true)}
          onOpenDrawer={() => {
            setDrawerOpen(true);
            showToast('已加载拦截预览');
          }}
        />
      )}
      {tab === 'ai' && <AiPanel onToast={showToast} />}
      {tab === 'push' && <PushPanel onToast={showToast} />}
      {tab === 'ops' && <OpsPanel onToast={showToast} />}

      {/* 抽屉：详情 / 拦截预览 */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="LINUX DO · 福利羊毛"
        footer={
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex min-w-full flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-radar-brand px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-radar-brand-hover sm:min-w-0 sm:py-2">
              <ArrowUpRight className="h-4 w-4" /> 打开原帖领取
            </a>
            <button className="inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2.5 text-[13px] text-radar-ink-700 transition-colors hover:bg-radar-ink-100 sm:grow-0 sm:basis-auto sm:py-2">
              <Star className="h-4 w-4" /> 收藏
            </button>
            <button
              onClick={() => {
                setDrawerOpen(false);
                setModalOpen(true);
              }}
              className="inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-[8px] border border-radar-alert-border bg-radar-alert-subtle px-3 py-2.5 text-[13px] text-radar-alert transition-colors hover:bg-red-100/80 sm:grow-0 sm:basis-auto sm:py-2"
            >
              <ShieldAlert className="h-4 w-4" /> 屏蔽
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <KindBadge kind="freebie" />
          <span className="rounded bg-radar-brand-subtle px-2 py-0.5 font-medium text-radar-accent">免费</span>
          <span className="rounded bg-radar-ink-100 px-2 py-0.5 font-mono text-radar-ink-700">评分 92</span>
        </div>
        <h2 className="mt-2 text-[17px] font-semibold leading-snug text-radar-ink-950">
          Epic 本周喜加一：某 3A 大作限免领取
        </h2>
        <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-radar-deal-border bg-radar-deal-subtle/70 px-3.5 py-2.5 text-[12.5px] text-emerald-900">
          <Sparkles className="h-3.5 w-3.5 text-radar-deal" />
          <span>
            <strong>AI 判定：</strong>可领取福利 · 直接白嫖，高价值
          </span>
        </div>
        <div className="mt-3 rounded-[8px] border border-radar-code-border bg-radar-code-subtle/70 p-3.5">
          <div className="mb-2 text-[12px] font-medium text-amber-900">提取到的兑换码（点击复制）</div>
          <div className="flex flex-wrap gap-2">
            <CodeChip code="FREE-EPIC-XXXX" onCopy={onCopyCode} />
          </div>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-radar-ink-700">
          本周 Epic 商城限时免费，领取后永久入库。需在截止前登录账号兑换，过期不可补。
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 rounded-[8px] border border-radar-ink-200 bg-radar-surface-hover p-3.5 text-[12px]">
          <div>
            <dt className="text-radar-ink-500">发布时间</dt>
            <dd className="mt-0.5 font-mono text-radar-ink-900">2026-11-15 07:30</dd>
          </div>
          <div>
            <dt className="text-radar-ink-500">截止时间</dt>
            <dd className="mt-0.5 font-mono text-radar-ink-900">2026-11-22 23:59</dd>
          </div>
        </dl>
      </Drawer>

      {/* 弹窗：快捷屏蔽（移动端底部 sheet / 桌面居中） */}
      <SheetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="屏蔽处理"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-[8px] border border-radar-ink-200 px-3 py-2 text-[12.5px] text-radar-ink-600 transition-colors hover:bg-radar-ink-100"
            >
              仅隐藏这一条
            </button>
            <button
              onClick={() => {
                setModalOpen(false);
                showToast('已加入屏蔽规则');
              }}
              className="rounded-[8px] bg-radar-alert px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-red-700"
            >
              加入屏蔽规则
            </button>
          </>
        }
      >
        <p className="mb-3 line-clamp-2 rounded-[8px] border border-radar-ink-200 bg-radar-surface-hover p-2.5 text-[12.5px] text-radar-ink-700">
          求一个 Netflix 拼车车位，长期稳定优先
        </p>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] text-radar-ink-500">点选标题关键词快速加入屏蔽：</div>
            <div className="flex flex-wrap gap-1.5">
              <button className="rounded-[8px] border border-radar-ink-200 bg-radar-surface px-2 py-1 text-[12px] text-radar-ink-700 hover:bg-radar-ink-100">
                Netflix
              </button>
              <button className="rounded-[8px] border border-radar-alert-border bg-radar-alert-subtle px-2 py-1 text-[12px] font-medium text-radar-alert">
                拼车
              </button>
              <button className="rounded-[8px] border border-radar-ink-200 bg-radar-surface px-2 py-1 text-[12px] text-radar-ink-700 hover:bg-radar-ink-100">
                车位
              </button>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] text-radar-ink-500">屏蔽关键词</span>
            <input
              defaultValue="拼车"
              className="w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
          </label>
          <div className="flex flex-col gap-2 text-[12px] sm:flex-row">
            <button className="flex-1 truncate rounded-[8px] border border-radar-ink-200 px-2.5 py-2.5 text-left text-radar-ink-600 hover:bg-radar-ink-100 sm:py-2">
              全部来源屏蔽
            </button>
            <button className="flex-1 truncate rounded-[8px] border border-radar-alert-border bg-radar-alert-subtle px-2.5 py-2.5 text-left font-medium text-radar-alert sm:py-2">
              仅对该来源生效
            </button>
          </div>
        </div>
      </SheetModal>

      <Toast message={toast} />
    </div>
  );
}

/* ───────────────────────── 面板：订阅与屏蔽 ───────────────────────── */

function RulesPanel({
  onOpenModal,
  onOpenDrawer,
}: {
  onOpenModal: () => void;
  onOpenDrawer: () => void;
}) {
  const subs = ['epic', 'claude', '域名'];
  const rules = [
    { pattern: '拼车', mode: '关键词' as const, scope: '全部', hits: 128, on: true },
    { pattern: '二手出鸡', mode: '关键词' as const, scope: '全部', hits: 56, on: false },
    { pattern: '\\bVPN\\b', mode: '正则' as const, scope: 'news', hits: 9, on: true },
  ];
  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-radar-ink-950">订阅与屏蔽</h2>
          <p className="mt-0.5 text-[12.5px] text-radar-ink-500">
            关注词亮起提醒；屏蔽词防火墙在采集入库与推送前统一拦截，无需两处配置。
          </p>
        </div>
        <Button variant="danger" onClick={onOpenModal}>
          <ShieldAlert className="h-4 w-4" /> 快捷屏蔽
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel className="space-y-4 p-5 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14.5px] font-semibold text-radar-ink-950">
              <Bell className="h-4 w-4 text-radar-accent" /> 我的关注关键词
            </div>
            <span className="rounded-md bg-radar-ink-100 px-2 py-0.5 font-mono text-[11px] font-medium text-radar-ink-700">
              {subs.length} 个
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-radar-ink-500">
            标题或摘要命中时列表自动亮起，可在推送页开启「订阅命中优先直推」。
          </p>
          <div className="flex gap-2">
            <input
              placeholder="例如：epic / Claude / 域名…"
              className="min-w-0 flex-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
            <Button variant="default">
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
          <div className="divide-y divide-radar-ink-100 rounded-[8px] border border-radar-ink-200 bg-radar-surface">
            {subs.map((s) => (
              <div key={s} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
                <span className="font-medium text-radar-ink-900">{s}</span>
                <button className="rounded-lg p-1 text-radar-ink-400 transition-colors hover:bg-radar-alert-subtle hover:text-radar-alert">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="space-y-4 p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[14.5px] font-semibold text-radar-ink-950">
              <ShieldBan className="h-4 w-4 text-radar-alert" /> 屏蔽词防火墙
            </div>
            <button className="inline-flex items-center gap-1 rounded-[8px] border border-radar-ink-200 px-2.5 py-1.5 text-[12px] font-medium text-radar-ink-700 hover:bg-radar-ink-100">
              <Download className="h-3.5 w-3.5" /> 导入预设
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="关键词或正则…"
              className="min-w-0 flex-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
            <div className="inline-flex overflow-hidden rounded-[8px] border border-radar-ink-200">
              <span className="bg-radar-surface px-3 py-2 text-[12.5px] font-medium text-radar-ink-900">关键词</span>
              <span className="bg-radar-ink-100 px-3 py-2 text-[12.5px] font-medium text-radar-ink-500">正则</span>
            </div>
            <Button variant="default">
              <Plus className="h-4 w-4" /> 添加规则
            </Button>
          </div>
          <div className="overflow-hidden rounded-[8px] border border-radar-ink-200">
            <table className="w-full text-[12.5px]">
              <thead className="bg-radar-surface-muted text-radar-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">规则</th>
                  <th className="px-3 py-2 text-left font-medium">类型</th>
                  <th className="px-3 py-2 text-left font-medium">范围</th>
                  <th className="px-3 py-2 text-right font-medium">命中</th>
                  <th className="px-3 py-2 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-radar-ink-100">
                {rules.map((r) => (
                  <tr key={r.pattern} className="hover:bg-radar-surface-hover">
                    <td className="px-3 py-2.5 font-mono text-radar-ink-900">{r.pattern}</td>
                    <td className="px-3 py-2.5 text-radar-ink-600">{r.mode}</td>
                    <td className="px-3 py-2.5 text-radar-ink-600">{r.scope}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-radar-ink-500">{r.hits}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.on ? (
                        <span className="inline-flex items-center gap-1 rounded bg-radar-deal-subtle px-1.5 py-0.5 text-[11px] font-medium text-radar-deal">
                          <CheckCircle2 className="h-3 w-3" /> 启用
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-radar-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-radar-ink-500">
                          停用
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={onOpenDrawer}
            className="text-[12.5px] font-medium text-radar-accent hover:underline"
          >
            查看拦截预览 →
          </button>
        </Panel>
      </div>
    </div>
  );
}

/* ───────────────────────── 面板：AI 引擎 ───────────────────────── */

function AiPanel({ onToast }: { onToast: (m: string) => void }) {
  const recent = [
    { title: 'Epic 本周喜加一：XXX 限免领取', kind: 'freebie', score: 5, keep: true },
    { title: '求一个 Netflix 拼车车位', kind: 'noise', score: 0, keep: false },
  ];
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-radar-ink-950">AI 语义审核引擎</h2>
        <p className="mt-0.5 text-[12.5px] text-radar-ink-500">
          任意 OpenAI 兼容接口，单次输出 keep / kind / category / obtain / quality 与中文理由。
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <Panel className="space-y-4 p-5 lg:col-span-7">
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: '保留', v: '1204', c: 'text-radar-deal' },
              { l: '拒绝', v: '312', c: 'text-radar-alert' },
              { l: '待审', v: '17', c: 'text-radar-ink-700' },
            ].map((s) => (
              <div key={s.l} className="rounded-[8px] border border-radar-ink-200 bg-radar-surface p-3">
                <div className="text-[11.5px] text-radar-ink-500">{s.l}</div>
                <div className={'mt-1 font-mono text-[20px] font-semibold ' + s.c}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="radar-pop-enter rounded-[8px] border border-radar-brand-border bg-radar-brand-subtle p-4">
            <div className="mb-2 flex items-center justify-between text-[12.5px]">
              <span className="inline-flex items-center gap-1.5 font-medium text-radar-accent">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-radar-accent opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-radar-accent" />
                </span>
                补审队列 · OpenRouter
              </span>
              <span className="font-mono text-radar-ink-600">86 / 120</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-radar-ink-200">
              <div className="h-full rounded-full bg-radar-accent" style={{ width: '71.6%' }} />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-semibold text-radar-ink-900">最近审核</div>
            <div className="divide-y divide-radar-ink-100 rounded-[8px] border border-radar-ink-200">
              {recent.map((r) => (
                <div key={r.title} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
                  <span
                    className={
                      'h-[6px] w-[6px] shrink-0 rounded-full ' +
                      (r.keep ? 'bg-radar-deal' : 'bg-radar-alert')
                    }
                  />
                  <span
                    className={
                      'min-w-0 flex-1 truncate ' +
                      (r.keep ? 'text-radar-ink-900' : 'text-radar-ink-500 line-through')
                    }
                  >
                    {r.title}
                  </span>
                  <KindBadge kind={r.kind} />
                  <span className="font-mono text-radar-deal">
                    {r.keep ? `★${r.score}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="space-y-4 p-5 lg:col-span-5">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-radar-ink-950">
            <SlidersHorizontal className="h-4 w-4 text-radar-accent" /> 引擎配置
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] text-radar-ink-500">Base URL</span>
            <input
              defaultValue="https://api.openai.com/v1"
              className="w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-radar-ink-500">API Key</span>
            <input
              type="password"
              defaultValue="sk-••••••••"
              className="w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-radar-ink-500">模型</span>
            <input
              defaultValue="gpt-4o-mini"
              className="w-full rounded-[8px] border border-radar-ink-200 bg-radar-surface px-3 py-2 text-[13px] text-radar-ink-950 outline-none focus:border-radar-brand"
            />
          </label>
          <div className="space-y-2 rounded-[8px] border border-radar-ink-200 p-3">
            <label className="flex items-center justify-between text-[12.5px]">
              <span>初筛前置过滤</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-[#312e81]" />
            </label>
            <label className="flex items-center justify-between text-[12.5px]">
              <span>白嫖专源免审直通</span>
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-[#312e81]" />
            </label>
            <label className="flex items-center justify-between text-[12.5px]">
              <span>从收藏/关闭学习偏好</span>
              <input type="checkbox" className="h-4 w-4 accent-[#312e81]" />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => onToast('已发起补审')}
            >
              <Play className="h-4 w-4" /> 运行补审
            </Button>
            <Button variant="secondary" onClick={() => onToast('已发起测试')}>
              <FlaskConical className="h-4 w-4" /> 测试
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ───────────────────────── 面板：多路由推送 ───────────────────────── */

function PushPanel({ onToast }: { onToast: (m: string) => void }) {
  const routes = [
    { icon: '🎁', name: '真福利直推', mode: '即时' as const, tags: ['福利', 'free', 'conditional'], hit: 23, sent: 21 },
    { icon: '🖥️', name: '黑五/VPS 提醒', mode: '攒批' as const, tags: ['好价', 'vps', 'cloud'], hit: 47, sent: 44 },
    { icon: '📰', name: '新闻早报', mode: '攒批' as const, tags: ['新闻', '资讯'], hit: 12, sent: 12 },
  ];
  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-radar-ink-950">多路由精准推送</h2>
          <p className="mt-0.5 text-[12.5px] text-radar-ink-500">
            全局策略 + 独立专题路由：按形态/分类/获取方式/关键词定制即时或攒批。
          </p>
        </div>
        <Button onClick={() => onToast('已新增路由')}>
          <Plus className="h-4 w-4" /> 新增路由
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {routes.map((r) => (
          <article key={r.name} className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-radar-ink-950">
                <span className="text-lg">{r.icon}</span>
                {r.name}
              </span>
              <span
                className={
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ' +
                  (r.mode === '即时'
                    ? 'bg-radar-deal-subtle text-radar-deal'
                    : 'bg-radar-ink-100 text-radar-ink-500')
                }
              >
                {r.mode === '即时' ? <Zap className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                {r.mode}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {r.tags.map((t) => (
                <span key={t} className="rounded bg-radar-brand-subtle px-1.5 py-0.5 font-medium text-radar-accent">
                  {t}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-radar-ink-100 pt-2.5 text-[12px] text-radar-ink-500">
              <span>
                命中 {r.hit} · 已推 {r.sent}
              </span>
              <div className="flex gap-1">
                <button className="rounded-md p-1 text-radar-ink-400 transition-colors hover:bg-radar-ink-100">
                  <span className="sr-only">编辑</span>✎
                </button>
                <button className="rounded-md p-1 text-radar-ink-400 transition-colors hover:bg-radar-alert-subtle hover:text-radar-alert">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <Panel className="mt-5 space-y-3 p-5">
        <div className="flex items-center gap-2 text-[14.5px] font-semibold text-radar-ink-950">
          <Activity className="h-4 w-4 text-radar-accent" /> 推送诊断预览
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { v: '82', l: '扫描', c: 'text-radar-ink-900' },
            { v: '61', l: '命中', c: 'text-radar-deal' },
            { v: '14', l: '拦截', c: 'text-radar-alert' },
            { v: '7', l: '待发', c: 'text-radar-ink-700' },
          ].map((s) => (
            <div key={s.l} className="rounded-[8px] bg-radar-surface-muted p-3 text-center">
              <div className={'font-mono text-[18px] font-semibold ' + s.c}>{s.v}</div>
              <div className="text-[11.5px] text-radar-ink-500">{s.l}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ───────────────────────── 面板：数据源运维 ───────────────────────── */

function OpsPanel({ onToast }: { onToast: (m: string) => void }) {
  const sources = [
    { name: 'LINUX DO · 福利羊毛', type: '论坛', interval: '900s', items: 342, status: '正常' as const },
    { name: 'Epic Games · 喜加一', type: 'API', interval: '3600s', items: 58, status: '正常' as const },
    { name: 'GitHub · free-for-dev', type: 'RSS', interval: '1800s', items: 129, status: '限流' as const },
    { name: 'Reddit · GameDeals', type: 'RSS', interval: '—', items: 0, status: '停用' as const },
  ];
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-radar-ink-950">数据源运维</h2>
        <p className="mt-0.5 text-[12.5px] text-radar-ink-500">
          63 个内置源，默认精选启用 33 个。启停与周期在网页实时热改。
        </p>
      </div>
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-radar-ink-100 p-4">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-radar-ink-950">
            <Database className="h-4 w-4 text-radar-accent" /> 数据源状态
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onToast('已触发重整分类')}>
              <RefreshCw className="h-3.5 w-3.5" /> 重整分类
            </Button>
            <Button variant="secondary" onClick={() => onToast('已触发诊断')}>
              <Stethoscope className="h-3.5 w-3.5" /> 诊断
            </Button>
          </div>
        </div>
        <table className="w-full text-[12.5px]">
          <thead className="bg-radar-surface-muted text-radar-ink-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">数据源</th>
              <th className="px-3 py-2 text-left font-medium">类型</th>
              <th className="px-3 py-2 text-left font-medium">周期</th>
              <th className="px-3 py-2 text-right font-medium">条目</th>
              <th className="px-3 py-2 text-right font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-radar-ink-100">
            {sources.map((s) => (
              <tr key={s.name} className="hover:bg-radar-surface-hover">
                <td className="px-3 py-2.5 font-medium text-radar-ink-900">{s.name}</td>
                <td className="px-3 py-2.5 text-radar-ink-600">{s.type}</td>
                <td className="px-3 py-2.5 font-mono text-radar-ink-500">{s.interval}</td>
                <td className="px-3 py-2.5 text-right font-mono text-radar-ink-700">{s.items}</td>
                <td className="px-3 py-2.5 text-right">
                  {s.status === '正常' && (
                    <span className="inline-flex items-center gap-1 rounded bg-radar-deal-subtle px-1.5 py-0.5 text-[11px] font-medium text-radar-deal">
                      <CheckCircle2 className="h-3 w-3" /> 正常
                    </span>
                  )}
                  {s.status === '限流' && (
                    <span className="inline-flex items-center gap-1 rounded bg-radar-alert-subtle px-1.5 py-0.5 text-[11px] font-medium text-radar-alert">
                      <AlertTriangle className="h-3 w-3" /> 限流
                    </span>
                  )}
                  {s.status === '停用' && (
                    <span className="inline-flex items-center gap-1 rounded bg-radar-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-radar-ink-500">
                      停用
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
