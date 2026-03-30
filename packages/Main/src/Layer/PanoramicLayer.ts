import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import { Coordinates, OrientationUtils } from '@itowns/geographic';
import Fetcher from 'Provider/Fetcher';
import type PanoramicSource from 'Source/PanoramicSource';
import type { PanoramaxItem } from 'Stac/StacTypes';

export interface PanoramicLayerOptions {
    /** The panoramic data source (not an iTowns Source). */
    panoramicSource: PanoramicSource;
    /** Reference CRS of the view, e.g. `'EPSG:4978'` for a GlobeView. */
    crs: string;
    /** Radius of the panoramic sphere in metres.  Default 500. */
    backgroundDistance?: number;
}

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

    async startup(context: { view: { notifyChange(target?: unknown): void } }) {
        this.item = await this.panoramicSource.fetchItem();

        this._positionAndOrientSphere(this.item);
        await this._loadTexture(this.item);

        await super.startup(context as never);

        context.view.notifyChange(this);
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

    private async _loadTexture(item: PanoramaxItem): Promise<void> {
        const imageUrl = this.panoramicSource.getImageUrl(item);
        const texture: THREE.Texture = await Fetcher.texture(imageUrl, {
            crossOrigin: 'anonymous',
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        // BackSide renders the inside of the sphere, which mirrors the texture
        // horizontally.  Flip U to compensate.
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = -1;
        this.sphere.material.map = texture;
        this.sphere.material.needsUpdate = true;
    }

    // eslint-disable-next-line
    update() {}
    // eslint-disable-next-line
    preUpdate() {}
}

export default PanoramicLayer;
