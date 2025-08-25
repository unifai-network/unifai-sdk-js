import { getSolanaErrorInfo, SOLANA_ERRORS } from './solana-errors';

describe('getSolanaErrorInfo', () => {
    describe('null and undefined handling', () => {
        it('should handle null error', () => {
            const result = getSolanaErrorInfo(null);
            expect(result.code).toBe(0);
            expect(result.message).toBe('error is null');
        });

        it('should handle undefined error', () => {
            const result = getSolanaErrorInfo(undefined);
            expect(result.code).toBe(0);
            expect(result.message).toBe('error is undefined');
        });
    });

    describe('primitive type handling', () => {
        it('should handle string errors', () => {
            const result = getSolanaErrorInfo('custom program error: 0x1');
            expect(result.code).toBe(1);
            expect(result.message).toBe(SOLANA_ERRORS[1]);
        });

        it('should handle number errors', () => {
            const result = getSolanaErrorInfo(123);
            expect(result.code).toBe(0);
            expect(result.message).toBe('Unrecognized error: 123');
        });

        it('should handle boolean errors', () => {
            const result = getSolanaErrorInfo(true);
            expect(result.code).toBe(0);
            expect(result.message).toBe('Unrecognized error: true');
        });
    });

    describe('Error object handling', () => {
        it('should handle Error objects with message', () => {
            const error = new Error('custom program error: 0x1');
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(1);
            expect(result.message).toBe(SOLANA_ERRORS[1]);
        });

        it('should handle error-like objects with message property', () => {
            const error = { message: 'block height exceeded' };
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(3001);
            expect(result.message).toBe(SOLANA_ERRORS[3001]);
        });
    });

    describe('object handling', () => {
        it('should handle plain objects via JSON.stringify', () => {
            const error = { error: 'custom program error: 0x1', code: 500 };
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(1);
            expect(result.message).toBe(SOLANA_ERRORS[1]);
        });

        it('should handle circular references gracefully', () => {
            const error: any = { message: 'test error' };
            error.self = error; // Create circular reference
            
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(0);
            expect(result.message).toContain('Unrecognized error:');
        });
    });

    describe('error pattern matching', () => {
        describe('code 1 - insufficient balance', () => {
            it('should match "custom program error: 0x1" pattern', () => {
                const result = getSolanaErrorInfo('Transaction failed: custom program error: 0x1');
                expect(result.code).toBe(1);
                expect(result.message).toBe(SOLANA_ERRORS[1]);
            });

            it('should match "Custom": 1 pattern', () => {
                const result = getSolanaErrorInfo('{"Custom": 1, "details": "error"}');
                expect(result.code).toBe(1);
                expect(result.message).toBe(SOLANA_ERRORS[1]);
            });

            it('should not match partial patterns', () => {
                const result = getSolanaErrorInfo('custom program error: 0x10');
                expect(result.code).toBe(0);
                expect(result.message).toContain('Unrecognized error:');
            });
        });

        describe('code 1001 - account debit error', () => {
            it('should match debit account error', () => {
                const result = getSolanaErrorInfo('Attempt to debit an account but found no record of a prior credit');
                expect(result.code).toBe(1001);
                expect(result.message).toBe(SOLANA_ERRORS[1001]);
            });
        });

        describe('code 2001 - position account not found', () => {
            it('should match position account not found with exact text', () => {
                const result = getSolanaErrorInfo('Position account not found');
                expect(result.code).toBe(2001);
                expect(result.message).toBe(SOLANA_ERRORS[2001]);
            });

            it('should match position account with ID not found', () => {
                const result = getSolanaErrorInfo('Position account ABC123 not found');
                expect(result.code).toBe(2001);
                expect(result.message).toBe(SOLANA_ERRORS[2001]);
            });

            it('should match position account with description not found', () => {
                const result = getSolanaErrorInfo('Position account for user xyz was not found');
                expect(result.code).toBe(2001);
                expect(result.message).toBe(SOLANA_ERRORS[2001]);
            });

            it('should not match if order is wrong', () => {
                const result = getSolanaErrorInfo('not found Position account');
                expect(result.code).toBe(0);
                expect(result.message).toContain('Unrecognized error:');
            });
        });

        describe('code 3001 - block height exceeded', () => {
            it('should match block height exceeded', () => {
                const result = getSolanaErrorInfo('Transaction failed: block height exceeded');
                expect(result.code).toBe(3001);
                expect(result.message).toBe(SOLANA_ERRORS[3001]);
            });
        });

        describe('code 3007 - account ownership error', () => {
            it('should match Custom 3007 error', () => {
                const result = getSolanaErrorInfo('{"Custom": 3007}');
                expect(result.code).toBe(3007);
                expect(result.message).toBe(SOLANA_ERRORS[3007]);
            });
        });

        describe('code 4001 - decoding error', () => {
            it('should match string decoding error', () => {
                const result = getSolanaErrorInfo('The string to be decoded is not correctly encoded');
                expect(result.code).toBe(4001);
                expect(result.message).toBe(SOLANA_ERRORS[4001]);
            });
        });

        describe('code 6024 - overflow error', () => {
            it('should match Custom 6024 error', () => {
                const result = getSolanaErrorInfo('{"Custom": 6024}');
                expect(result.code).toBe(6024);
                expect(result.message).toBe(SOLANA_ERRORS[6024]);
            });
        });

        describe('code 6059 - order amount too small', () => {
            it('should match Custom 6059 error', () => {
                const result = getSolanaErrorInfo('{"Custom": 6059}');
                expect(result.code).toBe(6059);
                expect(result.message).toBe(SOLANA_ERRORS[6059]);
            });
        });
    });

    describe('unrecognized errors', () => {
        it('should return unrecognized error for unknown patterns', () => {
            const result = getSolanaErrorInfo('This is a completely unknown error');
            expect(result.code).toBe(0);
            expect(result.message).toBe('Unrecognized error: This is a completely unknown error');
        });

        it('should return unrecognized error for empty strings', () => {
            const result = getSolanaErrorInfo('');
            expect(result.code).toBe(0);
            expect(result.message).toBe('Unrecognized error: ');
        });
    });

    describe('error conversion edge cases', () => {
        it('should handle objects that throw on toString', () => {
            const error = {
                toString() {
                    throw new Error('toString failed');
                }
            };
            
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(0);
            expect(result.message).toContain('Unrecognized error:');
        });

        it('should handle functions', () => {
            const errorFunc = () => 'test error';
            const result = getSolanaErrorInfo(errorFunc);
            expect(result.code).toBe(0);
            expect(result.message).toContain('Unrecognized error:');
        });

        it('should handle symbols', () => {
            const errorSymbol = Symbol('test error');
            const result = getSolanaErrorInfo(errorSymbol);
            expect(result.code).toBe(0);
            expect(result.message).toContain('Unrecognized error:');
        });

        it('should handle conversion failure gracefully', () => {
            const error = Object.create(null);
            Object.defineProperty(error, 'message', {
                get() {
                    throw new Error('Property access failed');
                }
            });
            
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(0);
            expect(result.message).toBe('Unrecognized error: [Error: Unable to convert error to string]');
        });
    });

    describe('pattern precedence', () => {
        it('should match first pattern when multiple patterns could apply', () => {
            const error = 'custom program error: 0x1 and also Custom": 1';
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(1);
            expect(result.message).toBe(SOLANA_ERRORS[1]);
        });
    });

    describe('case sensitivity', () => {
        it('should be case sensitive for patterns', () => {
            const result = getSolanaErrorInfo('CUSTOM PROGRAM ERROR: 0X1');
            expect(result.code).toBe(0);
            expect(result.message).toContain('Unrecognized error:');
        });
    });

    describe('complex error structures', () => {
        it('should handle nested error objects', () => {
            const error = {
                error: {
                    message: 'Position account 12345 not found',
                    code: 'NOT_FOUND'
                },
                status: 404
            };
            
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(2001);
            expect(result.message).toBe(SOLANA_ERRORS[2001]);
        });

        it('should handle arrays in error objects', () => {
            const error = {
                errors: ['Position account ABC not found', 'Additional context'],
                timestamp: Date.now()
            };
            
            const result = getSolanaErrorInfo(error);
            expect(result.code).toBe(2001);
            expect(result.message).toBe(SOLANA_ERRORS[2001]);
        });
    });
});