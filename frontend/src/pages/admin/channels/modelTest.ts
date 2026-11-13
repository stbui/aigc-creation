import { ApiError } from './api';
import type { ProtocolTestResultView } from '../../../types/model';

/**
 * 连通测试失败详情。
 *
 * 后台报障时只给一句「测试失败」无法定位：`errorCode` 决定找上游还是找出站，
 * `logId` 能直接跳到调用记录。四段都保留，空值不占位。
 */
export function testFailureText(result: ProtocolTestResultView): string {
  return [
    result.message,
    result.error,
    result.errorCode ? `错误码 ${result.errorCode}` : '',
    result.logId ? `logId ${result.logId}` : '',
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ') || '上游未返回失败详情';
}

/** 请求本身失败（超时 / 权限 / 网络）时的详情，同样带业务码与请求号。 */
export function testErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    return [
      error.message,
      error.code === null ? '' : `错误码 ${error.code}`,
      error.requestId ? `requestId ${error.requestId}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return error instanceof Error ? error.message : '未知错误';
}
