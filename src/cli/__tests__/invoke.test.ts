import * as fs from 'fs';
import { ToolsAPI } from '../../tools/api';

jest.mock('../../tools/api');
jest.mock('../signing', () => ({
  parseChainFromTxId: jest.fn().mockReturnValue('solana'),
  getSignerForChain: jest.fn().mockReturnValue({ publicKey: { toBase58: () => 'pub' }, signTransaction: jest.fn() }),
  executeSigningFlow: jest.fn().mockResolvedValue({
    address: 'addr',
    txId: 'solana-123',
    hash: ['0xhash'],
  }),
}));

const MockedToolsAPI = ToolsAPI as jest.MockedClass<typeof ToolsAPI>;

describe('invoke command', () => {
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

  function setupProgram() {
    const { Command } = require('commander');
    const { registerInvokeCommand } = require('../commands/invoke');
    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerInvokeCommand(program);
    return program;
  }

  it('should invoke action without --sign', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({ payload: { result: 'ok' } });
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'Test--1--action', '--payload', '{"key":"val"}']);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'Test--1--action', payload: { key: 'val' } });
    // Should print normalized (payload extracted)
    expect(logSpy).toHaveBeenCalled();
  });

  it('should parse payload as string when format is string', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({ data: 'ok' });
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'Test--1--action', '--payload', '{"key":"val"}', '--payload-format', 'string']);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'Test--1--action', payload: '{"key":"val"}' });
  });

  it('should parse payload auto: valid JSON', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({});
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--payload', '{"a":1}']);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'A', payload: { a: 1 } });
  });

  it('should parse payload auto: invalid JSON falls back to string', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({});
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--payload', 'not json']);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'A', payload: 'not json' });
  });

  it('should error on invalid JSON with object format', async () => {
    MockedToolsAPI.mockImplementation(() => ({ callTool: jest.fn() } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--payload', 'not json', '--payload-format', 'object']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle @file payload by reading file', async () => {
    // Write a temp file for the test
    const tmpFile = '/tmp/unifai-test-payload.json';
    require('fs').writeFileSync(tmpFile, '{"from":"file"}');

    const mockCallTool = jest.fn().mockResolvedValue({});
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--payload', `@${tmpFile}`]);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'A', payload: { from: 'file' } });
    require('fs').unlinkSync(tmpFile);
  });

  it('should sign when --sign and txId present', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({ txId: 'solana-123' });
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const { executeSigningFlow } = require('../signing');

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--sign']);

    expect(executeSigningFlow).toHaveBeenCalled();
  });

  it('should show normal response when --sign but no txId', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({ result: 'no tx needed' });
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const { executeSigningFlow } = require('../signing');

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'A', '--sign']);

    // Should NOT have called signing
    expect(executeSigningFlow).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('should handle invoke without payload', async () => {
    const mockCallTool = jest.fn().mockResolvedValue({ data: 'ok' });
    MockedToolsAPI.mockImplementation(() => ({ callTool: mockCallTool } as any));

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'invoke', '--action', 'Test--1--action']);

    expect(mockCallTool).toHaveBeenCalledWith({ action: 'Test--1--action' });
  });
});
