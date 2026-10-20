import type { AdminModelChannel, AdminModelRouteRow, Modality } from '../../types/api';

/**
 * 通道总览卡片 (2026-10-20 模型配置页重设计)。
 *
 * ## 为什么改成「三模态并排 + 点开编辑」
 *
 * 改造前是五个平铺区块 (通道状态 → 厂商预设 → 通道配置 24 项 → 超时 12 项 →
 * 路由总览 16 卡), 运营改一个字段要跨四个区块来回滚。更糟的是**三个模态
 * 藏在 Segmented 后面**: 页面上永远只看得见一个模态, 于是
 * 「文生图配好了、视频根本没配」这件事在界面上完全看不出来 —— 而这恰恰是
 * 最需要被看见的信息 (视频无本地兜底, 没配就是必然失败)。
 *
 * 故: 三个模态**并排成三张卡**, 每张卡自带状态与摘要, 既是总览也是入口。
 * 展开哪张就编辑哪张, 不跳屏。
 */

/** 通道生效态 → 标签与配色。三态而非两态 (见 AdminModelChannel.effective 注释) */
export function channelStateMeta(c: AdminModelChannel | null) {
  const modality = c?.modality;
  if (!c) return { tone: 'is-muted', label: '加载中' };
  if (c.effective === 'gateway') return { tone: 'is-succeeded', label: '真实模型' };
  // ⚠️ 视频/文本没有本地算法: 未接入 = 调用必然失败, 不能标成「本地算法」
  if (c.effective === 'none') {
    return {
      tone: 'is-danger',
      label: '未接入 · 调用会失败',
      hint:
        modality === 'video'
          ? '视频没有本地兜底: 通道未配置时该能力会直接失败, 不会回落到本地。'
          : '文本没有本地兜底: 通道未配置时该能力会直接失败, 不会回落到本地。',
    };
  }
  return { tone: 'is-muted', label: '本地算法' };
}

/** 路由项生效态 → 标签与配色 */
export function routeStateMeta(r: AdminModelRouteRow) {
  if (r.effective === 'gateway') return { tone: 'is-succeeded', label: '真实模型' };
  if (r.effective === 'none') return { tone: 'is-danger', label: '无兜底 · 会失败' };
  return { tone: 'is-muted', label: '本地算法' };
}

export function ChannelCard({
  channel,
  active,
  dirtyCount,
  test,
  onOpen,
}: {
  channel: AdminModelChannel | null;
  active: boolean;
  /** 该模态下未保存的变更数 —— 让「改了就忘存」在总览上就能看见 */
  dirtyCount: number;
  /** 该模态的连通性测试结论 (批量测试后各模态各自持有) */
  test?: { ok: boolean; message: string; detail?: string };
  onOpen: () => void;
}) {
  const state = channelStateMeta(channel);
  const vendor = channel?.vendors?.find((v) => v.key === channel.vendor);

  return (
    <button
      type="button"
      className={`adm-chcard${active ? ' is-active' : ''}`}
      onClick={onOpen}
      aria-expanded={active}
    >
      <div className="adm-chcard-head">
        <span className="adm-chcard-title">{channel?.label ?? '—'}</span>
        <span className={`adm-tag ${state.tone}`}>{state.label}</span>
      </div>

      <dl className="adm-chcard-body">
        <div>
          <dt>厂商</dt>
          <dd>{vendor?.label ?? <span className="adm-cell-sub">未选择</span>}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd className="adm-cell-mono">{channel?.model || <span className="adm-cell-sub">按厂商预设</span>}</dd>
        </div>
        <div>
          <dt>协议</dt>
          <dd className="adm-cell-mono">
            {channel?.provider || <span className="adm-cell-sub">未选</span>}
            {/* ⚠️ 「配了但协议未接入」必须显式警示: 这是一个必然失败的配置 */}
            {channel?.configuredButUnsupported && (
              <span className="adm-tag is-danger">该协议在本模态未接入</span>
            )}
          </dd>
        </div>
      </dl>

      {/* 「配了却必然失败」是最需要被看见的状态, 单独提一行而不是塞进 tooltip */}
      {channel?.configuredButUnsupported && (
        <p className="adm-chcard-alert">
          当前协议在本模态下尚未接入，生成时必然失败 —— 请改选已接入的厂商或协议。
        </p>
      )}
      {channel?.effective === 'none' && !channel?.configuredButUnsupported && (
        <p className="adm-chcard-alert is-soft">{state.hint}</p>
      )}

      {/*
        测试结论 (2026-10-20): 批量测试后**每个模态各显示自己的结论**,
        不必再逐个点开看 —— 这是「一次看全」的关键。
        ⚠️ 测试结论与通道状态是**两件事**: 状态说「配没配」,
        测试说「配的这份能不能通」。两者分开显示, 不合并成一个标签。
      */}
      {test && (
        <p className={`adm-chcard-test ${test.ok ? 'is-ok' : 'is-fail'}`}>
          {test.ok ? '✓' : '✗'} {test.message}
        </p>
      )}

      <div className="adm-chcard-foot">
        {dirtyCount > 0 ? (
          <span className="adm-tag is-warn">{dirtyCount} 项未保存</span>
        ) : (
          <span className="adm-chcard-hint">{active ? '正在编辑' : '点击展开配置'}</span>
        )}
      </div>
    </button>
  );
}

/** 模态中文名 (总览与分组标题用) */
export const MODALITY_LABEL: Record<Modality, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
};