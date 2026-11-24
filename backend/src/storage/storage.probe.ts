/**
 * 云端写探针。
 *
 * 只读探测（list / bucketExists）只能证明凭据有效且桶可达，证明不了
 * put / get 权限 —— 切过去之后才发现传不上去就晚了。local 的 probe 本来就
 * 实写探针文件，这里把三个后端的「主动测试」语义对齐。
 */

/**
 * 写探针失败时携带「哪一步」，让后台能直接指出是权限还是读回被改写。
 *
 * 只看 ok=false 的笼统报错，运维无法区分「没有 put 权限」与「出网代理改写了
 * 读回内容」—— 这两种故障的处置方式完全不同。
 */
export class ProbeStepError extends Error {
  constructor(
    public readonly step: '写入' | '读回' | '删除',
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${step}失败: ${detail}`);
    this.name = 'ProbeStepError';
  }
}

/** 读取内容与刚写入的不一致（单独成类，便于 probe 给出针对性提示）。 */
export class ProbeReadMismatchError extends Error {
  constructor() {
    super('读回内容与写入不一致');
    this.name = 'ProbeReadMismatchError';
  }
}

/**
 * 云端写探针：写 1 字节对象、读回校验、尽力删除。
 *
 * 删除放在 finally 里：即使读回失败也要清理探针对象，不能因为一次测试
 * 在桶里留下垃圾。
 */
export async function verifyWriteProbe(io: {
  put: (key: string, data: Buffer, contentType: string) => Promise<unknown>;
  get: (key: string) => Promise<Buffer>;
  remove: (key: string) => Promise<unknown>;
}): Promise<string> {
  const key = `.probe-${Date.now()}`;
  const payload = Buffer.from('ok');
  try {
    try {
      await io.put(key, payload, 'text/plain');
    } catch (e) {
      throw new ProbeStepError('写入', e);
    }
    let back: Buffer;
    try {
      back = await io.get(key);
    } catch (e) {
      throw new ProbeStepError('读回', e);
    }
    if (!back.equals(payload)) throw new ProbeReadMismatchError();
    return '读写正常';
  } finally {
    // 删除失败不掩盖探测结论，但对象可能残留 —— 交给 bucket 生命周期规则兜底
    await io.remove(key).catch(() => undefined);
  }
}

/** 探测结论落地文案：把步骤错误翻译成可执行的诊断。 */
export function probeFailureMessage(e: unknown): string {
  if (e instanceof ProbeReadMismatchError) {
    return `读写不一致: ${e.message}（检查 Endpoint 或出网代理是否改写请求）`;
  }
  return e instanceof Error ? e.message : String(e);
}