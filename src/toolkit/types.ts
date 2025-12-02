
export interface SendConfig {
    rpcUrls?: string[], // rpc urls to send transactions
    proxyUrl?: string   // proxy server to forward transaction
    txData?: any        // transaction data to send
    txInterval?: number // interval(seconds) to between transactions
    onFailure?: 'skip' | 'stop' // skip: skip a failure transaction and continue, stop: stop the failure transaction and throw an error
    useJito?: boolean // enable/disable jito for solana transactions
    jitoProvider?: 'jito' | 'quicknode' // jito provider: jito (original) or quicknode, defaults to quicknode
    jitoEndpoint?: string // jito block engine endpoint (for original jito provider) or quicknode endpoint (for quicknode provider)
    jitoApiKey?: string // jito api key (for original jito provider)
    jitoTipAmount?: number // jito tip amount in lamports
    broadcastMode?: 'sequential' | 'concurrent' // sequential: try rpcs one by one (default), concurrent: send to all rpcs at once, success if any succeeds
}

export type Signer = EtherSigner | WagmiSigner | SolanaSigner;

export interface EtherSigner {
    address: string;

    sendTransaction: (tx: any) => Promise<any>;
    signTypedData: (domain: any, types: any, value: any) => Promise<string>
}

export interface WagmiSigner {
    account: any
    getAddresses: () => Promise<string[]>;

    sendTransaction: (tx: any) => Promise<any>;
    signTypedData: (data: any) => Promise<string>
    waitForTransactionReceipt?: (h: {hash: string}) => Promise<any>
}

export interface SolanaSigner {
    publicKey: { toBase58: () => string }; // solana provider

    signTransaction: (tx: any) => Promise<any>;
    signAllTransactions?: (txs: any[]) => Promise<any[]>;
}

export function isEtherSigner(signer: any): boolean {
    return typeof signer === 'object' && 'address' in signer &&
        'sendTransaction' in signer && 'signTypedData' in signer
}

export function isWagmiSigner(signer: any): boolean {
    return typeof signer === 'object' && 'account' in signer &&
        'getAddresses' in signer && 'sendTransaction' in signer &&
        'signTypedData' in signer
}

export function isSolanaSigner(signer: any): boolean {
    return typeof signer === 'object' && 'publicKey' in signer &&
        'signTransaction' in signer
}

export async function getSignerAddress(signer: Signer): Promise<string> {
  let address: string = "";

  if (isEtherSigner(signer)) {
    address = (signer as EtherSigner).address; // ethers signer
  } else if (isSolanaSigner(signer)) {
    address = (signer as SolanaSigner).publicKey.toBase58(); // solana provider
  } else if (isWagmiSigner(signer)) {
    // wagmi wallet
    const addresses = await (signer as WagmiSigner).getAddresses(); // ethers signer with getAddresses method
    if (addresses.length > 0) {
      address = addresses[0]; // Use the first address
    }
  } else {
    throw new Error("Signer does not have an address or publicKey.");
  }

  return address;
}
