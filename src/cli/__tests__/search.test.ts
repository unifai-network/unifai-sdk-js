import { ToolsAPI } from '../../tools/api';

jest.mock('../../tools/api');

const MockedToolsAPI = ToolsAPI as jest.MockedClass<typeof ToolsAPI>;

// Helper to run a command handler
async function runSearch(opts: Record<string, any>, programOpts: Record<string, any> = {}) {
  // Reset modules to get fresh command
  jest.resetModules();
  const { Command } = require('commander');
  const { registerSearchCommand } = require('../commands/search');
  const { resolveConfig, requireApiKey } = require('../config');

  const mockSearchTools = jest.fn();
  MockedToolsAPI.mockImplementation(() => ({ searchTools: mockSearchTools } as any));

  return { mockSearchTools, runHandler: mockSearchTools };
}

describe('search command', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.env = { ...originalEnv, UNIFAI_AGENT_API_KEY: 'test-key' };
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.env = originalEnv;
  });

  it('should call searchTools with correct params', async () => {
    const mockSearchTools = jest.fn().mockResolvedValue([{ action: 'Test', description: 'desc' }]);
    MockedToolsAPI.mockImplementation(() => ({ searchTools: mockSearchTools } as any));

    const { Command } = require('commander');
    const { registerSearchCommand } = require('../commands/search');

    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerSearchCommand(program);

    await program.parseAsync(['node', 'test', 'search', '--query', 'solana swap']);

    expect(mockSearchTools).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'solana swap', limit: 10, offset: 0 }),
    );
    // Default output is JSON
    expect(logSpy).toHaveBeenCalled();
  });

  it('should output numbered list with --no-schema', async () => {
    const mockSearchTools = jest.fn().mockResolvedValue([
      { action: 'Solana--7--swap', description: 'Swap tokens' },
      { action: 'Solana--7--transfer', description: 'Transfer SOL' },
    ]);
    MockedToolsAPI.mockImplementation(() => ({ searchTools: mockSearchTools } as any));

    const { Command } = require('commander');
    const { registerSearchCommand } = require('../commands/search');

    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerSearchCommand(program);

    await program.parseAsync(['node', 'test', 'search', '--query', 'solana', '--no-schema']);

    expect(logSpy).toHaveBeenCalledWith('1. Solana--7--swap - Swap tokens');
    expect(logSpy).toHaveBeenCalledWith('2. Solana--7--transfer - Transfer SOL');
  });

  it('should pass limit and offset', async () => {
    const mockSearchTools = jest.fn().mockResolvedValue([]);
    MockedToolsAPI.mockImplementation(() => ({ searchTools: mockSearchTools } as any));

    const { Command } = require('commander');
    const { registerSearchCommand } = require('../commands/search');

    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerSearchCommand(program);

    await program.parseAsync(['node', 'test', 'search', '--query', 'test', '--limit', '5', '--offset', '2']);

    expect(mockSearchTools).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 2 }),
    );
  });

  it('should handle API errors', async () => {
    const mockSearchTools = jest.fn().mockRejectedValue(new Error('API error'));
    MockedToolsAPI.mockImplementation(() => ({ searchTools: mockSearchTools } as any));

    const { Command } = require('commander');
    const { registerSearchCommand } = require('../commands/search');

    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerSearchCommand(program);

    await program.parseAsync(['node', 'test', 'search', '--query', 'test']);

    expect(errorSpy).toHaveBeenCalledWith('Error: API error');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should error when API key is missing', async () => {
    delete process.env.UNIFAI_AGENT_API_KEY;

    const { Command } = require('commander');
    const { registerSearchCommand } = require('../commands/search');

    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerSearchCommand(program);

    await program.parseAsync(['node', 'test', 'search', '--query', 'test']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: API key is required'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
