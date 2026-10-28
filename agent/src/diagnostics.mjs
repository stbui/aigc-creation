const BENIGN_DIAGNOSTICS = [
  /^Codex is ignoring \d+ unrecognized configuration settings/i,
  /^Model metadata for .+ not found\. Defaulting to fallback metadata/i,
  // 续聊旧会话时 Codex 会对比落盘模型与当前模型并给建议；不是失败，不该在时间线上报红。
  /^This session was recorded with model .+ but is resuming with /i,
];

export function isBenignCodexDiagnostic(value) {
  if (typeof value !== 'string') return false;
  const firstLine = value.trim().split('\n', 1)[0];
  return BENIGN_DIAGNOSTICS.some((pattern) => pattern.test(firstLine));
}
