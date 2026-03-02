import type { Command } from 'commander';
import { ToolsAPI } from '../../tools/api';
import { resolveConfig, requireApiKey, type CLIFlags } from '../config';
import { printJSON, printSearch, printError } from '../output';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for available tools/actions')
    .requiredOption('--query <query>', 'Search query')
    .option('--limit <n>', 'Max results', '10')
    .option('--offset <n>', 'Result offset', '0')
    .option('--include-actions', 'Include actions in results')
    .option('--no-schema', 'Compact numbered list (no payload schemas)')
    .action(async (opts) => {
      try {
        const flags: CLIFlags = {
          config: program.opts().config,
          apiKey: program.opts().apiKey,
          endpoint: program.opts().endpoint,
          timeout: program.opts().timeout,
        };
        const config = resolveConfig(flags);
        const apiKey = requireApiKey(config);

        const api = new ToolsAPI({
          apiKey,
          endpoint: config.endpoint.value,
          timeout: config.timeout.value,
        });

        const params: Record<string, any> = {
          query: opts.query,
          limit: parseInt(opts.limit, 10) || 10,
          offset: parseInt(opts.offset, 10) || 0,
        };
        if (opts.includeActions) {
          params.includeActions = true;
        }

        const result = await api.searchTools(params);

        if (opts.schema === false) {
          // --no-schema: compact numbered list
          const items = Array.isArray(result) ? result : result?.actions || result?.results || [];
          printSearch(items);
        } else {
          // Default: full JSON output
          printJSON(result);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
