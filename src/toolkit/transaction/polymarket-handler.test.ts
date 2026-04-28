import { PolymarketHandler } from './polymarket-handler';

jest.mock('../polymarket/apikey', () => ({
  deriveApiKey: jest.fn().mockResolvedValue({
    key: 'k',
    secret: 'czozOiJrZXkiOw==',
    passphrase: 'p',
  }),
}));

jest.mock('../polymarket/l2header', () => ({
  createL2Headers: jest.fn().mockResolvedValue({}),
}));

function makeV2DivergentTx() {
  // V2-shaped orderData (wire body): string `side`, includes `expiration`.
  const orderData = {
    salt: '12345',
    maker: '0x0000000000000000000000000000000000000aaa',
    signer: '0x0000000000000000000000000000000000000bbb',
    taker: '0x0000000000000000000000000000000000000000',
    tokenId:
      '110911393889010401219917173855584925686973021175313548804633338062307014657846',
    makerAmount: '1000000',
    takerAmount: '500000',
    side: 'BUY',
    signatureType: 0,
    timestamp: '1700000000000',
    expiration: '0',
    metadata: '0x' + '00'.repeat(32),
    builder: '0x' + '00'.repeat(32),
    signature: '',
  };
  // V2-shaped typedData.message: uint8 `side`, NO `expiration`.
  const typedDataMessage = {
    salt: '12345',
    maker: '0x0000000000000000000000000000000000000aaa',
    signer: '0x0000000000000000000000000000000000000bbb',
    tokenId:
      '110911393889010401219917173855584925686973021175313548804633338062307014657846',
    makerAmount: '1000000',
    takerAmount: '500000',
    side: 0,
    signatureType: 0,
    timestamp: '1700000000000',
    metadata: '0x' + '00'.repeat(32),
    builder: '0x' + '00'.repeat(32),
  };
  const typedData = {
    domain: {
      name: 'Polymarket CTF Exchange',
      version: '2',
      chainId: 137,
      verifyingContract: '0xE111180000d2663C0091e4f400237545B87B996B',
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'makerAmount', type: 'uint256' },
        { name: 'takerAmount', type: 'uint256' },
        { name: 'side', type: 'uint8' },
        { name: 'signatureType', type: 'uint8' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'metadata', type: 'bytes32' },
        { name: 'builder', type: 'bytes32' },
      ],
    },
    primaryType: 'Order',
    message: typedDataMessage,
  };
  return {
    tx: {
      hex: JSON.stringify({
        data: { orderData, typedData },
        orderType: 'GTC',
      }),
    },
    typedDataMessage,
    typedData,
    orderData,
  };
}

describe('PolymarketHandler V2 signing fix', () => {
  it('signs typedData.message (not orderData) on the ethers path', async () => {
    const { tx, typedDataMessage } = makeV2DivergentTx();
    const signTypedData = jest.fn().mockResolvedValue('0xfakesig');
    const signer = { signTypedData };

    const handler = new PolymarketHandler();
    await handler
      .sendOrderTransaction(signer as any, tx, '0xowner')
      .catch(() => undefined);

    expect(signTypedData).toHaveBeenCalledTimes(1);
    const [domainArg, typesArg, messageArg] = signTypedData.mock.calls[0];
    expect(domainArg.version).toBe('2');
    expect(typesArg.EIP712Domain).toBeUndefined();
    // Critical: signed payload must be typedData.message — uint8 side, no expiration.
    expect(messageArg).toEqual(typedDataMessage);
    expect(messageArg.side).toBe(0);
    expect(messageArg).not.toHaveProperty('expiration');
    expect(messageArg).not.toHaveProperty('taker');
    expect(messageArg).not.toHaveProperty('signature');
  });

  it('signs typedData.message (not orderData) on the wagmi path', async () => {
    const { tx, typedDataMessage } = makeV2DivergentTx();
    const signTypedData = jest.fn().mockResolvedValue('0xfakesig');
    const signer = {
      account: { address: '0xowner' },
      getAddresses: jest.fn().mockResolvedValue(['0xowner']),
      sendTransaction: jest.fn(),
      signTypedData,
    };

    const handler = new PolymarketHandler();
    await handler
      .sendOrderTransaction(signer as any, tx, '0xowner')
      .catch(() => undefined);

    expect(signTypedData).toHaveBeenCalledTimes(1);
    const [callArg] = signTypedData.mock.calls[0];
    expect(callArg.domain.version).toBe('2');
    expect(callArg.primaryType).toBe('Order');
    // Critical: message field of the wagmi call must be typedData.message.
    expect(callArg.message).toEqual(typedDataMessage);
    expect(callArg.message.side).toBe(0);
    expect(callArg.message).not.toHaveProperty('expiration');
  });

  it('routes V2-shaped orders to orderToJsonV2 (preserves timestamp/metadata/builder)', async () => {
    const { tx } = makeV2DivergentTx();
    const sentBodies: any[] = [];
    const signer = { signTypedData: jest.fn().mockResolvedValue('0xfakesig') };

    const handler = new PolymarketHandler(undefined, async (_chain, _name, payload) => {
      sentBodies.push(payload.data);
      return {};
    });

    await handler.sendOrderTransaction(signer as any, tx, '0xowner');

    expect(sentBodies).toHaveLength(1);
    const order = sentBodies[0].order;
    expect(order).toHaveProperty('timestamp');
    expect(order).toHaveProperty('metadata');
    expect(order).toHaveProperty('builder');
  });

  it('routes V1-shaped orders to orderToJsonV1 (no V2 fields on the wire)', async () => {
    // V1-shaped orderData: has nonce + feeRateBps, NO timestamp/metadata/builder.
    const orderData = {
      salt: '12345',
      maker: '0x0000000000000000000000000000000000000aaa',
      signer: '0x0000000000000000000000000000000000000bbb',
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: '99',
      makerAmount: '1000000',
      takerAmount: '500000',
      side: 'BUY',
      signatureType: 0,
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      signature: '',
    };
    // For the V1 path we still need a typedData object to drive the signer.
    const typedData = {
      domain: {
        name: 'Polymarket CTF Exchange',
        version: '1',
        chainId: 137,
        verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Order: [{ name: 'salt', type: 'uint256' }],
      },
      primaryType: 'Order',
      message: { salt: '12345' },
    };
    const tx = {
      hex: JSON.stringify({ data: { orderData, typedData }, orderType: 'GTC' }),
    };

    const sentBodies: any[] = [];
    const signer = { signTypedData: jest.fn().mockResolvedValue('0xfakesig') };
    const handler = new PolymarketHandler(undefined, async (_c, _n, payload) => {
      sentBodies.push(payload.data);
      return {};
    });

    await handler.sendOrderTransaction(signer as any, tx, '0xowner');

    expect(sentBodies).toHaveLength(1);
    const order = sentBodies[0].order;
    expect(order).not.toHaveProperty('timestamp');
    expect(order).not.toHaveProperty('metadata');
    expect(order).not.toHaveProperty('builder');
  });
});
