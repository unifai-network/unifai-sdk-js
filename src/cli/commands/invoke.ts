import * as fs from 'fs';
import type { Command } from 'commander';
import { ToolsAPI } from '../../tools/api';
import { resolveConfig, requireApiKey, type CLIFlags } from '../config';
import { normalizeInvokeResponse, extractTxId, printJSON, printValue, printSignResult, printError } from '../output';
import { parseChainFromTxId, getSignerForChain, executeSigningFlow } from '../signing';

function parsePayload(raw: string, format: string): any {
  if (raw.startsWith('@')) {
    const filePath = raw.slice(1);
    raw = fs.readFileSync(filePath, 'utf-8');
  }

  switch (format) {
    case 'string':
      return raw;
    case 'object':
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error('Payload is not valid JSON (--payload-format object)');
      }
    case 'auto':
    default:
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
  }
}

export function registerInvokeCommand(program: Command): void {
  program
    .command('invoke')
    .description('Invoke a tool/action')
    .requiredOption('--action <action>', 'Action ID to invoke')
    .option('--payload <payload>', 'Payload (JSON string, raw string, or @filepath)')
    .option('--payload-format <format>', 'Payload format: auto, object, string', 'auto')
    .option('--max-retries <n>', 'Max retries', '1')
    .option('--sign', 'Automatically sign transactions if present')
    .option('--json', 'Force JSON output')
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
          maxRetries: Math.max(parseInt(opts.maxRetries, 10) || 1, 1),
        });

        let payload: any = undefined;
        if (opts.payload !== undefined) {
          payload = parsePayload(opts.payload, opts.payloadFormat);
        }

        const callArgs: Record<string, any> = { action: opts.action };
        if (payload !== undefined) {
          callArgs.payload = payload;
        }

        const result = await api.callTool(callArgs);

        if (opts.sign) {
          const txId = extractTxId(result);
          if (txId) {
            const chain = parseChainFromTxId(txId);
            const signer = getSignerForChain(chain, config);
            const signResult = await executeSigningFlow(apiKey, txId, signer, config);
            printSignResult(signResult, !!opts.json);
            return;
          }
        }

        const normalized = normalizeInvokeResponse(result);
        if (opts.json) {
          printJSON(normalized);
        } else {
          printValue(normalized);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
