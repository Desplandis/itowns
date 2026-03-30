# Panoramax & STAC API Overview for Oriented Imagery

This document describes how the **Panoramax API** exposes street-level oriented imagery
through a **STAC-compatible** REST interface, and the relevant parts of the STAC
specification needed to consume it.

---

## 1. STAC in a Nutshell (Relevant Subset)

The SpatioTemporal Asset Catalog (STAC) is a JSON-based specification for describing
geospatial assets. Only the parts relevant to Panoramax are summarized here.

### 1.1 Core Data Model

STAC has three nested entities:

| Entity         | Description |
|----------------|-------------|
| **Catalog**    | Root entry point. Provides links to child Catalogs and Collections. |
| **Collection** | A group of related Items sharing common metadata (extent, license, providers...). In Panoramax, a Collection corresponds to a **picture sequence** (a continuous trajectory of captures). |
| **Item**       | A single spatiotemporal asset — a GeoJSON Feature with `geometry`, `datetime`, `properties`, `assets`, and `links`. In Panoramax, an Item is a **single picture**. |

### 1.2 Item Structure

A STAC Item is a GeoJSON Feature:

```json
{
  "type": "Feature",
  "stac_version": "1.0.0",
  "stac_extensions": ["..."],
  "id": "<uuid>",
  "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "bbox": [west, south, east, north],
  "properties": {
    "datetime": "2024-06-15T10:23:00Z",
    "...extension fields..."
  },
  "assets": {
    "visual": { "href": "https://...", "type": "image/jpeg", "roles": ["visual"] }
  },
  "links": [
    { "rel": "collection", "href": "..." },
    { "rel": "next", "href": "...", "type": "application/geo+json" }
  ]
}
```

Key points:
- `geometry` gives the capture location.
- `datetime` gives the capture timestamp.
- `assets` maps named keys to downloadable resources (image files).
- `links` encode navigation (prev/next picture, parent collection, etc.).
- `stac_extensions` lists the extension identifiers this Item conforms to.

### 1.3 STAC API Endpoints (Relevant)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api` (landing page) | GET | Root catalog. Exposes `links` to collections, search, vector tiles style, etc. |
| `/api/collections` | GET | Lists all collections (sequences). |
| `/api/collections/{id}` | GET | Single collection metadata + extent. |
| `/api/collections/{id}/items` | GET | Paginated list of Items in a collection. |
| `/api/collections/{id}/items/{id}` | GET | Single Item (picture) with full metadata. |
| `/api/search` | GET/POST | Cross-collection search with spatial, temporal, and property filters. |

The `/search` endpoint accepts at minimum:
- `bbox` — bounding box spatial filter.
- `datetime` — temporal range filter.
- `collections` — restrict to specific collection IDs.
- `limit` — page size.
- `intersects` — GeoJSON geometry filter (POST only).

Responses are GeoJSON FeatureCollections with STAC pagination via `links` (`rel: "next"`).

---

## 2. STAC Extensions Used by Panoramax

Panoramax Items rely on two STAC extensions beyond the core spec.

### 2.1 Perspective Imagery Extension (`pers:`)

This extension describes perspective imagery from photogrammetric or commodity cameras.
It provides the intrinsic and extrinsic camera parameters needed to reconstruct scene
geometry from the image.

**Prefix:** `pers`

#### Interior Orientation (`pers:interior_orientation`)

Describes the camera's physical/optical properties. Can be placed at Collection level
(shared across all pictures from the same camera) or at Item level.

| Field                    | Type       | Description |
|--------------------------|------------|-------------|
| `camera_id`              | string     | Unique camera identifier. |
| `camera_manufacturer`    | string     | Camera make (e.g. "GoPro"). |
| `camera_model`           | string     | Camera model (e.g. "MAX"). |
| `sensor_array_dimensions`| [int, int] | Sensor size as [columns, rows] in pixels. |
| `pixel_spacing`          | [num, num] | Distance between pixel centers in mm [col, row]. |
| `focal_length`           | number     | Focal length in mm. |
| `principal_point_offset` | [num, num] | Offset from sensor center to optical center in mm. |
| `field_of_view`          | number     | Horizontal field of view in degrees. |
| `radial_distortion`      | [num]      | Radial lens distortion coefficients [k0, k1, k2, k3]. |
| `affine_distortion`      | [num]      | Affine distortion coefficients [a1, b1, c1, a2, b2, c2]. |
| `calibration_date`       | string     | Date of last calibration (RFC 3339). |

Panoramax requires at least `field_of_view` and `focal_length`.

#### Exterior Orientation (Item-level properties)

| Field                | Type           | Description |
|----------------------|----------------|-------------|
| `pers:perspective_center` | [num] | XY or XYZ position of the sensor at capture time. |
| `pers:crs`           | string/number/object | CRS of `perspective_center` (defaults to EPSG:4326). |
| `pers:vertical_crs`  | string/number/object | Vertical CRS for the Z component if not in `pers:crs`. |
| `pers:rotation_matrix`| [num x 9]    | 3x3 rotation matrix (row-major) from spatial CRS to image coordinate system. |

The extension also recommends using the **View Extension** (`view:azimuth`,
`view:off_nadir`) to describe the camera pointing direction, which is valuable even when
the full rotation matrix is not available.

### 2.2 Tiled Assets Extension (`tiles:`)

High-resolution panoramic images can be very large. This extension allows serving them
as a tiled pyramid (multi-resolution tiles) instead of a single large file.

**Prefix:** `tiles`

#### Key Concept

Instead of listing every tile as an individual asset, the extension uses **asset
templates** — URL templates with substitution parameters:

```
{base_url}/{TileMatrix}/{TileRow}/{TileCol}.jpg
```

The client resolves tiles by substituting `{TileMatrix}` (zoom level), `{TileRow}`, and
`{TileCol}` into the template.

#### Tile Matrix Set (`tiles:tile_matrix_sets`)

Defined at Collection or Item level. Describes the tiling grid(s) available. Each tile
matrix set contains one or more **tile matrices** (zoom levels), each specifying:

| Field          | Type   | Description |
|----------------|--------|-------------|
| `matrixWidth`  | int    | Number of tile columns at this level. |
| `matrixHeight` | int    | Number of tile rows at this level. |
| `tileWidth`    | int    | Pixel width of a single tile. |
| `tileHeight`   | int    | Pixel height of a single tile. |

#### Asset Templates (`asset_templates`)

Defined at Item level. Template URL with placeholders:

```json
{
  "asset_templates": {
    "tiles": {
      "href": "https://panoramax.ign.fr/api/pictures/{id}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
      "type": "image/jpeg",
      "roles": ["data"]
    }
  }
}
```

#### Tile Matrix Set Links (`tiles:tile_matrix_set_links`)

Maps tile matrix set identifiers to their definitions (inline or by URL reference),
with optional limits restricting the available tile range.

---

## 3. Panoramax API Specifics

### 3.1 Architecture

Panoramax is a **federated** open-source platform for street-level imagery. Multiple
independent instances (e.g. `panoramax.ign.fr`, `panoramax.openstreetmap.fr`) each run
their own API server. A **federated catalog** at `api.panoramax.xyz` crawls all instances
and aggregates their metadata (pictures always remain on their origin instance).

### 3.2 Data Model Mapping

| Panoramax Concept | STAC Concept | Description |
|-------------------|--------------|-------------|
| **Sequence**      | Collection   | An ordered series of pictures captured along a continuous path. |
| **Picture**       | Item         | A single geolocated image with camera metadata. |

### 3.3 Landing Page

`GET /api` returns the root catalog with navigational links:

| Link `rel`  | Description |
|-------------|-------------|
| `data`      | Link to `/api/collections`. |
| `search`    | Link to `/api/search`. |
| `xyz-style` | MapLibre Style JSON URL for vector tile rendering. |
| `xyz`       | Direct vector tile URL template (Web Map Links extension). |

### 3.4 Item (Picture) Assets

Each picture Item exposes multiple asset variants:

| Asset Role    | Description |
|---------------|-------------|
| `data`        | Full-resolution original image. |
| `visual`      | Display-ready image (potentially reprocessed). |
| `thumbnail`   | Small preview image. |

Types are `image/jpeg` or `image/webp`.

For tiled high-resolution display, `asset_templates` provides a `tiles` entry with
template URLs (see Section 2.2).

### 3.5 Item Links (Navigation)

Items include navigational links for traversing a sequence:

| Link `rel`  | Properties | Description |
|-------------|------------|-------------|
| `prev`      | `id`, `geometry`, `datetime` | Previous picture in the sequence. |
| `next`      | `id`, `geometry`, `datetime` | Next picture in the sequence. |
| `related`   | `id`, `geometry`, `datetime` | Related picture (e.g. from a nearby sequence). |
| `via`       | — | Link back to the original instance if accessed through the federated catalog. |
| `collection`| — | Parent collection (sequence). |

The `geometry` and `datetime` fields on `prev`/`next` links allow the client to know the
position and time of neighboring pictures without fetching them, which is useful for
pre-rendering navigation cues on a map.

### 3.6 Vector Tiles

Panoramax exposes pre-rendered vector tiles (MVT format) for fast map visualization. These
are advertised on the landing page via either a MapLibre Style JSON or a direct tile URL.

#### Layers

| Layer       | Zoom Levels | Mandatory | Key Properties |
|-------------|-------------|-----------|----------------|
| `sequences` | All         | Yes       | `id` (sequence ID) |
| `pictures`  | >= 15       | Yes       | `id` (picture ID), `ts` (datetime), `heading` (degrees) |
| `grid`      | < 6         | No        | `id`, `nb_pictures`, `coef` (0–1 relative density), optionally split by `nb_360_pictures`/`nb_flat_pictures` |

The `heading` property in the `pictures` layer gives the compass direction the camera was
pointing, which is essential for rendering oriented imagery markers on a map.

### 3.7 Authentication

Most read operations are **public** and require no authentication. Write operations (upload)
use OAuth 2.0 or JWT Bearer tokens. For a read-only oriented imagery viewer, authentication
is typically not needed.

---

## 4. Typical Data Flow for an Oriented Imagery Renderer

1. **Discovery** — Fetch the landing page (`GET /api`) to discover collection, search,
   and vector tile endpoints.

2. **Map Display** — Use the vector tile URL (from the `xyz-style` or `xyz` link) to
   render `sequences` and `pictures` layers on the map. The `heading` property lets you
   draw directional markers for each picture.

3. **Spatial Query** — When the user selects an area or clicks a picture marker, use
   `GET /api/search?bbox=...` or `GET /api/collections/{id}/items/{id}` to fetch full
   STAC Items.

4. **Image Display** — From the Item's `assets`, use:
   - `thumbnail` for quick preview.
   - `visual` / `data` for full image.
   - `asset_templates.tiles` for tiled progressive loading of high-resolution panoramas.

5. **Camera Reconstruction** — From the Item's `properties`:
   - `pers:interior_orientation.field_of_view` and `focal_length` to set up the
     perspective projection.
   - `pers:interior_orientation.sensor_array_dimensions` for the image pixel grid.
   - `pers:perspective_center` and `pers:rotation_matrix` for positioning and orienting
     the camera in 3D space.
   - `geometry.coordinates` for the geographic position.
   - `view:azimuth` for compass heading (if available).

6. **Sequence Navigation** — Use `prev`/`next` links on the Item to navigate along
   the capture trajectory without re-querying the search endpoint.

---

## 5. Key URLs

| Resource | URL |
|----------|-----|
| Panoramax documentation | https://docs.panoramax.fr/ |
| IGN Panoramax instance | https://panoramax.ign.fr/ |
| Federated catalog API | https://api.panoramax.xyz/ |
| Federated catalog Swagger | https://api.panoramax.xyz/api/docs/swagger |
| STAC specification | https://stacspec.org/ |
| Perspective Imagery ext. | https://github.com/stac-extensions/perspective-imagery |
| Tiled Assets ext. | https://github.com/stac-extensions/tiled-assets |
| STAC API spec | https://github.com/radiantearth/stac-api-spec |
| Panoramax STAC compat. doc | https://docs.panoramax.fr/web-viewer/05_Compatibility/ |
