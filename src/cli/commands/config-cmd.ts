import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { resolveConfig, defaultConfigPath, CONFIG_TEMPLATE, type CLIFlags } from '../config';
import { printJSON, printError } from '../output';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage CLI configuration');

  configCmd
    .command('init')
    .description('Create a config file with default template')
    .option('--path <path>', 'Config file path', defaultConfigPath())
    .option('--force', 'Overwrite existing config file')
    .action((opts) => {
      try {
        const filePath = opts.path;
        if (fs.existsSync(filePath) && !opts.force) {
          printError(`Config file already exists at ${filePath}. Use --force to overwrite.`);
          process.exit(2);
          return;
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, CONFIG_TEMPLATE, { mode: 0o600 });
        fs.chmodSync(filePath, 0o600);
        console.log(`Config file created at ${filePath}`);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  configCmd
    .command('show')
    .description('Show current configuration')
    .option('--path <path>', 'Config file path')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        const flags: CLIFlags = {
          config: opts.path || program.opts().config,
          apiKey: program.opts().apiKey,
          endpoint: program.opts().endpoint,
          timeout: program.opts().timeout,
        };
        const config = resolveConfig(flags);

        if (opts.json) {
          const masked: Record<string, { value: string; source: string }> = {};
          for (const [key, entry] of Object.entries(config)) {
            const isSecret = key === 'apiKey' || key === 'solanaPrivateKey' || key === 'evmPrivateKey';
            masked[key] = {
              value: isSecret ? (entry.value ? 'configured' : 'not set') : String(entry.value),
              source: entry.source,
            };
          }
          printJSON(masked);
        } else {
          const lines: string[] = [];
          for (const [key, entry] of Object.entries(config)) {
            const isSecret = key === 'apiKey' || key === 'solanaPrivateKey' || key === 'evmPrivateKey';
            const display = isSecret ? (entry.value ? 'configured' : 'not set') : String(entry.value);
            lines.push(`${key}: ${display} (${entry.source})`);
          }
          console.log(lines.join('\n'));
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
