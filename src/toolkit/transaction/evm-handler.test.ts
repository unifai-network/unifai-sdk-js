import { toBeHex } from 'ethers';
import { EVMHandler, smartSend, waitForReceiptWithTimeout } from './evm-handler';

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

describe('waitForReceiptWithTimeout (ethers path)', () => {
  it('tx confirms before timeout → returns receipt', async () => {
    const receipt = { status: 1, hash: '0xabc' };
    const txResponse = {
      hash: '0xabc',
      nonce: 5,
      wait: jest.fn().mockResolvedValue(receipt),
    };

    const result = await waitForReceiptWithTimeout(txResponse, 1000);

    expect(result).toBe(receipt);
    expect(txResponse.wait).toHaveBeenCalledWith(1, 1000);
  });

  it('tx times out (wait throws TIMEOUT) → structured error with hash + nonce', async () => {
    const txResponse = {
      hash: '0xdeadbeef',
      nonce: 42,
      wait: jest.fn().mockImplementation(async () => {
        const err: any = new Error('timeout exceeded');
        err.code = 'TIMEOUT';
        throw err;
      }),
    };

    await expect(
      waitForReceiptWithTimeout(txResponse, 1000),
    ).rejects.toThrow(
      'tx 0xdeadbeef nonce=42 did not confirm within 1000ms',
    );
  });

  it('tx times out (wait returns null) → structured error with hash + nonce', async () => {
    const txResponse = {
      hash: '0xnullhash',
      nonce: 7,
      wait: jest.fn().mockResolvedValue(null),
    };

    await expect(
      waitForReceiptWithTimeout(txResponse, 500),
    ).rejects.toThrow(
      'tx 0xnullhash nonce=7 did not confirm within 500ms',
    );
  });

  it('non-timeout error from wait propagates unchanged', async () => {
    const txResponse = {
      hash: '0xrevert',
      nonce: 1,
      wait: jest.fn().mockImplementation(async () => {
        throw new Error('execution reverted');
      }),
    };

    await expect(
      waitForReceiptWithTimeout(txResponse, 1000),
    ).rejects.toThrow('execution reverted');
  });

  it('viem-style timeout name (WaitForTransactionReceiptTimeoutError) is recognized', async () => {
    const txResponse = {
      hash: '0xviem',
      nonce: 4,
      wait: jest.fn().mockImplementation(async () => {
        const err: any = new Error('Timed out while waiting');
        err.name = 'WaitForTransactionReceiptTimeoutError';
        throw err;
      }),
    };

    await expect(
      waitForReceiptWithTimeout(txResponse, 750),
    ).rejects.toThrow(
      'tx 0xviem nonce=4 did not confirm within 750ms',
    );
  });
});

describe('EVMHandler.sendTransaction wait timeout', () => {
  // Build a minimal Polygon-style legacy tx hex for ethers.Transaction.from()
  // (any valid signed-tx hex would do; this is "transfer 1 wei to 0x0").
  // Using a known-good fixture from ethers test vectors.
  const VALID_TX_HEX =
    '0xf86c8085012a05f200825208940000000000000000000000000000000000000000018025a0e74e8b1cd6cf28e89e0a32f4b8e74dac56c8c8e4c4f4d6f6c8d3e2f3c5b8a7d6a01a98f6f3a3eb05f6f9d2e9c7b3f8c1d4f9e7c2a5b8d1f4e6c3a9b2d8f5e1c7b3';

  function makeWagmiSigner() {
    return {
      account: { address: '0x0000000000000000000000000000000000000aaa' },
      getAddresses: jest.fn().mockResolvedValue([
        '0x0000000000000000000000000000000000000aaa',
      ]),
      sendTransaction: jest.fn().mockResolvedValue('0xabc'),
      signTypedData: jest.fn(),
      waitForTransactionReceipt: jest.fn(),
    };
  }

  it('wagmi path forwards txWaitTimeoutMs as `timeout` option', async () => {
    const handler = new EVMHandler();
    const signer = makeWagmiSigner();
    signer.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

    // ethers.Transaction.from will need a valid hex; use a parsed one via the
    // Transaction class. Easiest is to just feed an unsigned tx directly via
    // the underlying logic. Skip if not parseable — focus on call propagation.
    let parsed = false;
    try {
      const { Transaction } = await import('ethers');
      Transaction.from(VALID_TX_HEX);
      parsed = true;
    } catch {
      // signature validation can fail on random hex; build a minimal signed tx
    }

    if (!parsed) {
      // Build a fresh signed tx via a throwaway wallet
      const { Wallet, Transaction } = await import('ethers');
      const w = Wallet.createRandom();
      const built = await w.signTransaction({
        to: '0x0000000000000000000000000000000000000000',
        value: 1n,
        nonce: 0,
        gasLimit: 21000n,
        maxFeePerGas: 1000000000n,
        maxPriorityFeePerGas: 1000000000n,
        chainId: 137n,
        type: 2,
      });
      Transaction.from(built);
      await handler.sendTransaction(signer as any, { hex: built }, {
        txWaitTimeoutMs: 12345,
      });
    }

    expect(signer.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(signer.waitForTransactionReceipt.mock.calls[0][0]).toMatchObject({
      timeout: 12345,
    });
  });

  it('wagmi path: timeout error → structured error with hash', async () => {
    const handler = new EVMHandler();
    const signer = makeWagmiSigner();
    signer.waitForTransactionReceipt.mockImplementation(async () => {
      const err: any = new Error('Timed out while waiting');
      throw err;
    });

    const { Wallet, Transaction } = await import('ethers');
    const w = Wallet.createRandom();
    const built = await w.signTransaction({
      to: '0x0000000000000000000000000000000000000000',
      value: 1n,
      nonce: 0,
      gasLimit: 21000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000000n,
      chainId: 137n,
      type: 2,
    });
    Transaction.from(built);

    await expect(
      handler.sendTransaction(signer as any, { hex: built }, {
        txWaitTimeoutMs: 500,
      }),
    ).rejects.toThrow(/did not confirm within 500ms/);
  });
});
