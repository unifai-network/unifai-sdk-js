export function printJSON(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printSearch(results: any[]): void {
  results.forEach((item, i) => {
    const name = item.action || item.name || 'Unknown';
    const desc = item.description || '';
    console.log(`${i + 1}. ${name} - ${desc}`);
  });
}

export function normalizeInvokeResponse(resp: any): any {
  if (resp && typeof resp === 'object' && 'payload' in resp) {
    return resp.payload;
  }
  return resp;
}

export function printValue(data: unknown): void {
  if (data === null || data === undefined) {
    console.log(String(data));
  } else if (typeof data === 'object') {
    printJSON(data);
  } else {
    console.log(String(data));
  }
}

export function extractTxId(resp: any): string | null {
  if (!resp || typeof resp !== 'object') return null;
  if (typeof resp.txId === 'string' && resp.txId) return resp.txId;
  if (resp.payload && typeof resp.payload === 'object' && typeof resp.payload.txId === 'string' && resp.payload.txId) {
    return resp.payload.txId;
  }
  return null;
}

export function printSignResult(result: { address: string; txId: string; hash?: string[]; data?: any; error?: any }, json: boolean): void {
  if (json) {
    printJSON(result);
    return;
  }
  console.log(`Address: ${result.address}`);
  console.log(`TxID:    ${result.txId}`);
  if (result.hash && result.hash.length > 0) {
    console.log(`Hash:    ${result.hash.join(', ')}`);
  }
  if (result.data) {
    console.log(`Data:    ${JSON.stringify(result.data)}`);
  }
  if (result.error) {
    console.log(`Error:   ${result.error}`);
  }
}

export function printError(msg: string): void {
  console.error(`Error: ${msg}`);
}
