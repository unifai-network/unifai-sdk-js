import type { Command } from 'commander';
import { ToolsAPI } from '../../tools/api';
import { resolveConfig, requireApiKey, type CLIFlags } from '../config';
import { printJSON, printSearch, printError } from '../output';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for available tools/actions')
    .option('--query <query>', 'Search query')
    .option('--limit <n>', 'Max results', '10')
    .option('--offset <n>', 'Result offset', '0')
    .option('--include-actions <actions>', 'Comma-separated list of action IDs to include')
    .option('--include-toolkits <toolkits>', 'Comma-separated list of toolkit IDs to include')
    .option('--no-schema', 'Compact numbered list (no payload schemas)')
    .action(async (opts) => {
      try {
        if (!opts.query && !opts.includeActions && !opts.includeToolkits) {
          printError('At least one of --query, --include-actions, or --include-toolkits is required');
          process.exit(1);
        }
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
          limit: parseInt(opts.limit, 10) || 10,
          offset: parseInt(opts.offset, 10) || 0,
        };
        if (opts.query) {
          params.query = opts.query;
        }
        if (opts.includeActions) {
          params.includeActions = opts.includeActions.split(',').map((s: string) => s.trim());
        }
        if (opts.includeToolkits) {
          params.includeToolkits = opts.includeToolkits.split(',').map((s: string) => s.trim());
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
