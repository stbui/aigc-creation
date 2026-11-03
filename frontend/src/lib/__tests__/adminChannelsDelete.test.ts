import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminChannelsApi } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adminChannelsApi.remove', () => {
  it('删除渠道只发 DELETE，不携带原因请求体', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { ok: true }, message: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(adminChannelsApi.remove('channel-1')).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/channels/channel-1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

describe('adminChannelsApi 渠道模型删除', () => {
  const mockOk = (data: unknown) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data, message: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  it('单条删除只发 DELETE，不携带原因请求体', async () => {
    const fetchMock = mockOk({ ok: true, deleted: 1 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(adminChannelsApi.removeModel('channel-1', 'model-1')).resolves.toEqual({
      ok: true,
      deleted: 1,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/channels/channel-1/models/model-1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('批量删除只提交模型 id，不携带原因', async () => {
    const fetchMock = mockOk({ ok: true, deleted: 2 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adminChannelsApi.batchDeleteModels('channel-1', ['model-1', 'model-2']),
    ).resolves.toEqual({ ok: true, deleted: 2 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/channels/channel-1/models/batch-delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ids: ['model-1', 'model-2'] });
  });
});
