import Fetcher from 'Provider/Fetcher';
import type {
    PanoramaxItem, StacAssetRole, TileMatrixSet,
} from 'Stac/StacTypes';

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

    /**
     * Returns the first `TileMatrixSet` declared in the item's
     * `tiles:tile_matrix_sets` property, or `null` when the item has no
     * tiled assets.
     */
    getTileMatrixSet(item: PanoramaxItem): TileMatrixSet | null {
        const sets = item.properties['tiles:tile_matrix_sets'];
        if (!sets) { return null; }
        const first = Object.values(sets)[0];
        return first ?? null;
    }

    /**
     * Resolves the tile asset template URL for a given column and row.
     * Returns `null` when the item has no `asset_templates.tiles` entry.
     */
    getTileUrl(item: PanoramaxItem, col: number, row: number): string | null {
        const template = item.asset_templates?.tiles?.href;
        if (!template) { return null; }
        return template
            .replace('{TileCol}', String(col))
            .replace('{TileRow}', String(row));
    }
}

export default PanoramicSource;
