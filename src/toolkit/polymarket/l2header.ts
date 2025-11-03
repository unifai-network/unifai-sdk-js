import { ApiKeyCreds } from "@polymarket/clob-client";
import crypto from "crypto";

export interface L2HeaderArgs {
    method: string;
    requestPath: string;
    body?: string;
}

// API key verification
export interface L2PolyHeader {
    POLY_ADDRESS: string;
    POLY_SIGNATURE: string;
    POLY_TIMESTAMP: string;
    POLY_API_KEY: string;
    POLY_PASSPHRASE: string;
}

export const createL2Headers = async (
    address: string,
    creds: ApiKeyCreds,
    l2HeaderArgs: L2HeaderArgs,
    timestamp?: number,
): Promise<L2PolyHeader> => {
    let ts = Math.floor(Date.now() / 1000);
    if (timestamp !== undefined) {
        ts = timestamp;
    }

    const sig = buildPolyHmacSignature(
        creds.secret,
        ts,
        l2HeaderArgs.method,
        l2HeaderArgs.requestPath,
        l2HeaderArgs.body,
    );

    const headers = {
        POLY_ADDRESS: address,
        POLY_SIGNATURE: sig,
        POLY_TIMESTAMP: `${ts}`,
        POLY_API_KEY: creds.key,
        POLY_PASSPHRASE: creds.passphrase,
    };

    return headers;
};

export const buildPolyHmacSignature = (
    secret: string,
    timestamp: number,
    method: string,
    requestPath: string,
    body?: string,
): string => {
    let message = timestamp + method + requestPath;
    if (body !== undefined) {
        message += body;
    }

    if (!secret) {
        throw new Error(`buildPolyHmacSignature, secret is empty`);
    }

    const base64Secret = base64ToBuffer(secret)

    const hmac = crypto.createHmac("sha256", base64Secret);
    const sig = hmac.update(message).digest("base64");

    // NOTE: Must be url safe base64 encoding, but keep base64 "=" suffix
    // Convert '+' to '-'
    // Convert '/' to '_'
    const sigUrlSafe = replaceAll(replaceAll(sig, "+", "-"), "/", "_");
    return sigUrlSafe;
};

function replaceAll(s: string, search: string, replace: string) {
    return s.split(search).join(replace);
}

function base64ToBuffer(base64: string): Uint8Array {
    let binaryString
    try {
        // Replace URL-safe chars
        let str = base64.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4 !== 0) {
            str += '=';
        }

        binaryString = atob(str);
    } catch (e) {
        throw new Error(`base64ToBuffer, base64 str: ${base64}, error: ${e}`);
    }
    
    const len = binaryString.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}
