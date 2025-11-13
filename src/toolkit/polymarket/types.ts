import { OpenOrder } from "@polymarket/clob-client";

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
