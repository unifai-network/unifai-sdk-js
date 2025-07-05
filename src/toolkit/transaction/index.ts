export * from './evm'
export * from './polymarket'
export * from './solana'


export interface Signer {
    // the signer should have one of these properties for wallet address retrieval
    address?: string; // ethers signer
    account?: any // wagmi wallet account
    publicKey?: { toBase58: () => string }; // solana provider
    getAddress?: () => Promise<string>; 
    getAddresses?: () => Promise<string[]>; 

    signTransaction?: (tx: any) => Promise<string>; 
    sendTransaction?: (tx: any) => Promise<{ hash: string }>; 

    // for polymarket, need signTypedData method
    [key:string]: any;
}