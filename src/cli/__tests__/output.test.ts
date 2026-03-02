import {
  printJSON,
  printSearch,
  normalizeInvokeResponse,
  printValue,
  extractTxId,
  printSignResult,
  printError,
} from '../output';

describe('output', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('printJSON', () => {
    it('should output 2-space indented JSON', () => {
      printJSON({ a: 1, b: 'two' });
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ a: 1, b: 'two' }, null, 2));
    });

    it('should handle arrays', () => {
      printJSON([1, 2, 3]);
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2));
    });
  });

  describe('printSearch', () => {
    it('should output numbered list', () => {
      const items = [
        { action: 'Solana--7--swap', description: 'Swap tokens on Solana' },
        { action: 'ETH--1--transfer', description: 'Transfer ETH' },
      ];
      printSearch(items);
      expect(logSpy).toHaveBeenCalledWith('1. Solana--7--swap - Swap tokens on Solana');
      expect(logSpy).toHaveBeenCalledWith('2. ETH--1--transfer - Transfer ETH');
    });

    it('should handle name field fallback', () => {
      const items = [{ name: 'TestAction', description: 'desc' }];
      printSearch(items);
      expect(logSpy).toHaveBeenCalledWith('1. TestAction - desc');
    });

    it('should handle missing fields', () => {
      const items = [{}];
      printSearch(items);
      expect(logSpy).toHaveBeenCalledWith('1. Unknown - ');
    });
  });

  describe('normalizeInvokeResponse', () => {
    it('should extract payload when present', () => {
      const resp = { payload: { data: 'hello' }, other: 'stuff' };
      expect(normalizeInvokeResponse(resp)).toEqual({ data: 'hello' });
    });

    it('should return response as-is when no payload', () => {
      const resp = { data: 'hello' };
      expect(normalizeInvokeResponse(resp)).toEqual({ data: 'hello' });
    });

    it('should return primitives as-is', () => {
      expect(normalizeInvokeResponse('hello')).toBe('hello');
      expect(normalizeInvokeResponse(42)).toBe(42);
      expect(normalizeInvokeResponse(null)).toBe(null);
    });
  });

  describe('printValue', () => {
    it('should print primitives directly', () => {
      printValue('hello');
      expect(logSpy).toHaveBeenCalledWith('hello');

      printValue(42);
      expect(logSpy).toHaveBeenCalledWith('42');
    });

    it('should print objects as JSON', () => {
      printValue({ a: 1 });
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
    });

    it('should handle null and undefined', () => {
      printValue(null);
      expect(logSpy).toHaveBeenCalledWith('null');

      printValue(undefined);
      expect(logSpy).toHaveBeenCalledWith('undefined');
    });
  });

  describe('extractTxId', () => {
    it('should extract top-level txId', () => {
      expect(extractTxId({ txId: 'solana-abc123' })).toBe('solana-abc123');
    });

    it('should extract nested payload txId', () => {
      expect(extractTxId({ payload: { txId: 'ethereum-0xdef' } })).toBe('ethereum-0xdef');
    });

    it('should return null for no txId', () => {
      expect(extractTxId({ data: 'hello' })).toBeNull();
    });

    it('should return null for empty/null', () => {
      expect(extractTxId(null)).toBeNull();
      expect(extractTxId(undefined)).toBeNull();
      expect(extractTxId({})).toBeNull();
    });

    it('should return null for empty string txId', () => {
      expect(extractTxId({ txId: '' })).toBeNull();
    });

    it('should prefer top-level txId', () => {
      expect(extractTxId({ txId: 'top', payload: { txId: 'nested' } })).toBe('top');
    });
  });

  describe('printSignResult', () => {
    const result = {
      address: '0xABC',
      txId: 'ethereum-123',
      hash: ['0xhash1', '0xhash2'],
      data: { key: 'val' },
    };

    it('should print human-readable format', () => {
      printSignResult(result, false);
      expect(logSpy).toHaveBeenCalledWith('Address: 0xABC');
      expect(logSpy).toHaveBeenCalledWith('TxID:    ethereum-123');
      expect(logSpy).toHaveBeenCalledWith('Hash:    0xhash1, 0xhash2');
      expect(logSpy).toHaveBeenCalledWith('Data:    {"key":"val"}');
    });

    it('should print JSON format', () => {
      printSignResult(result, true);
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });

    it('should handle result with error', () => {
      const errResult = { address: '0x1', txId: 'sol-1', error: 'failed' };
      printSignResult(errResult, false);
      expect(logSpy).toHaveBeenCalledWith('Error:   failed');
    });

    it('should omit hash line if no hashes', () => {
      const noHash = { address: '0x1', txId: 'sol-1' };
      printSignResult(noHash, false);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Hash:'));
    });
  });

  describe('printError', () => {
    it('should print to stderr', () => {
      printError('something went wrong');
      expect(errorSpy).toHaveBeenCalledWith('Error: something went wrong');
    });
  });
});
