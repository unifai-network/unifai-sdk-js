
export interface SolanaError {
    code: number;
    message: string;
}

const SOLANA_ERROR_CONFIGS = [
    {
        code: 1,
        message: 'insufficient solana or token balance',
        patterns: [/custom program error: 0x1\b/, /Custom": 1\b/]
    },
    {
        code: 1001,
        message: 'the account you are trying to spend from does not have enough SOL or has not been properly initialized. A newly generated account might require an initial airdrop of SOL or a specific transaction to initialize its state before it can store funds. ',
        patterns: [/Attempt to debit an account but found no record of a prior credit/]
    },
    {
        code: 2001,
        message: 'The specified position account was not found. It may have been closed, expired, or the account address is incorrect.',
        patterns: [/Position account.*not found/]
    },
    {
        code: 3001,
        message: 'Transaction has expired due to network congestion. Please try submitting the transaction again.',
        patterns: [/block height exceeded/]
    },
    {
        code: 3007,
        message: 'The given account is owned by a different program than expected.',
        patterns: [/Custom": 3007\b/]
    },
    {
        code: 4001,
        message: 'The string to be decoded is not correctly encoded.',
        patterns: [/The string to be decoded is not correctly encoded/]
    },
    {
        code: 6024,
        message: 'You might be passing an amount or min_sol_amount that is too large and is resulting in an overflow when calculating the amount of tokens that you will receive.',
        patterns: [/Custom": 6024\b/]
    },
    {
        code: 6059,
        message: 'Order amount is too small.',
        patterns: [/Custom": 6059\b/]
    }
];

export const SOLANA_ERRORS: Record<number, string> = Object.fromEntries(
    SOLANA_ERROR_CONFIGS.map(config => [config.code, config.message])
);

export function getSolanaErrorInfo(error: any): {
    code: number;
    message: string;
} {
    let errorText = '';
    try {
        if (error === null) {
            return { code: 0, message: 'error is null'};
        } else if (error === undefined) {
            return { code: 0, message: 'error is undefined'};
        } else if (typeof error === 'string') {
            errorText = error;
        } else if (typeof error === 'number' || typeof error === 'boolean') {
            errorText = String(error);
        } else if (error instanceof Error || (error && typeof error.message === 'string')) {
            errorText = error.message;
        } else if (error && typeof error === 'object') {
            try {
                errorText = JSON.stringify(error);
            } catch (jsonError) {
                errorText = String(error);
            }
        } else {
            errorText = String(error);
        }
    } catch (conversionError) {
        errorText = '[Error: Unable to convert error to string]';
    }
    
    for (const config of SOLANA_ERROR_CONFIGS) {
        for (const pattern of config.patterns) {
            if (pattern.test(errorText)) {
                return { code: config.code, message: config.message };
            }
        }
    }

    return { code: 0, message: 'Unrecognized error: ' + errorText };
}
