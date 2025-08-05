
export interface SendConfig {
    rpcUrls?: string[], // rpc urls to send transactions
    proxyUrl?: string   // proxy server to forward transaction
    txData?: any        // transaction data to send
    txInterval?: number // interval(seconds) to between transactions
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

    signTransaction?: (tx: any) => Promise<any>;
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
