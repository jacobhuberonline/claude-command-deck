export interface ClaudeUsageSnapshot {
  amountUsd: number;
  label: 'Month' | 'Usage';
  source: string;
  observedAt: string;
}

// Terminal output can include ANSI escape sequences around Claude's usage text.
// eslint-disable-next-line no-control-regex
const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const currencyPattern = /\$\s*([0-9][\d,]*(?:\.\d{1,4})?)/g;

export function parseClaudeUsageOutput(
  output: string,
  observedAt = new Date().toISOString(),
): ClaudeUsageSnapshot | null {
  const cleanOutput = output.replace(ansiPattern, '');
  const candidates = cleanOutput
    .split(/\r?\n/)
    .flatMap((line) => extractLineCandidates(line, observedAt));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => right.score - left.score).at(0)?.snapshot ?? null;
}

function extractLineCandidates(line: string, observedAt: string) {
  const normalized = line.trim();
  if (!normalized) {
    return [];
  }

  const matches = [...normalized.matchAll(currencyPattern)];
  if (matches.length === 0) {
    return [];
  }

  const score = scoreUsageLine(normalized);
  if (score < 0) {
    return [];
  }

  return matches
    .map((match) => Number.parseFloat(match[1]!.replace(/,/g, '')))
    .filter((amount) => Number.isFinite(amount))
    .map((amount) => ({
      score,
      snapshot: {
        amountUsd: amount,
        label: score >= 3 ? 'Month' : 'Usage',
        source: normalized,
        observedAt,
      } satisfies ClaudeUsageSnapshot,
    }));
}

function scoreUsageLine(line: string) {
  const lower = line.toLowerCase();
  let score = 0;

  if (/\b(month|monthly|billing period|current period)\b/.test(lower)) {
    score += 3;
  }

  if (/\b(usage|cost|spent|spend|total|used)\b/.test(lower)) {
    score += 2;
  }

  if (/\b(today|daily|session)\b/.test(lower)) {
    score -= 1;
  }

  return score;
}
