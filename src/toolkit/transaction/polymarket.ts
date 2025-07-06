import { ClobClient, OrderType } from "@polymarket/clob-client";
import { EtherSigner, isWagmiSigner, WagmiSigner } from "./index";

const chainId = 137;
const clobUrl = 'https://clob.polymarket.com/'

async function getPolyApiKey(signer: EtherSigner|WagmiSigner): Promise<any> {
    const clobSigner = signer as any

    if ((signer as any).account && !clobSigner._signTypedData) { // for wagmi signer
        clobSigner._signTypedData = async (domain: any, types: any, value: any) => {
            return await (signer as any).signTypedData({
                account: (signer as any).account,
                domain: domain,
                types: types,
                primaryType: Object.keys(types).find(key => key !== 'EIP712Domain') || 'EIP712Domain',
                message: value
            });
        };
    } else {
        clobSigner._signTypedData = clobSigner.signTypedData;
    }

    if (!clobSigner.getAddress) {
        clobSigner.getAddress = async () => {
            return (signer as any).account?.address || (signer as any).address;
        }
    }

    const clobClient = new ClobClient(clobUrl, chainId, clobSigner)
    let creds: any
    try {
        creds = await clobClient.deriveApiKey()
    } catch (error) {
        throw new Error(`polymarke derive api key error: ${error}`)
    }

    return { clobSigner, creds }
}

export async function polymarketSendTransaction(signer: EtherSigner|WagmiSigner, tx: any): Promise<{ hash: string | undefined, orderId?: string }> {
    try {
        let data = JSON.parse(tx.hex)
        let od = data.data
        let orderData = od.orderData
        let typedData = od.typedData
        let orderType = od.orderType || OrderType.FAK; // FOK

        const { signature: existingSignature, ...cleanOrderData } = orderData;
        let signature: string;

        if ( isWagmiSigner(signer)) { // wagmi wallet
            const s = signer as WagmiSigner
            signature = await s.signTypedData({
                account: s.account,
                domain: typedData.domain,
                types: typedData.types,
                primaryType: typedData.primaryType,
                message: cleanOrderData
            });
        } else if (signer.signTypedData) { // ethers wallet
            delete typedData.types.EIP712Domain
            signature = await signer.signTypedData(typedData.domain, typedData.types, cleanOrderData);
        } else {
            throw new Error("Signer doesn't have signTypedData");
        }
        orderData.signature = signature;

        const { clobSigner, creds } = await getPolyApiKey(signer)

        const clobClient = new ClobClient(clobUrl, chainId, clobSigner, creds)
        const res = await clobClient.postOrder(orderData, orderType);
        if (res.error) {
            throw new Error(`polymarket postOrder error: ${res.error}`)
        } else {
            let hash = res.transactionHash || res.transactionsHashes?.[0]
            return { hash: hash, orderId: res.orderId } // orderId is polymarket specific
        }

    } catch (error) {
        throw new Error(`polymarketSendTransaction: ${error}`)
    }
}
