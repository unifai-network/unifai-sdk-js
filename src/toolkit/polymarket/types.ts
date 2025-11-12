import { OpenOrder } from "@polymarket/clob-client";
import { L2PolyHeader } from "./l2header";

export type PolymarketOpenOrdersResult = {
    index: number;
    orders: OpenOrder[];
    nextCursor?: string;
};

export type PolymarketOpenOrdersRequestParams = {
    id?: string;
    market?: string;
    asset_id?: string;
    limit?: number;
};

export type PolymarketOpenOrdersHexPayload = {
    data: {
        params: PolymarketOpenOrdersRequestParams;
        onlyFirstPage?: boolean;
        nextCursor?: string;
    };
};

export type PolymarketOpenOrdersProxyRequest = {
    headers: L2PolyHeader;
    params?: PolymarketOpenOrdersRequestParams;
    onlyFirstPage?: boolean;
    nextCursor?: string;
};
