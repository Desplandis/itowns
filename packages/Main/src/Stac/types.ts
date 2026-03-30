import type {
    BBox,
    GeoJsonProperties,
    Geometry as GeoJsonGeometry,
    GeometryCollection,
} from 'geojson';

type Asset = {
    href: URL;
    title?: string;
    description?: string;
    type?: string;
    // Standardidized roles:
    // https://github.com/radiantearth/stac-spec/blob/master/best-practices.md#list-of-asset-roles
    roles?: string[]; // thumbnail, overview, data and metadata
};
type CommonMetadata = never;
type Link = never;

/**
 * A GeoJSON geometry without GeometryCollection as per STAC specification.
 * @see https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md#geometry
 */
type Geometry = Exclude<GeoJsonGeometry, GeometryCollection>;
type Properties = GeoJsonProperties; // TODO: extend with STAC properties?

type Version = string; // TODO: restrict to certain versions?
type Extension = string; // TODO: more generic type?

export interface Item<
G extends Geometry | null = Geometry,
P extends Properties = Properties,
> {
    type: 'Feature';
    stac_version: Version;
    stac_extensions: Extension[] | undefined;
    /**
     * A value that uniquely identifies this item within a collection.
     * @see https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md#id
     */
    id: string;
    geometry: G;
    bbox: G extends null ? undefined : BBox;
    properties: P;
    //links: never; // TODO: until we have a proper links type
    //assets: never; // TODO: until we have a proper assets type
    //collection: never | undefined; // TODO: This field is required if a link with a collection relation type is present and is not allowed otherwise
}

type Provider = {
    name: string;
    // TODO: other fields?
}; // TODO: https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md#provider-object

type SpatialExtent = never; // TODO: https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md#spatial-extent-object
type TemporalExtent = never; // TODO: https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md#temporal-extent-object

type Extent = {
    spatial: SpatialExtent;
    temporal: TemporalExtent;
}; // TODO: https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md#extent-object

export interface Collection {
    type: 'Collection';
    stac_version: Version;
    stac_extensions: Extension[] | undefined;
    id: string;
    title: string | undefined;
    description: string;
    keywords: string[] | undefined;
    license: string;
    providers: Provider[] | undefined;
    extent: Extent;
    summaries: never | undefined;
    links: never; // TODO
    assets: never | undefined; // TODO
    item_assets: never | undefined; // TODO
}

import type { Point, Feature } from 'geojson';

function doThingWithFeature<G extends Geometry | null = Geometry>(feature: Feature<G>) {

}

const pt: Point = {
    type: 'Point',
    coordinates: [1.2637939397245646, 42.91620643817353],
}

const x: Item<Point> = {
    type: 'Feature',
    stac_version: '1.0.0',
    stac_extensions: [],
    id: '123',
    geometry: pt,
    bbox: [1.2637939397245646, 42.91620643817353, 1.2637939397245646, 42.91620643817353, 0, 0],
    properties: {},
}

const y: Item<null> = {
    type: 'Feature',
    stac_version: '1.0.0',
    stac_extensions: [],
    id: '123',
    geometry: null,
    bbox: undefined,
    properties: {},
}

type CheckIfItemIsFeature<G extends Geometry | null = Geometry> =
    Item<G> extends Feature<G> ? true : never;

doThingWithFeature(x);
doThingWithFeature(y);

//