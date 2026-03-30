import type {
    Point as GeoJsonPoint,
    Point,
    MultiPoint,
    LineString,
    MultiLineString,
    Polygon,
    MultiPolygon,
    BBox,
    FeatureCollection,
    Feature,
} from 'geojson';

/**
 * STAC-compliant geometry: all GeoJSON geometry types except
 * GeometryCollection, which is explicitly forbidden by the STAC spec.
 */
export type StacGeometry =
    | Point
    | MultiPoint
    | LineString
    | MultiLineString
    | Polygon
    | MultiPolygon;

// ============================================================================
// STAC Core Types
// ============================================================================

/**
 * Mechanism for STAC extensions to inject additional properties into core types.
 *
 * Each extension declares a unique string key and a corresponding property bag.
 * Core interfaces use `ExtensionProperties<T>` to merge in all registered
 * extension fields, making the type system open for extension without
 * modifying these core definitions.
 *
 * To register an extension, augment the relevant registry interface via
 * declaration merging:
 *
 * ```ts
 * declare module './StacTypes' {
 *     interface StacItemExtensions {
 *         'pers': PerspectiveImageryItemProperties;
 *     }
 * }
 * ```
 */

export type { GeoJsonPoint, BBox, FeatureCollection, Feature };

// -- Extension registries (empty by default, augmented by extensions) --------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface StacItemExtensions {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface StacCollectionExtensions {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface StacAssetExtensions {}

/**
 * Intersects all value types from an extension registry into a single bag.
 * Yields `{}` for empty registries (no extensions registered).
 *
 * Example: `{ pers: A, view: B }` → `A & B`
 */
type UnionToIntersection<U> =
    (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

type ExtensionProperties<R> =
    keyof R extends never
        ? {}
        : UnionToIntersection<R[keyof R]>;

// -- Links -------------------------------------------------------------------

export type StacLinkRel =
    | 'self'
    | 'root'
    | 'parent'
    | 'child'
    | 'item'
    | 'items'
    | 'collection'
    | 'data'
    | 'search'
    | 'next'
    | 'prev'
    | 'related'
    | 'via'
    | 'alternate'
    | 'service-desc'
    | 'service-doc'
    | 'conformance'
    | 'xyz'
    | 'xyz-style'
    | (string & {});

export interface StacLink {
    rel: StacLinkRel;
    href: string;
    type?: string;
    title?: string;
    method?: 'GET' | 'POST';
    /** Extra fields carried by Panoramax navigation links. */
    id?: string;
    geometry?: StacGeometry | null;
    datetime?: string;
    [key: string]: unknown;
}

// -- Assets ------------------------------------------------------------------

export type StacAssetRole =
    | 'data'
    | 'visual'
    | 'thumbnail'
    | 'overview'
    | 'metadata'
    | (string & {});

export interface StacAsset {
    href: string;
    type?: string;
    title?: string;
    description?: string;
    roles?: StacAssetRole[];
    [key: string]: unknown;
}

// -- Provider ----------------------------------------------------------------

export interface StacProvider {
    name: string;
    description?: string;
    roles?: ('licensor' | 'producer' | 'processor' | 'host' | (string & {}))[];
    url?: string;
}

// -- Temporal / Spatial Extent -----------------------------------------------

export interface StacTemporalExtent {
    interval: ([string | null, string | null])[];
}

export interface StacSpatialExtent {
    bbox: BBox[];
}

export interface StacExtent {
    spatial: StacSpatialExtent;
    temporal: StacTemporalExtent;
}

// -- Catalog -----------------------------------------------------------------

export interface StacCatalog {
    type: 'Catalog';
    id: string;
    stac_version: string;
    stac_extensions?: string[];
    title?: string;
    description: string;
    links: StacLink[];
    conformsTo?: string[];
}

// -- Collection --------------------------------------------------------------

export interface StacCollection {
    type: 'Collection';
    id: string;
    stac_version: string;
    stac_extensions?: string[];
    title?: string;
    description: string;
    keywords?: string[];
    license: string;
    providers?: StacProvider[];
    extent: StacExtent;
    summaries?: Record<string, unknown>;
    links: StacLink[];
    assets?: Record<string, StacAsset>;
}

// -- Item (the core STAC entity) ---------------------------------------------

/**
 * Base STAC Item properties (the `properties` object inside a STAC Item).
 * Extensions add their own fields via the `StacItemExtensions` registry.
 *
 * Per STAC spec: if `datetime` is null, `start_datetime` and `end_datetime`
 * are required. Both variants are expressed as a discriminated union.
 */
export type StacItemProperties = StacItemPropertiesBase & (
    | { datetime: string }
    | { datetime: null; start_datetime: string; end_datetime: string }
);

interface StacItemPropertiesBase {
    start_datetime?: string;
    end_datetime?: string;
    created?: string;
    updated?: string;
    title?: string;
    description?: string;
    license?: string;
    [key: string]: unknown;
}

/**
 * STAC Item. Per spec:
 * - `bbox` is required when `geometry` is not null, prohibited when null.
 * - `geometry` must not be a GeometryCollection.
 *
 * Both rules are encoded as a discriminated union on the `geometry` field.
 */
export type StacItem<
    P extends StacItemProperties = StacItemProperties,
    G extends StacGeometry | null = StacGeometry,
> = StacItemBase<P> & (
    G extends null
        ? { geometry: null; bbox?: undefined }
        : { geometry: G; bbox: BBox }
);

interface StacItemBase<P extends StacItemProperties = StacItemProperties> {
    type: 'Feature';
    stac_version: string;
    stac_extensions?: string[];
    id: string;
    properties: P & ExtensionProperties<StacItemExtensions>;
    assets: Record<string, StacAsset & ExtensionProperties<StacAssetExtensions>>;
    asset_templates?: Record<string, StacAsset>;
    links: StacLink[];
    collection?: string;
}

// -- Search ------------------------------------------------------------------

export interface StacSearchParameters {
    bbox?: BBox;
    datetime?: string;
    intersects?: StacGeometry | null;
    collections?: string[];
    ids?: string[];
    limit?: number;
    filter?: string;
    'filter-lang'?: 'cql2-text' | 'cql2-json';
    [key: string]: unknown;
}

/**
 * STAC search response. Extends GeoJSON FeatureCollection with STAC
 * pagination links and optional result count metadata.
 */
export interface StacFeatureCollection<
    I extends StacItem = StacItem,
> {
    type: 'FeatureCollection';
    features: I[];
    links: StacLink[];
    numberMatched?: number;
    numberReturned?: number;
    context?: {
        returned: number;
        matched?: number;
        limit: number;
    };
}

// -- Landing Page (API root) -------------------------------------------------

export type StacLandingPage = StacCatalog;


// ============================================================================
// Perspective Imagery Extension  (prefix: pers)
// ============================================================================

export interface PerspectiveInteriorOrientation {
    camera_id?: string;
    camera_manufacturer?: string;
    camera_model?: string;
    /** Sensor size as [columns, rows] in pixels. */
    sensor_array_dimensions?: [number, number];
    /** Distance between pixel centers in mm as [column_spacing, row_spacing]. */
    pixel_spacing?: [number, number];
    /** Focal length in mm. */
    focal_length?: number;
    /** Offset from sensor center to optical center in mm as [x, y]. */
    principal_point_offset?: [number, number];
    /** Horizontal field of view in degrees. */
    field_of_view?: number;
    /** Radial lens distortion coefficients [k0, k1, k2, k3]. */
    radial_distortion?: [number, number, number, number];
    /** Affine distortion coefficients [a1, b1, c1, a2, b2, c2]. */
    affine_distortion?: [number, number, number, number, number, number];
    /** Date of last calibration (RFC 3339). */
    calibration_date?: string;
}

export type CrsIdentifier = string | number | Record<string, unknown>;

export interface PerspectiveImageryItemProperties {
    'pers:interior_orientation'?: PerspectiveInteriorOrientation;
    /** Sensor position at capture as [X, Y] or [X, Y, Z]. */
    'pers:perspective_center'?: [number, number] | [number, number, number];
    /** CRS for perspective_center. Defaults to EPSG:4326. */
    'pers:crs'?: CrsIdentifier;
    /** Vertical CRS for Z in perspective_center (when not defined by pers:crs). */
    'pers:vertical_crs'?: CrsIdentifier;
    /**
     * 3x3 rotation matrix (row-major) from spatial CRS to image coordinate
     * system: [m11, m12, m13, m21, m22, m23, m31, m32, m33].
     */
    'pers:rotation_matrix'?: [
        number, number, number,
        number, number, number,
        number, number, number,
    ];
}

/** Register with the item extension registry. */
declare module './StacTypes' {
    interface StacItemExtensions {
        pers: PerspectiveImageryItemProperties;
    }
}

/** Link rel type for referencing an external interior orientation file. */
export type PerspectiveImageryLinkRel = 'interior-orientation';


// ============================================================================
// View Extension  (prefix: view)
// Commonly paired with perspective imagery.
// ============================================================================

export interface ViewExtensionProperties {
    /** Viewing azimuth angle (degrees, 0 = North, clockwise). */
    'view:azimuth'?: number;
    /** Angle from nadir in degrees. */
    'view:off_nadir'?: number;
    /** Incidence angle in degrees. */
    'view:incidence_angle'?: number;
    /** Sun azimuth angle in degrees. */
    'view:sun_azimuth'?: number;
    /** Sun elevation angle in degrees. */
    'view:sun_elevation'?: number;
}

declare module './StacTypes' {
    interface StacItemExtensions {
        view: ViewExtensionProperties;
    }
}


// ============================================================================
// Tiled Assets Extension  (prefix: tiles)
// ============================================================================

export interface TileMatrix {
    /** Tile matrix identifier (usually the zoom level as a string). */
    identifier: string;
    scaleDenominator?: number;
    topLeftCorner?: [number, number];
    tileWidth: number;
    tileHeight: number;
    matrixWidth: number;
    matrixHeight: number;
}

export interface TileMatrixSet {
    identifier?: string;
    title?: string;
    supportedCRS?: string;
    wellKnownScaleSet?: string;
    tileMatrix: TileMatrix[];
}

export interface TileMatrixLimits {
    min_tile_row?: number;
    max_tile_row?: number;
    min_tile_col?: number;
    max_tile_col?: number;
}

export interface PixelBuffer {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
    border_top?: boolean;
    border_left?: boolean;
    border_bottom?: boolean;
    border_right?: boolean;
}

export interface TileMatrixSetLink {
    /** URL to a tile matrix set definition or a fragment (#name) for inline. */
    url?: string;
    well_known_scale_set?: string;
    limits?: Record<string, TileMatrixLimits>;
    pixel_buffer?: Record<string, PixelBuffer>;
}

export interface TiledAssetsItemProperties {
    /** Tile matrix sets embedded in the item, collection, or catalog. */
    'tiles:tile_matrix_sets'?: Record<string, TileMatrixSet>;
    'tiles:tile_matrix_set_links'?: Record<string, TileMatrixSetLink>;
}

declare module './StacTypes' {
    interface StacItemExtensions {
        tiles: TiledAssetsItemProperties;
    }
}


// ============================================================================
// Convenience: fully typed Panoramax STAC Item
// ============================================================================

/**
 * A STAC Item from a Panoramax API, with perspective imagery, view, and tiled
 * assets extensions merged into properties.
 */
export type PanoramaxItemProperties = StacItemProperties
    & PerspectiveImageryItemProperties
    & ViewExtensionProperties
    & TiledAssetsItemProperties;

export type PanoramaxItem = StacItem<PanoramaxItemProperties, GeoJsonPoint>;
