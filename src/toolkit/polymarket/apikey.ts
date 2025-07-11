import { ApiKeyCreds, Chain, L1PolyHeader } from "@polymarket/clob-client";
import { get, RequestOptions } from '@polymarket/clob-client/dist/http-helpers'
import { polymarketClobUrl, chainId } from './const';

const DERIVE_API_KEY = "/auth/derive-api-key";
export const MSG_TO_SIGN = "This message attests that I control the given wallet";

export async function deriveApiKey(address: string, signer: any): Promise<ApiKeyCreds> {
    try {
        const endpoint = `${polymarketClobUrl}${DERIVE_API_KEY}`;
        if (!signer.getAddress) {
            signer.getAddress = async ()=>{
                return address
            }
        }

        const headers = await createL1Headers(address, signer, chainId,);

        const apiKeyRaw = await myGet(endpoint, { headers })
        const apiKey: ApiKeyCreds = {
            key: apiKeyRaw.apiKey,
            secret: apiKeyRaw.secret,
            passphrase: apiKeyRaw.passphrase,
        };
        return apiKey;
    } catch (error) {
        throw new Error(`deriveApiKey error: ${error}, signTypedData length: ${signer.signTypedData?.length}`);
    }
}

async function createL1Headers(address: string, signer: any, chainId: Chain,): Promise<L1PolyHeader> {
    let ts = Math.floor(Date.now() / 1000);
    let n = 0; // Default nonce is 0

    const sig = await buildClobEip712Signature(address, signer, chainId, ts, n);

    const headers = {
        POLY_ADDRESS: address,
        POLY_SIGNATURE: sig,
        POLY_TIMESTAMP: `${ts}`,
        POLY_NONCE: `${n}`,
    };
    return headers;
};

async function buildClobEip712Signature(address: string, signer: any,
    chainId: Chain, timestamp: number, nonce: number): Promise<string> {
    const ts = `${timestamp}`;

    const domain = {
        name: "ClobAuthDomain",
        version: "1",
        chainId: chainId,
    };

    const types = {
        ClobAuth: [
            { name: "address", type: "address" },
            { name: "timestamp", type: "string" },
            { name: "nonce", type: "uint256" },
            { name: "message", type: "string" },
        ],
    };
    const value = {
        address,
        timestamp: ts,
        nonce,
        message: MSG_TO_SIGN,
    };
    // eslint-disable-next-line no-underscore-dangle
    let sig: any

    if (signer.signTypedData.length == 3) {
        sig = await signer.signTypedData(domain, types, value);
    } else {
        sig = await signer.signTypedData({ account: address, domain, types, 
            message: value, primaryType:'ClobAuth' });
    }

    return sig;
};

async function myGet(endpoint: string, options?: RequestOptions) {
    return get(endpoint, {
        ...options,
        params: { ...options?.params, },
    });
}