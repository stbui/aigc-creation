const BENIGN_DIAGNOSTICS = [
  /^Codex is ignoring \d+ unrecognized configuration settings/i,
  /^Model metadata for .+ not found\. Defaulting to fallback metadata/i,
];

export function isBenignCodexDiagnostic(value) {
  if (typeof value !== 'string') return false;
  const firstLine = value.trim().split('\n', 1)[0];
  return BENIGN_DIAGNOSTICS.some((pattern) => pattern.test(firstLine));
}
