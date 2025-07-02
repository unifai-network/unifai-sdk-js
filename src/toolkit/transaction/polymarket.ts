import { ethers } from "ethers";
import { ClobClient, OrderType } from "@polymarket/clob-client";

const chainId = 137;
const clobUrl = 'https://clob.polymarket.com/'

async function getPolyApiKey(signer: ethers.Wallet): Promise<any> {
    const clobSigner = signer as any
    clobSigner._signTypedData = clobSigner.signTypedData

    const clobClient = new ClobClient(clobUrl, chainId, clobSigner)
    const creds = await clobClient.deriveApiKey()

    return { clobSigner, creds }
}

export async function polymarketSendTransaction(signer: any, tx: any): Promise<{ hash: string | undefined, orderId?: string }> {
    try {
        let data = JSON.parse(tx.hex)
        let od = data.data
        let orderData = od.orderData
        let typedData = od.typedData
        let orderType = od.orderType || OrderType.FAK; // FOK

        delete typedData.types.EIP712Domain
        const signature = await signer.signTypedData(typedData.domain, typedData.types, orderData)
        orderData.signature = signature

        const { clobSigner, creds } = await getPolyApiKey(signer)
        const clobClient = new ClobClient(clobUrl, chainId, clobSigner, creds)
        const res = await clobClient.postOrder(orderData, orderType);

        if (res.error) {
            throw res.error
        } else {
            let hash = res.transactionHash || res.transactionHashes?.[0]
            return { hash: hash, orderId: res.orderId } // orderId is polymarket specific
        }
    } catch (error) {
        throw new Error(`polymarketSendTransaction: ${error}`)
    }
}
