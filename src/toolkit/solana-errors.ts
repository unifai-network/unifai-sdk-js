
export interface SolanaError {
    code: number;
    message: string;
}

export const SOLANA_ERRORS: Record<number, string> = {
    1: 'insufficient solana or token balance',
    
    1001: 'the account you are trying to spend from does not have enough SOL or has not been properly initialized. A newly generated account might require an initial airdrop of SOL or a specific transaction to initialize its state before it can store funds. ',

    2001: 'The specified position account was not found. It may have been closed, expired, or the account address is incorrect.',

    3001: 'Transaction has expired due to network congestion. Please try submitting the transaction again.',
    3007: 'The given account is owned by a different program than expected.',
    
    4001: 'The string to be decoded is not correctly encoded.',

    6024: 'You might be passing an amount or min_sol_amount that is too large and is resulting in an overflow when calculating the amount of tokens that you will receive.',

};

export function getSolanaErrorInfo(error: any): {
    code: number;
    message: string;
} {
    if (error == null || error == undefined) {
        return { code: 0, message: 'error is null or undefined'};
    }

    let errorText = '';
    try {
        if (error.message) {
            errorText = error.message;
        } else {
            errorText = JSON.stringify(error);
        }
    } catch (jsonError) {
        errorText = error.toString();
    }
    
    if (/custom program error: 0x1\b/.test(errorText)) {
        return { code: 1, message: SOLANA_ERRORS[1] };

    } else if (/Custom": 1\b/.test(errorText)) {
        return { code: 1, message: SOLANA_ERRORS[1] };

    } else if (errorText.includes('Attempt to debit an account but found no record of a prior credit')) {
        return { code: 1001, message: SOLANA_ERRORS[1001] };

    } else if (errorText.includes('Position account') && errorText.includes('not found')) {
        return { code: 2001, message: SOLANA_ERRORS[2001] };

    } else if (errorText.includes('block height exceeded')) {
        return { code: 3001, message: SOLANA_ERRORS[3001] };

    } else if (/Custom": 3007\b/.test(errorText)) {
        return { code: 3007, message: SOLANA_ERRORS[3007] };

    } else if (errorText.includes('The string to be decoded is not correctly encoded')) {
        return { code: 4001, message: SOLANA_ERRORS[4001] };

    } else if (/Custom": 6024\b/.test(errorText)) {
        return { code: 6024, message: SOLANA_ERRORS[6024] };
    }

    return { code: 0, message: 'Unknown error: ' + errorText };
}

