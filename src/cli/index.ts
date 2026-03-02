#!/usr/bin/env node

import { Command } from 'commander';
import { getVersion, registerVersionCommand } from './commands/version';
import { registerConfigCommand } from './commands/config-cmd';
import { registerSearchCommand } from './commands/search';
import { registerInvokeCommand } from './commands/invoke';
import { registerTxCommand } from './commands/tx';
import { printError } from './output';

const program = new Command();

program
  .name('unifai')
  .description('UnifAI CLI - AI-native tool platform')
  .version(getVersion(), '-V, --version')
  .option('--config <path>', 'Path to config file')
  .option('--api-key <key>', 'API key')
  .option('--endpoint <url>', 'API endpoint')
  .option('--timeout <ms>', 'Request timeout in milliseconds');

registerVersionCommand(program);
registerConfigCommand(program);
registerSearchCommand(program);
registerInvokeCommand(program);
registerTxCommand(program);

program.parseAsync(process.argv).catch((err) => {
  printError(err.message || String(err));
  process.exit(1);
});
