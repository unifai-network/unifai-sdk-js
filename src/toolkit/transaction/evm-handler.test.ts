import { toBeHex } from 'ethers';
import { smartSend } from './evm-handler';

function makeSigner(opts: {
  latest: number;
  pending: number;
  feeData?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  address?: string;
}) {
  const sendTransaction = jest.fn().mockResolvedValue({ hash: '0xfake' });
  const provider = {
    getTransactionCount: jest
      .fn()
      .mockImplementation(async (_addr: string, blockTag: string) => {
        return blockTag === 'pending' ? opts.pending : opts.latest;
      }),
    getFeeData: jest.fn().mockResolvedValue(
      opts.feeData ?? { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
    ),
  };
  return {
    address: opts.address ?? '0x0000000000000000000000000000000000000aaa',
    sendTransaction,
    signTypedData: jest.fn(),
    provider,
  };
}

describe('smartSend', () => {
  it('stuckCount=0 → no nonce/gas override (default threshold)', async () => {
    const signer = makeSigner({ latest: 100, pending: 100 });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
    expect(txParams.maxPriorityFeePerGas).toBeUndefined();
  });

  it('stuckCount=10 at default threshold (10) → no override (strict >)', async () => {
    const signer = makeSigner({ latest: 100, pending: 110 });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
    expect(txParams.maxPriorityFeePerGas).toBeUndefined();
  });

  it('stuckCount=15 at default threshold → nonce=latest, gas bumped 1.25x feeData', async () => {
    const signer = makeSigner({
      latest: 100,
      pending: 115,
      feeData: { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
    });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBe(100);
    // 100 * 125 / 100 = 125 (bigint integer division)
    expect(txParams.maxFeePerGas).toBe(toBeHex(125n));
    // 10 * 125 / 100 = 12 (bigint integer division)
    expect(txParams.maxPriorityFeePerGas).toBe(toBeHex(12n));
  });

  it('stuckCount=15 with user-set higher gas → user gas preserved (max wins)', async () => {
    const signer = makeSigner({
      latest: 100,
      pending: 115,
      feeData: { maxFeePerGas: 100n, maxPriorityFeePerGas: 10n },
    });
    const txParams: any = {
      to: '0xdead',
      maxFeePerGas: toBeHex(200n), // already above 1.25x bump (125n)
      maxPriorityFeePerGas: toBeHex(50n), // already above 1.25x bump (12n)
    };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBe(100);
    expect(txParams.maxFeePerGas).toBe(toBeHex(200n));
    expect(txParams.maxPriorityFeePerGas).toBe(toBeHex(50n));
  });

  it('stuckCount=15 with custom threshold=20 → no override', async () => {
    const signer = makeSigner({ latest: 100, pending: 115 });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams, { stuckThreshold: 20 });

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
    expect(txParams.maxPriorityFeePerGas).toBeUndefined();
  });

  it('signer without provider → bypass stuck check, pass through to native send', async () => {
    const signer = {
      address: '0x0000000000000000000000000000000000000aaa',
      sendTransaction: jest.fn().mockResolvedValue({ hash: '0xfake' }),
      signTypedData: jest.fn(),
      // no provider — wagmi-style signer with viem WalletClient under the hood
    };
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
  });

  it('probe failure (RPC rejects pending tag) → graceful fallback to native send', async () => {
    const signer = {
      address: '0x0000000000000000000000000000000000000aaa',
      sendTransaction: jest.fn().mockResolvedValue({ hash: '0xfake' }),
      signTypedData: jest.fn(),
      provider: {
        getTransactionCount: jest
          .fn()
          .mockImplementation(async (_addr: string, blockTag: string) => {
            if (blockTag === 'pending') {
              throw new Error('pending tag not supported');
            }
            return 100;
          }),
        getFeeData: jest.fn().mockResolvedValue({
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 10n,
        }),
      },
    };
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
  });

  it('legacy-fee chain (gasPrice only) → bumps gasPrice, not maxFeePerGas', async () => {
    const signer = makeSigner({
      latest: 100,
      pending: 115,
      feeData: {
        // Legacy chain: only gasPrice, no EIP-1559 fields
        ...({} as any),
      },
    });
    // override feeData to legacy-only
    signer.provider.getFeeData = jest.fn().mockResolvedValue({
      gasPrice: 80n,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBe(100);
    // 80 * 125 / 100 = 100 (bigint integer division)
    expect(txParams.gasPrice).toBe(toBeHex(100n));
    expect(txParams.maxFeePerGas).toBeUndefined();
    expect(txParams.maxPriorityFeePerGas).toBeUndefined();
  });

  it('legacy-fee chain with user-set higher gasPrice → user gasPrice preserved', async () => {
    const signer = makeSigner({ latest: 100, pending: 115 });
    signer.provider.getFeeData = jest.fn().mockResolvedValue({
      gasPrice: 80n,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    const txParams: any = {
      to: '0xdead',
      gasPrice: toBeHex(150n), // > bumped 100n
    };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(txParams.nonce).toBe(100);
    expect(txParams.gasPrice).toBe(toBeHex(150n));
  });

  it('feeData has neither EIP-1559 nor gasPrice → skip rewrite entirely (do not ship unreplaceable tx)', async () => {
    const signer = makeSigner({ latest: 100, pending: 115 });
    signer.provider.getFeeData = jest.fn().mockResolvedValue({
      gasPrice: null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    const txParams: any = { to: '0xdead' };

    await smartSend(signer as any, txParams);

    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    // Don't override nonce since we can't bump gas — better to send original
    expect(txParams.nonce).toBeUndefined();
    expect(txParams.gasPrice).toBeUndefined();
    expect(txParams.maxFeePerGas).toBeUndefined();
  });
});
