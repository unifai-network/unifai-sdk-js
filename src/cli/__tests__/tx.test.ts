jest.mock('../signing', () => ({
  parseChainFromTxId: jest.fn().mockReturnValue('solana'),
  getSignerForChain: jest.fn().mockReturnValue({ publicKey: { toBase58: () => 'pub' }, signTransaction: jest.fn() }),
  executeSigningFlow: jest.fn().mockResolvedValue({
    address: 'addr',
    txId: 'solana-abc',
    hash: ['0xhash1'],
  }),
}));

describe('tx command', () => {
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
    const { registerTxCommand } = require('../commands/tx');
    const program = new Command();
    program.option('--config <path>').option('--api-key <key>').option('--endpoint <url>').option('--timeout <ms>');
    registerTxCommand(program);
    return program;
  }

  it('should sign transaction successfully (human output)', async () => {
    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'tx', 'sign', 'solana-abc']);

    expect(logSpy).toHaveBeenCalledWith('Address: addr');
    expect(logSpy).toHaveBeenCalledWith('TxID:    solana-abc');
    expect(logSpy).toHaveBeenCalledWith('Hash:    0xhash1');
  });

  it('should sign transaction with --json', async () => {
    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'tx', 'sign', 'solana-abc', '--json']);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.address).toBe('addr');
    expect(parsed.txId).toBe('solana-abc');
    expect(parsed.hash).toEqual(['0xhash1']);
  });

  it('should error when API key is missing', async () => {
    delete process.env.UNIFAI_AGENT_API_KEY;

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'tx', 'sign', 'solana-abc']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: API key is required'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should error when chain cannot be determined', async () => {
    const { parseChainFromTxId } = require('../signing');
    (parseChainFromTxId as jest.Mock).mockReturnValueOnce('');

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'tx', 'sign', 'badtxid']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot determine chain'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should error when private key is missing for chain', async () => {
    const { getSignerForChain } = require('../signing');
    (getSignerForChain as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Solana private key is required');
    });

    const program = setupProgram();
    await program.parseAsync(['node', 'test', 'tx', 'sign', 'solana-abc']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Solana private key is required'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
