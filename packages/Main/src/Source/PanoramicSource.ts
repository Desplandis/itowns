import Fetcher from 'Provider/Fetcher';
import type { PanoramaxItem, StacAssetRole } from 'Stac/StacTypes';

export interface PanoramicSourceOptions {
    item?: PanoramaxItem;
    itemUrl?: string;
    networkOptions?: RequestInit;
}

class PanoramicSource {
    readonly itemUrl: string | undefined;
    private _networkOptions: RequestInit;
    private _item: PanoramaxItem | null;

    constructor(options: PanoramicSourceOptions) {
        if (!options.item && !options.itemUrl) {
            throw new Error(
                'PanoramicSource: either `item` or `itemUrl` must be provided',
            );
        }
        this._item = options.item ?? null;
        this.itemUrl = options.itemUrl;
        this._networkOptions = options.networkOptions ?? {};
    }

    get item(): PanoramaxItem | null {
        return this._item;
    }

    async fetchItem(): Promise<PanoramaxItem> {
        if (this._item) {
            return this._item;
        }
        this._item = await Fetcher.json(
            this.itemUrl!,
            this._networkOptions,
        ) as PanoramaxItem;
        return this._item;
    }

    getImageUrl(
        item: PanoramaxItem,
        preferredRole: StacAssetRole = 'visual',
    ): string {
        const roleOrder: StacAssetRole[] =
            preferredRole === 'thumbnail'
                ? ['thumbnail', 'visual', 'data']
                : ['visual', 'data', 'thumbnail'];

        for (const role of roleOrder) {
            for (const asset of Object.values(item.assets)) {
                if (asset.roles?.includes(role)) {
                    return asset.href;
                }
            }
        }

        const first = Object.values(item.assets)[0];
        if (first?.href) {
            return first.href;
        }

        throw new Error(`No image asset found in STAC item ${item.id}`);
    }
}

export default PanoramicSource;
