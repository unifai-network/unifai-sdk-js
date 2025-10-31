import { ApiKeyCreds, Chain, L1PolyHeader } from "@polymarket/clob-client";
import { get, post, RequestOptions } from '@polymarket/clob-client/dist/http-helpers'
import { polymarketClobUrl, chainId } from './const';
import { RateLimiter } from '../../common/rate-limiter';

// In-memory cache for API keys, keyed by address
const apiKeyCache = new Map<string, ApiKeyCreds>();

export async function deriveApiKey(address: string, signer: any, rateLimiter?: RateLimiter): Promise<ApiKeyCreds> {
    const cacheKey = address.toLowerCase();
    const cachedApiKey = apiKeyCache.get(cacheKey);
    if (cachedApiKey) {
        return cachedApiKey;
    }

    const DERIVE_API_KEY = "/auth/derive-api-key";

    try {
        const endpoint = `${polymarketClobUrl}${DERIVE_API_KEY}`;

        const headers = await createL1Headers(address, signer, chainId, rateLimiter);

        await rateLimiter?.waitForLimit('polymarket_deriveApiKey');
        let apiKeyRaw = await myGet(endpoint, { headers })

        if (!apiKeyRaw || !apiKeyRaw.apiKey || !apiKeyRaw.secret || !apiKeyRaw.passphrase) {
            const apiKey = await createApiKey(address, signer, rateLimiter)
            if (!apiKey) {
                throw new Error(`fetch api key failed, response: ${JSON.stringify(apiKey)}`);
            }

            apiKeyCache.set(cacheKey, apiKey);
            return apiKey
        }

        const apiKey: ApiKeyCreds = {
            key: apiKeyRaw.apiKey,
            secret: apiKeyRaw.secret,
            passphrase: apiKeyRaw.passphrase,
        };

        apiKeyCache.set(cacheKey, apiKey);
        return apiKey;

    } catch (error) {
        throw new Error(`deriveApiKey error: ${error}, signTypedData length: ${signer.signTypedData?.length}`);
    }
}

async function createL1Headers(address: string, signer: any, chainId: Chain, rateLimiter?: RateLimiter): Promise<L1PolyHeader> {
    let ts = Math.floor(Date.now() / 1000);
    let n = 0; // Default nonce is 0

    const sig = await buildClobEip712Signature(address, signer, chainId, ts, n, rateLimiter);

    const headers = {
        POLY_ADDRESS: address,
        POLY_SIGNATURE: sig,
        POLY_TIMESTAMP: `${ts}`,
        POLY_NONCE: `${n}`,
    };
    return headers;
};

async function buildClobEip712Signature(address: string, signer: any,
    chainId: Chain, timestamp: number, nonce: number, rateLimiter?: RateLimiter): Promise<string> {
    const MSG_TO_SIGN = "This message attests that I control the given wallet";
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

    try {
        let sig: any
        await rateLimiter?.waitForLimit('evm_signTypedData');
        if (signer.signTypedData.length == 3) {
            sig = await signer.signTypedData(
                domain,
                types,
                value,
            );
        } else {
            sig = await signer.signTypedData({
                account: address,
                domain,
                types,
                message: value,
                primaryType: 'ClobAuth',
            });
        }

        return sig;
    } catch (error) {
        throw new Error(`buildClobEip712Signature error: ${error}`);
    }
};

async function myGet(endpoint: string, options?: RequestOptions) {
    return get(endpoint, {
        ...options,
        params: { ...options?.params, },
    });
}

async function myPost(endpoint: string, options?: RequestOptions) {
    return post(endpoint, {
        ...options,
        params: { ...options?.params, },
    });
}

async function createApiKey(address: string, signer: any, rateLimiter?: RateLimiter): Promise<ApiKeyCreds> {
    const CREATE_API_KEY = "/auth/api-key";

    const endpoint = `${polymarketClobUrl}${CREATE_API_KEY}`;

    const headers = await createL1Headers(address, signer, chainId, rateLimiter);

    await rateLimiter?.waitForLimit('polymarket_createApiKey');
    const apiKeyRaw = await myPost(endpoint, { headers })
    if (!apiKeyRaw || !apiKeyRaw.apiKey || !apiKeyRaw.secret || !apiKeyRaw.passphrase) {
        throw new Error(`create api key failed, apiKeyRaw: ${JSON.stringify(apiKeyRaw)}`);
    }

    const apiKey: ApiKeyCreds = {
        key: apiKeyRaw.apiKey,
        secret: apiKeyRaw.secret,
        passphrase: apiKeyRaw.passphrase,
    };

    return apiKey;
}