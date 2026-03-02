import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';

export function getVersion(): string {
  // Works from both dist/cli/commands/ and src/cli/commands/
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version) return pkg.version;
    } catch {
      // continue
    }
  }
  return 'unknown';
}

export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('Print the CLI version')
    .action(() => {
      console.log(getVersion());
    });
}
