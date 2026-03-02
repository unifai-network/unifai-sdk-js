import type { Command } from 'commander';
import { resolveConfig, requireApiKey, type CLIFlags } from '../config';
import { printSignResult, printError } from '../output';
import { parseChainFromTxId, getSignerForChain, executeSigningFlow } from '../signing';

export function registerTxCommand(program: Command): void {
  const txCmd = program
    .command('tx')
    .description('Transaction operations');

  txCmd
    .command('sign <txId>')
    .description('Sign and submit a transaction')
    .option('--json', 'Output as JSON')
    .action(async (txId: string, opts) => {
      try {
        const flags: CLIFlags = {
          config: program.opts().config,
          apiKey: program.opts().apiKey,
          endpoint: program.opts().endpoint,
          timeout: program.opts().timeout,
        };
        const config = resolveConfig(flags);
        const apiKey = requireApiKey(config);

        const chain = parseChainFromTxId(txId);
        if (!chain) {
          throw new Error(`Cannot determine chain from txId: ${txId}`);
        }

        const signer = getSignerForChain(chain, config);
        const result = await executeSigningFlow(apiKey, txId, signer, config);
        printSignResult(result, !!opts.json);
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
