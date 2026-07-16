const REDACTION_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /(?<key>aws_secret_access_key\s*=\s*)[^\s]+/gi,
  /(?<key>aws_session_token\s*=\s*)[^\s]+/gi,
  /(?<key>authorization:\s*bearer\s+)[^\s]+/gi,
  /(?<key>bearer\s+)[a-z0-9._~+/=-]+/gi,
  /(?<key>token["'\s:=]+)[a-z0-9._~+/=-]{12,}/gi,
  /(?<key>password["'\s:=]+)[^\s"']+/gi,
];

export function redactSecretText(value: string): string {
  return REDACTION_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, (...args: unknown[]) => {
        const groups = args.at(-1) as { key?: string } | undefined;
        return `${groups?.key ?? ''}[REDACTED]`;
      }),
    value,
  );
}
