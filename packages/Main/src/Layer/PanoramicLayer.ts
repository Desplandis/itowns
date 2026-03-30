import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import { Coordinates, OrientationUtils } from '@itowns/geographic';
import Fetcher from 'Provider/Fetcher';
import type PanoramicSource from 'Source/PanoramicSource';
import type { PanoramaxItem, TileMatrix } from 'Stac/StacTypes';

export interface PanoramicLayerOptions {
    /** The panoramic data source (not an iTowns Source). */
    panoramicSource: PanoramicSource;
    /** Reference CRS of the view, e.g. `'EPSG:4978'` for a GlobeView. */
    crs: string;
    /** Radius of the panoramic sphere in metres.  Default 500. */
    backgroundDistance?: number;
}

/** Maximum number of tile fetches in flight at once. */
const TILE_CONCURRENCY = 6;

const _qYupToZup = /* @__PURE__ */ new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
);

/**
 * Renders a single Panoramax equirectangular image on the inside of a sphere.
 *
 * The layer fetches its STAC item during {@link startup} (not in the
 * constructor), positions the sphere at the item's geographic coordinates,
 * orients it according to `view:azimuth`, and maps the `visual` asset as an
 * equirectangular texture.
 *
 * @extends GeometryLayer
 */
class PanoramicLayer extends GeometryLayer {
    readonly isPanoramicLayer: boolean;
    readonly panoramicSource: PanoramicSource;
    readonly backgroundDistance: number;

    sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    item: PanoramaxItem | null;

    private _view: { notifyChange(target?: unknown): void } | null = null;
    private _renderer: THREE.WebGLRenderer | null = null;
    private _maxTextureSize: number = 16384;

    constructor(id: string, config: PanoramicLayerOptions) {
        const {
            panoramicSource,
            backgroundDistance = 500,
            ...other
        } = config;

        // `source: false` makes Layer create a no-op dummy Source.
        super(id, new THREE.Group(), { source: false as never, ...other });

        this.isPanoramicLayer = true;
        this.panoramicSource = panoramicSource;
        this.backgroundDistance = 5;
        this.item = null;

        const geometry = new THREE.SphereGeometry(this.backgroundDistance, 64, 32);
        const material = new THREE.MeshBasicMaterial({
            side: THREE.BackSide,
            transparent: true,
        });
        this.sphere = new THREE.Mesh(geometry, material);
        this.object3d.add(this.sphere);
    }

    async startup(context: { view: { notifyChange(target?: unknown): void; mainLoop?: { gfxEngine?: { renderer?: THREE.WebGLRenderer } } } }) {
        this._view = context.view;
        this._renderer = context.view.mainLoop?.gfxEngine?.renderer ?? null;
        if (this._renderer) {
            this._maxTextureSize = this._renderer.capabilities.maxTextureSize;
        }

        this.item = await this.panoramicSource.fetchItem();

        this._positionAndOrientSphere(this.item);

        // Phase 1: load the SD preview so the sphere is visible quickly.
        await this._loadPreview(this.item);

        await super.startup(context as never);
        context.view.notifyChange(this);

        // Phase 2: load high-res tiles in the background (fire-and-forget).
        this._loadTiles(this.item);
    }

    // -- internals -----------------------------------------------------------

    private _positionAndOrientSphere(item: PanoramaxItem): void {
        const [lon, lat, alt] = item.geometry.coordinates; // alt is undefined
        const coord4326 = new Coordinates('EPSG:4326', lon, lat, alt ?? 0);
        const coordWorld = coord4326.as('EPSG:4978');

        this.sphere.position.copy(coordWorld.toVector3());
        // DEBUG
        // this.sphere.position.addScaledVector(coordWorld.geodesicNormal, this.backgroundDistance);

        // --- orientation ---
        //
        // We compose three rotations (right to left in multiply order):
        //
        //   sphere_local  -->  ENU  -->  geocentric
        //
        // 1. qYupToZup : maps Three.js Y-up pole to ENU Z-up.
        //    After this the equirectangular "front" (u=0.5 → +X in the
        //    unmodified SphereGeometry) faces ENU East.
        //
        // 2. qHeading : rotates around ENU Z (up) so the "front" faces the
        //    item's compass azimuth instead of East.
        //    East = azimuth 90°, so angle = π/2 − azimuth (radians).
        //
        // 3. qEnuToGeocent : aligns the ENU frame with geocentric axes.

        const qEnuToGeocent = OrientationUtils.quaternionFromEnuToGeocent(
            coordWorld,
        );

        console.log('qEnuToGeocent', qEnuToGeocent);

        console.log('item properties', item);

        const azimuthDeg: number =
            (item.properties['view:azimuth'] as number | undefined) ?? 0;
        const headingAngle =
            Math.PI / 2 - THREE.MathUtils.degToRad(azimuthDeg);
        const qHeading = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            headingAngle,
        );

        // Combined: enu2geocent * heading * yup2zup
        this.sphere.quaternion
            .copy(qEnuToGeocent)
            .multiply(qHeading)
            .multiply(_qYupToZup);

        this.sphere.updateMatrixWorld();
    }

    private _applyTextureSettings(texture: THREE.Texture): void {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = -1;
    }

    /**
     * Phase 1: load the SD (standard-definition) image and apply it to the
     * sphere so the user gets immediate visual feedback while tiles load.
     * Using the `visual` role (2048px) rather than `thumbnail` (500px)
     * minimises the visible alignment difference with the tiled texture.
     */
    private async _loadPreview(item: PanoramaxItem): Promise<void> {
        const previewUrl = this.panoramicSource.getImageUrl(item, 'visual');
        const texture: THREE.Texture = await Fetcher.texture(previewUrl, {
            crossOrigin: 'anonymous',
        });
        this._applyTextureSettings(texture);
        this.sphere.material.map = texture;
        this.sphere.material.needsUpdate = true;
    }

    /**
     * Phase 2 (fire-and-forget): compose high-res tiles into a
     * `WebGLRenderTarget` so each tile is uploaded to the GPU exactly once
     * (~2 MB per 768x768 tile) instead of re-uploading the full canvas on
     * every tile arrival.
     *
     * The thumbnail remains on the sphere while tiles render into the RT in
     * the background.  Once every tile has been drawn the sphere's texture
     * is swapped to the RT in one shot.
     */
    private _loadTiles(item: PanoramaxItem): void {
        const renderer = this._renderer;
        if (!renderer) { return; }

        const tms = this.panoramicSource.getTileMatrixSet(item);
        if (!tms || tms.tileMatrix.length === 0) { return; }

        const tm: TileMatrix = tms.tileMatrix[0];
        const { matrixWidth, matrixHeight, tileWidth, tileHeight } = tm;

        let fullWidth = matrixWidth * tileWidth;
        let fullHeight = matrixHeight * tileHeight;

        const max = this._maxTextureSize;
        if (fullWidth > max || fullHeight > max) {
            const scale = max / Math.max(fullWidth, fullHeight);
            fullWidth = Math.floor(fullWidth * scale);
            fullHeight = Math.floor(fullHeight * scale);
        }

        // --- render-target & blit scene setup --------------------------------

        const rt = new THREE.WebGLRenderTarget(fullWidth, fullHeight, {
            depthBuffer: false,
            wrapS: THREE.RepeatWrapping,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });
        rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
        rt.texture.repeat.x = -1;

        const orthoCamera = new THREE.OrthographicCamera(
            0, fullWidth, fullHeight, 0, -1, 1,
        );
        const blitScene = new THREE.Scene();
        const quadGeo = new THREE.PlaneGeometry(1, 1);
        const quadMat = new THREE.MeshBasicMaterial({
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        const quad = new THREE.Mesh(quadGeo, quadMat);
        blitScene.add(quad);

        // The thumbnail stays on the sphere while tiles load.  Once all tiles
        // have been drawn into the RT we swap in one shot — no UV-flip gymnastics.

        const scaledTileW = fullWidth / matrixWidth;
        const scaledTileH = fullHeight / matrixHeight;

        type TileCoord = { col: number; row: number };
        const tiles: TileCoord[] = [];
        for (let row = 0; row < matrixHeight; row++) {
            for (let col = 0; col < matrixWidth; col++) {
                tiles.push({ col, row });
            }
        }

        let loaded = 0;
        const total = tiles.length;

        const drawTile = (img: HTMLImageElement, col: number, row: number) => {
            const tileTex = new THREE.Texture(img);
            tileTex.colorSpace = THREE.SRGBColorSpace;
            tileTex.needsUpdate = true;

            quadMat.map = tileTex;
            quadMat.needsUpdate = true;
            quad.scale.set(scaledTileW, scaledTileH, 1);
            quad.position.set(
                col * scaledTileW + scaledTileW / 2,
                fullHeight - row * scaledTileH - scaledTileH / 2,
                0,
            );

            const prevRT = renderer.getRenderTarget();
            const prevAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.setRenderTarget(rt);
            renderer.render(blitScene, orthoCamera);
            renderer.setRenderTarget(prevRT);
            renderer.autoClear = prevAutoClear;

            tileTex.dispose();

            loaded++;
            if (loaded === total) {
                // All tiles drawn — swap the sphere from thumbnail to RT.
                const oldTex = this.sphere.material.map;
                this.sphere.material.map = rt.texture;
                this.sphere.material.needsUpdate = true;
                if (oldTex) { oldTex.dispose(); }

                quadGeo.dispose();
                quadMat.dispose();
                // eslint-disable-next-line no-console
                console.log(`PanoramicLayer: all ${total} tiles loaded`);
            }

            this._view?.notifyChange(this);
        };

        let cursor = 0;
        const next = () => {
            while (cursor < tiles.length) {
                const { col, row } = tiles[cursor++];
                const url = this.panoramicSource.getTileUrl(item, col, row);
                if (!url) { continue; }
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    drawTile(img, col, row);
                    next();
                };
                img.onerror = () => {
                    // eslint-disable-next-line no-console
                    console.warn(`PanoramicLayer: failed to load tile ${col},${row}`);
                    loaded++;
                    next();
                };
                img.src = url;
                return;
            }
        };

        for (let i = 0; i < TILE_CONCURRENCY && i < tiles.length; i++) {
            next();
        }
    }

    // eslint-disable-next-line
    update() {}
    // eslint-disable-next-line
    preUpdate() {}
}

export default PanoramicLayer;
