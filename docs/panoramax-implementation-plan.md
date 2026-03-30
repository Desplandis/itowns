# Panoramax Integration — Implementation Plan

## Context

iTowns already has an `OrientedImageLayer` that does **projective texturing** from
multi-camera rigs (e.g. Ladybug) onto scene geometry. This approach requires 3D geometry
to project onto and assumes a custom calibration/orientation format.

Panoramax serves **single panoramic images** (360° equirectangular or flat perspective)
via a STAC-compatible API. A Google Street View-like experience renders the panorama onto
the **inside of a sphere** — no scene geometry projection needed. This requires new
components rather than adapting the existing oriented imagery pipeline.

---

## Component Overview

```
┌─────────────────────────────────────────────────────────┐
│                    view_panoramax.html                   │
│                       (example)                         │
├──────────┬──────────────────────────┬───────────────────┤
│StreetCtrls│    PanoramicLayer       │ VectorTilesSource │
│ (reused) │    (new layer)          │ (reused, for map) │
│          ├──────────────────────────┤                   │
│          │    PanoramaxSource       │                   │
│          │    (new source)         │                   │
│          ├──────────────────────────┤                   │
│          │    StacSource            │                   │
│          │    (new generic source) │                   │
└──────────┴──────────────────────────┴───────────────────┘
```

Four new files, one reused control, one reused source, one example.

---

## 1. `StacSource` — Generic STAC API Source

**File:** `packages/Main/src/Source/StacSource.ts`

**Extends:** `Source`

**Purpose:** Reusable source for any STAC API. Handles discovery, search, pagination,
and item parsing. Not Panoramax-specific — usable for satellite imagery, aerial photos,
or any STAC-compliant catalog.

### Constructor

- Accepts `url` (landing page URL, e.g. `https://api.panoramax.xyz/api`).
- Accepts optional `collections` filter (array of collection IDs).
- Accepts optional `networkOptions` for auth headers.
- `whenReady` fetches the landing page, extracts:
  - `searchUrl` — from link with `rel: "search"`.
  - `collectionsUrl` — from link with `rel: "data"`.
  - Available STAC extensions.

### Key Methods

```
urlFromExtent(extent)
```
Builds a search URL: `/search?bbox=W,S,E,N&limit=N&collections=...`.
The `extent` parameter is an iTowns `Extent` object.

```
extentInsideLimit(extent)
```
Checks against the STAC collection's spatial extent (fetched during init).

```
getDataKey(extent)
```
Returns a cache key based on the bbox string.

### Parser

STAC Items are GeoJSON Features. The default parser should:
- Accept `FeatureCollection` responses from `/search`.
- Preserve STAC-specific fields (`stac_extensions`, `assets`, `asset_templates`, `links`).
- Handle pagination: detect `rel: "next"` links in the response.

The existing `GeoJsonParser` strips STAC fields. Two options:

**Option A:** Write a thin `StacItemParser` that preserves the full Item JSON while
extracting geometry into iTowns `Feature` objects. This keeps STAC metadata accessible.

**Option B:** Use `GeoJsonParser` for geometry, and keep raw STAC item JSON in a
parallel structure (e.g. `source.items` map keyed by ID).

Recommendation: **Option A**, because downstream consumers (PanoramicLayer) need direct
access to `assets`, `asset_templates`, `links`, and `properties.pers:*` fields. Parsing
into Feature objects that lose this data forces a second fetch or parallel bookkeeping.

### Pagination

STAC search responses include:
```json
{
  "type": "FeatureCollection",
  "features": [...],
  "links": [{ "rel": "next", "href": "...", "method": "GET" }]
}
```

`StacSource` should expose an async iterator or a `fetchNext()` method to load
additional pages on demand. For the initial integration, loading a single page with a
reasonable `limit` (e.g. 50) within the current viewport is sufficient.

---

## 2. `PanoramaxSource` — Panoramax-Specific Source

**File:** `packages/Main/src/Source/PanoramaxSource.ts`

**Extends:** `StacSource`

**Purpose:** Adds Panoramax-specific logic: vector tile discovery, asset resolution,
navigation links, and camera parameter extraction.

### Constructor (extends StacSource)

On top of `StacSource`'s landing page fetch, also extracts:
- `vectorTileStyleUrl` — from link with `rel: "xyz-style"` (MapLibre style JSON).
- `vectorTileUrl` — from link with `rel: "xyz"` (direct MVT URL template).

### Asset Resolution

```
getImageUrl(item, role = 'visual')
```
Returns the URL of the best image asset from a STAC Item.
- Prefers `visual` role, falls back to `data`, then `thumbnail`.
- Returns both `href` and `type` (JPEG or WebP).

```
getThumbnailUrl(item)
```
Shortcut for `getImageUrl(item, 'thumbnail')`.

```
getTileUrl(item, tileMatrix, tileRow, tileCol)
```
Resolves the tiled asset template from `item.asset_templates.tiles.href` by
substituting `{TileMatrix}`, `{TileRow}`, `{TileCol}`.

### Navigation

```
getNeighbors(item)
```
Extracts prev/next/related links from `item.links`:
```ts
{
  prev: { id, geometry, datetime } | null,
  next: { id, geometry, datetime } | null,
  related: Array<{ id, geometry, datetime }>
}
```

These embedded fields allow the layer to know the position and time of neighboring
pictures **without fetching them**, which is critical for rendering navigation cues
and for `StreetControls` to know where to animate.

```
fetchItem(id)
```
Fetches a single full STAC Item by ID. Used when the user navigates to a neighbor
whose full metadata (assets, camera params) hasn't been loaded yet.

### Camera Parameters

```
getCameraParams(item)
```
Extracts from `item.properties`:
```ts
{
  fieldOfView: number,          // pers:interior_orientation.field_of_view (degrees)
  focalLength: number,          // pers:interior_orientation.focal_length (mm)
  sensorDimensions: [w, h],    // pers:interior_orientation.sensor_array_dimensions
  heading: number,              // view:azimuth or from vector tiles heading
  position: [lon, lat, alt?],  // from item.geometry.coordinates
  rotationMatrix: number[9]?,  // pers:rotation_matrix (optional)
}
```

### Tile Matrix Info

```
getTileMatrixSet(item)
```
Extracts `tiles:tile_matrix_sets` to determine available zoom levels and tile
dimensions. Returns an array of:
```ts
{ level: number, matrixWidth: number, matrixHeight: number,
  tileWidth: number, tileHeight: number }
```

---

## 3. `PanoramicLayer` — Sphere-Based Panoramic Renderer

**File:** `packages/Main/src/Layer/PanoramicLayer.ts`

**Extends:** `GeometryLayer`

**Purpose:** Renders panoramic images onto the inside of a sphere for a street-view
experience. Manages panoramic selection, texture loading, and transitions.

### Design Principle

Unlike `OrientedImageLayer` which does projective texturing on scene geometry, this
layer creates its own geometry: a sphere (for 360° images) or a textured plane (for
flat perspective images). The view camera sits at the center of the sphere.

### Constructor

```ts
new PanoramicLayer(id, {
  source: PanoramaxSource,
  crs: string,                    // view reference CRS
  backgroundDistance: number,     // sphere radius (default: 500m)
  onPanoChanged: (event) => void, // callback when current panoramic changes
})
```

Creates:
- `this.sphere` — `THREE.Mesh` with inverted `SphereGeometry` + `MeshBasicMaterial`
  (side: `BackSide`). UV mapping matches equirectangular projection.
- `this.currentItem` — the STAC Item currently displayed.
- `this.panoIndex` — spatial index (simple array initially, could be upgraded to
  an R-tree) of loaded panoramic positions for nearest-neighbor lookup.
- `this.textureCache` — LRU cache of loaded textures to avoid re-fetching when
  navigating back and forth.

### Initialization (`startup` / `addInitializationStep`)

1. `source.whenReady` resolves.
2. Initial spatial query: `source.loadData(initialExtent)` to populate `panoIndex`
   with nearby panoramics.
3. Select nearest panoramic to camera position → `this.currentItem`.
4. Load its texture → apply to sphere.

### Update Loop

**`preUpdate(context)`:**

1. **Check if camera moved far enough** from current panoramic to trigger a switch:
   - Compute distance from camera to `currentItem.position`.
   - Find nearest panoramic in `panoIndex`.
   - If a closer panoramic is found, trigger a switch.

2. **On panoramic switch:**
   - Update `currentItem`.
   - Fire `onPanoChanged` callback with prev/current/next positions.
   - Start texture loading (see loading strategy below).
   - Start crossfade transition.

3. **Position the sphere** at the current panoramic's world position.

4. **Orient the sphere** using the panoramic's heading/rotation data so that the
   texture aligns with the real-world compass direction.

5. **Extend the spatial index** if the camera is approaching the edge of loaded data:
   trigger a new STAC search for the area around the camera.

**`update()`:** No-op (like `OrientedImageLayer`).

**`postUpdate()`:** Clean up finished transitions, evict distant entries from
`textureCache`.

### Texture Loading Strategy

**Phase 1 (MVP — full image loading):**
- Load the `visual` asset as a single texture.
- Apply to sphere material.
- Simple and works for images up to ~4K.

**Phase 2 (progressive tiled loading):**
1. Immediately apply the `thumbnail` asset (tiny, loads fast) → instant visual feedback.
2. Parse `asset_templates.tiles` and `tiles:tile_matrix_sets`.
3. Determine which tiles cover the current view frustum.
4. Load those tiles first (view-frustum prioritization).
5. Compose tiles into a `CanvasTexture` or `DataTexture` that replaces the thumbnail
   progressively.
6. On camera rotation (look direction changes), re-prioritize tile loading.

The tiled loading is the most complex part and can be deferred to a second iteration.
The MVP with full image loading is already a functional street view.

### Transition Between Panoramics

When switching panoramics:
1. Keep the old sphere visible with its texture.
2. Create (or reuse) a second sphere with the new texture.
3. Crossfade over ~300ms using material opacity.
4. After transition, dispose the old texture (unless cached).

This avoids the jarring "black flash" that occurs with instant texture swaps.

### Flat/Perspective Image Support

Not all Panoramax images are 360°. For flat perspective images:
- Detect from `field_of_view` (< 180° → flat image).
- Instead of a full sphere, use a **partial sphere sector** matching the camera's
  field of view, or a simple textured plane positioned in front of the camera.
- Set the view camera's FOV to match `field_of_view`.

### Public API

```ts
layer.currentItem        // current STAC item
layer.goToNext()         // navigate to next in sequence
layer.goToPrevious()     // navigate to previous in sequence
layer.goToItem(id)       // navigate to a specific item by ID
layer.goToNearest(pos)   // navigate to the nearest panoramic to a position
layer.onPanoChanged      // event callback
```

---

## 4. `StacItemParser` — STAC Item Parser

**File:** `packages/Main/src/Parser/StacItemParser.ts`

**Purpose:** Parse STAC search responses into a format usable by the layer while
preserving all STAC-specific metadata.

### Input

A STAC search response (GeoJSON FeatureCollection with STAC Items as features).

### Output

An array of objects, each containing:
```ts
{
  id: string,
  position: THREE.Vector3,       // world position (from geometry.coordinates + CRS)
  heading: number,               // compass heading in degrees
  datetime: Date,
  assets: object,                // raw STAC assets
  assetTemplates: object,        // raw asset_templates
  links: object,                 // parsed prev/next/related
  cameraParams: object,          // extracted from pers:* properties
  tileMatrixSet: object,         // extracted from tiles:* properties
  raw: object,                   // the full original STAC Item JSON
}
```

The parser uses `Coordinates` from `@itowns/geographic` to convert from the item's CRS
(typically EPSG:4326) to the view's reference CRS (EPSG:4978 for globe).

---

## 5. Example: `view_panoramax.html`

**File:** `examples/view_panoramax.html`

### Setup

```
GlobeView + StreetControls
  ├── ColorLayer (ortho imagery, e.g. WMTS)
  ├── ElevationLayer (DTM)
  ├── PanoramicLayer + PanoramaxSource (pointing at api.panoramax.xyz)
  └── (optional) VectorTilesSource layer for picture markers on map
```

### Wiring

```js
const source = new itowns.PanoramaxSource({
    url: 'https://api.panoramax.xyz/api',
});

const layer = new itowns.PanoramicLayer('panoramax', {
    source,
    backgroundDistance: 500,
    crs: view.referenceCrs,
    onPanoChanged: (e) => {
        view.controls.setPreviousPosition(e.previousPanoPosition);
        view.controls.setCurrentPosition(e.currentPanoPosition);
        view.controls.setNextPosition(e.nextPanoPosition);
    },
});

view.addLayer(layer, view.tileLayer);
```

This mirrors the pattern of `view_immersive.html` but with Panoramax data instead of
the custom Ladybug format.

### StreetControls Integration

`StreetControls` already supports:
- Mouse drag for look-around
- Click-to-move (snap to nearest panoramic via `transformationPositionPickOnTheGround`)
- Z/S keys for next/previous
- Animated transitions

The only adaptation needed is the `transformationPositionPickOnTheGround` callback,
which snaps the clicked ground position to the nearest Panoramax picture:
```js
view.controls.transformationPositionPickOnTheGround = (position) => {
    const nearest = layer.goToNearest(position);
    return nearest.position;
};
```

---

## 6. Exports

Add to `packages/Main/src/Main.js`:
```js
export { StacSource } from 'Source/StacSource';
export { PanoramaxSource } from 'Source/PanoramaxSource';
export { PanoramicLayer } from 'Layer/PanoramicLayer';
export { default as StacItemParser } from 'Parser/StacItemParser';
```

---

## Implementation Order

### Phase 1 — MVP (functional street view)

| Step | Component | Effort | Notes |
|------|-----------|--------|-------|
| 1 | `StacSource` | Medium | Landing page fetch, search URL building, pagination. |
| 2 | `StacItemParser` | Small | Parse features, preserve STAC metadata, convert coords. |
| 3 | `PanoramaxSource` | Medium | Extends StacSource; asset resolution, nav links, camera params. |
| 4 | `PanoramicLayer` | Large | Sphere rendering, nearest-pano selection, full-image loading, crossfade. |
| 5 | Example | Small | Wire everything together, test with api.panoramax.xyz. |

### Phase 2 — Progressive tiled loading

| Step | Component | Effort | Notes |
|------|-----------|--------|-------|
| 6 | Tiled texture composer | Large | View-frustum tile prioritization, canvas composition. |
| 7 | Thumbnail preloading | Small | Preload thumbnails for neighboring panoramics. |

### Phase 3 — Map integration

| Step | Component | Effort | Notes |
|------|-----------|--------|-------|
| 8 | Vector tile overlay | Small | Use existing VectorTilesSource with Panoramax style JSON. |
| 9 | Minimap widget | Medium | Split view: panoramic + small map with current position. |

### Phase 4 — Polish

| Step | Component | Effort | Notes |
|------|-----------|--------|-------|
| 10 | Flat image support | Medium | Detect non-360° images, use partial sphere/plane. |
| 11 | Depth-based transitions | Medium | Use terrain elevation for smoother movement. |
| 12 | Keyboard shortcuts | Small | Additional navigation bindings. |

---

## Key Design Decisions

### Why a new layer instead of adapting `OrientedImageLayer`?

| Aspect | OrientedImageLayer | PanoramicLayer |
|--------|-------------------|----------------|
| Rendering | Projective texturing onto scene geometry | Texture mapped to inside of sphere |
| Camera model | Multi-camera rig (N cameras per position) | Single camera per position |
| Input format | Custom GeoJSON + custom calibration JSON | STAC API + perspective imagery extension |
| Geometry dependency | Requires buildings/terrain to project onto | Self-contained (owns its sphere) |
| Use case | Photogrammetric inspection | Street-view browsing |

Adapting `OrientedImageLayer` would compromise its existing use case and result in
hard-to-maintain conditional paths. A clean new layer is more maintainable.

### Why sphere rendering instead of projective texturing?

Projective texturing makes sense when you want the photo to "live on" existing 3D
geometry (e.g. inspecting building facades). For a street-view experience, the user
expects to be "inside" the photo — a sphere achieves this naturally and doesn't require
any 3D scene geometry. This is the approach used by Google Street View, Mapillary, and
the Panoramax web viewer itself.

### Why `StacSource` as a separate generic class?

STAC is used far beyond Panoramax (satellite imagery, aerial surveys, etc.). A generic
`StacSource` makes the iTowns STAC integration reusable. The Panoramax-specific logic
(asset resolution, vector tiles, navigation links) stays in the subclass.
