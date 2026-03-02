import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.resolve(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');
const PKG_PATH = path.resolve(__dirname, '..', '..', '..', 'package.json');

function runCLI(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      'node',
      [CLI_PATH, ...args],
      {
        env: { ...process.env, ...env },
        timeout: 30000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || '',
          code: error?.code !== undefined ? (typeof error.code === 'number' ? error.code : 1) : 0,
        });
      },
    );
  });
}

// Skip all E2E tests unless UNIFAI_LIVE_TEST is set
const describeIfLive = process.env.UNIFAI_LIVE_TEST ? describe : describe.skip;

describe('E2E - CLI binary', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'npm run build' first. Expected: ${CLI_PATH}`);
    }
  });

  it('should show version with --version', async () => {
    const { stdout } = await runCLI(['--version']);
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('should show version with version subcommand', async () => {
    const { stdout } = await runCLI(['version']);
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('should show config', async () => {
    const { stdout } = await runCLI(['config', 'show']);
    expect(stdout).toContain('endpoint:');
    expect(stdout).toContain('timeout:');
  });

  it('should error on search without API key', async () => {
    const { stderr } = await runCLI(['search', '--query', 'test'], { UNIFAI_AGENT_API_KEY: '' });
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('API key is required');
  });

  describeIfLive('Live API tests', () => {
    const API_KEY = process.env.UNIFAI_AGENT_API_KEY!;

    it('should search tools', async () => {
      const { stdout } = await runCLI(['search', '--query', 'solana swap', '--limit', '3'], { UNIFAI_AGENT_API_KEY: API_KEY });
      const result = JSON.parse(stdout);
      expect(result).toBeDefined();
    });

    it('should search with --no-schema', async () => {
      const { stdout } = await runCLI(['search', '--query', 'solana', '--no-schema', '--limit', '3'], { UNIFAI_AGENT_API_KEY: API_KEY });
      // Should be numbered list, not JSON
      expect(stdout).toMatch(/^\d+\./m);
    });

    it('should invoke an action', async () => {
      const { stdout } = await runCLI([
        'invoke',
        '--action', 'Solana--7--getBalance',
        '--payload', '{"address":"11111111111111111111111111111112"}',
      ], { UNIFAI_AGENT_API_KEY: API_KEY });
      expect(stdout).toBeTruthy();
    });
  });
});
