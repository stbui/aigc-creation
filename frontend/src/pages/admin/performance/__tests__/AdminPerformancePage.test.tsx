import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }));

vi.mock('../api', () => ({
  adminSystemPerformanceApi: { read: readMock },
}));

import type { AdminSystemPerformance } from '../../../../types/admin-performance';
import { AdminPerformancePage } from '../page';

function makeSnapshot(overrides: Partial<AdminSystemPerformance> = {}): AdminSystemPerformance {
  return {
    generatedAt: '2026-11-26T10:20:30.000Z',
    durationMs: 12,
    runtime: {
      env: 'production',
      version: '1.2.3',
      uptimeSec: 3661,
      pid: 4242,
      node: 'v22.11.0',
      memory: {
        rssBytes: 256 * 1024 * 1024,
        heapUsedBytes: 128 * 1024 * 1024,
        heapTotalBytes: 200 * 1024 * 1024,
        externalBytes: 4 * 1024 * 1024,
      },
      cpu: { userMs: 60_000, systemMs: 30_000, cores: 8 },
      eventLoopLagMs: 3.4,
    },
    system: {
      hostname: 'stbui-mac.local',
      platform: 'darwin',
      arch: 'x64',
      kernel: '22.6.0',
      nodeVersion: 'v22.11.0',
      cpu: { model: 'Intel(R) Core(TM) i7-7820HQ CPU @ 2.90GHz', cores: 8 },
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      loadavg: [0.12, 0.34, 0.56],
    },
    database: {
      ok: true,
      engine: 'SQLite',
      version: 'SQLite 3.53.2',
      location: '/srv/app/backend/dev.db',
      sizeBytes: 7 * 1024 * 1024,
      tables: 68,
      migrations: {
        total: 3,
        applied: 3,
        lastAppliedAt: '2026-11-24T06:15:01.000Z',
      },
      latencyMs: 4,
    },
    storage: {
      ok: true,
      latencyMs: 7,
      backend: 'local',
      message: '可读可写: /srv/app/backend/uploads',
      cached: false,
    },
    traffic: {
      windowHours: 24,
      tasks: {
        total: 100,
        succeeded: 95,
        failed: 5,
        successRate: 0.95,
        p95DurationMs: 4321,
        byStatus: { succeeded: 95, failed: 5 },
      },
      calls: {
        total: 200,
        terminal: 190,
        failed: 10,
        p95DurationMs: 512,
        byKind: { create: 100, poll: 90 },
      },
      storage: { assets: 300, bytes: 512 * 1024 * 1024 },
      cooling: { blocked: 0, keys: [] },
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/performance']}>
      <AdminPerformancePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  readMock.mockReset();
});

describe('AdminPerformancePage', () => {
  it('全部区块平铺渲染，不出现页签', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('主机名：')).toBeInTheDocument());
    for (const title of ['宿主机', '运行时', '数据库', '存储']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // 定时任务区块已下线
    expect(screen.queryByText('调度器尚未执行过任务')).not.toBeInTheDocument();
  });

  it('每条信息独占一行：主机名单独成行', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('主机名：')).toBeInTheDocument());
    const row = screen.getByText('主机名：').parentElement as HTMLElement;
    // 同一行只有标签与值，不再有两列网格的邻居
    expect(row).toHaveTextContent('stbui-mac.local');
    expect(row).toHaveTextContent('主机名');
  });

  it('宿主机信息逐行给出内核、架构、CPU 与负载', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('主机名：')).toBeInTheDocument());
    expect(screen.getByText('内核版本：')).toBeInTheDocument();
    expect(screen.getByText('架构：')).toBeInTheDocument();
    // 枚举值换成人能读的平台名，不把 darwin / x64 直接摆出来
    expect(screen.getByText('macOS')).toBeInTheDocument();
    expect(screen.getByText('x86-64')).toBeInTheDocument();
    expect(screen.getByText('CPU 型号：')).toBeInTheDocument();
    expect(screen.getByText(/i7-7820HQ/)).toBeInTheDocument();
    expect(screen.getByText('负载均值：')).toBeInTheDocument();
    expect(screen.getByText(/0\.12 \/ 0\.34 \/ 0\.56/)).toBeInTheDocument();
  });

  it('数据库显示库本身的元信息，不再是探活耗时卡', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('引擎：')).toBeInTheDocument());
    expect(screen.getByText('版本：')).toBeInTheDocument();
    expect(screen.getByText('SQLite 3.53.2')).toBeInTheDocument();
    expect(screen.getByText('库位置：')).toBeInTheDocument();
    expect(screen.getByText('/srv/app/backend/dev.db')).toBeInTheDocument();
    expect(screen.getByText('库体积：')).toBeInTheDocument();
    expect(screen.getByText('表数量：')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    // 迁移进度：已应用 / 总数
    expect(screen.getByText('迁移进度：')).toBeInTheDocument();
    expect(screen.getByText(/已应用 3 \/ 共 3/)).toBeInTheDocument();
    // 探活不再是页面主读数；数据库区块标题也不叫「数据库与存储」
    expect(screen.queryByText('数据库与存储')).not.toBeInTheDocument();
    expect(screen.queryByText(/数据库探活/)).not.toBeInTheDocument();
  });

  it('连不上库时给出原因并保留元信息骨架', async () => {
    readMock.mockResolvedValue(
      makeSnapshot({
        database: {
          ok: false,
          engine: 'PostgreSQL',
          version: null,
          location: 'db.internal:5432/huojue',
          sizeBytes: null,
          tables: null,
          migrations: null,
          latencyMs: 0,
          message: 'connection refused',
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('数据库连接失败')).toBeInTheDocument());
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('—（网络数据库不按文件计体积）')).toBeInTheDocument();
    // 迁移进度取不到时显示「—」，不能写成 0/0 假装干净
    expect(screen.queryByText(/已应用/)).not.toBeInTheDocument();
    // 失败提示要给出下一步，而不只是把原因抛出来
    expect(screen.getByText(/点「刷新」重试/)).toBeInTheDocument();
  });

  it('平铺展示运行时事件循环延迟', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('主机名：')).toBeInTheDocument());
    expect(screen.getByText('事件循环延迟：')).toBeInTheDocument();
    expect(screen.getByText('3.4 ms')).toBeInTheDocument();
    // 正常区间不额外加结论词，避免每行都挂一句「正常」
    expect(screen.queryByText(/阻塞明显|偏高/)).not.toBeInTheDocument();
  });

  it('事件循环延迟偏高时给出文字结论，不只靠颜色', async () => {
    const base = makeSnapshot();
    readMock.mockResolvedValue(
      makeSnapshot({
        runtime: { ...base.runtime, eventLoopLagMs: 150 },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText(/150\.0 ms（阻塞明显）/)).toBeInTheDocument());
  });

  it('不自动轮询：只请求一次，也不注册秒级定时器', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(1));
    // testing-library 的 waitFor 自己会用 50ms 轮询，只排除页面侧的秒级定时器
    const pageDelays = intervalSpy.mock.calls.map(([, ms]) => ms).filter((ms) => (ms ?? 0) >= 1000);
    expect(pageDelays).toEqual([]);
    intervalSpy.mockRestore();
  });

  it('线路冷却有条目时列出键名', async () => {
    readMock.mockResolvedValue(
      makeSnapshot({
        traffic: {
          ...makeSnapshot().traffic,
          cooling: {
            blocked: 1,
            keys: [{ key: 'channel:abc', until: '2026-11-26T10:30:00.000Z' }],
          },
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('线路冷却：')).toBeInTheDocument());
    // 冷却键是内部标识，展示时补中文前缀并保留 id 便于回后台定位；解封时间同屏给出
    expect(screen.getByText(/1 条 · 渠道（abc）至 11-26 18:30/)).toBeInTheDocument();
  });

  it('状态与调用类型分布按中文展示，不裸露枚举值', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('任务状态（全量）：')).toBeInTheDocument());
    expect(screen.getByText(/已完成 95 · 失败 5/)).toBeInTheDocument();
    expect(screen.getByText('调用类型：')).toBeInTheDocument();
    expect(screen.getByText(/创建 100 · 轮询 90/)).toBeInTheDocument();
  });

  it('窗口内没有任务时说明没有样本，不显示成 0 / 0', async () => {
    const base = makeSnapshot();
    readMock.mockResolvedValue(
      makeSnapshot({
        traffic: {
          ...base.traffic,
          tasks: {
            total: 0,
            succeeded: 0,
            failed: 0,
            successRate: null,
            p95DurationMs: null,
            byStatus: { succeeded: 59, failed: 5 },
          },
          calls: {
            total: 0,
            terminal: 0,
            failed: 0,
            p95DurationMs: null,
            byKind: {},
          },
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('任务成功 / 失败：')).toBeInTheDocument());
    expect(screen.getByText('—（窗口内没有任务）')).toBeInTheDocument();
    expect(screen.getByText('—（窗口内没有调用）')).toBeInTheDocument();
    // 全量状态分布照常显示，不被窗口内的空样本掩盖
    expect(screen.getByText(/已完成 59 · 失败 5/)).toBeInTheDocument();
  });

  it('运行环境、存储后端给中文名', async () => {
    readMock.mockResolvedValue(makeSnapshot());
    renderPage();

    await waitFor(() => expect(screen.getByText('运行环境：')).toBeInTheDocument());
    expect(screen.getByText('生产')).toBeInTheDocument();
    expect(screen.getByText('本地磁盘')).toBeInTheDocument();
  });
});
