import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const domainDirectory = resolve(dirname(fileURLToPath(import.meta.url)));

describe('domain dependency boundary', () => {
  it('domain modules depend only on local domain modules', () => {
    const files = readdirSync(domainDirectory)
      .filter((file) => extname(file) === '.ts' && !file.endsWith('.test.ts'))
      .sort();
    const imports: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const source = readFileSync(resolve(domainDirectory, file), 'utf8');
      for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) {
          imports.push({ file, specifier });
          continue;
        }
        const target = resolve(domainDirectory, specifier);
        if (!target.startsWith(`${domainDirectory}\\`)) {
          imports.push({ file, specifier });
        }
      }
    }

    expect(imports).toEqual([]);
  });
});
