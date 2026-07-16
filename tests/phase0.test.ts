import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('phase 0 project baseline', () => {
  it('defines the required validation scripts', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.format).toContain('prettier');
    expect(packageJson.scripts?.lint).toContain('eslint');
    expect(packageJson.scripts?.typecheck).toContain('tsc');
    expect(packageJson.scripts?.test).toContain('vitest');
  });
});
