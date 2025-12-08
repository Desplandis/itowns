import PointCloudLayer, { PointCloudLayerParameters } from 'Layer/PointCloudLayer';
import PotreeNode from 'Core/PotreeNode';
import type PotreeSource from 'Source/PotreeSource';

interface PotreeLayerParameters extends PointCloudLayerParameters {
    crs?: string;
    source: PotreeSource;
}

class PotreeLayer extends PointCloudLayer<PotreeSource> {
    /**
     * Used to checkout whether this layer is a PotreeLayer.
     * Default is `true`. You should not change this, as it is used internally
     * for optimisation.
     */
    readonly isPotreeLayer: true;

    /**
     * Constructs a new instance of Potree layer.
     *
     * @example
     * ```ts
     * // Create a new point cloud layer
     * const points = new PotreeLayer('points', {
     *     source: new PotreeSource({
     *         url: 'https://pointsClouds/',
     *         file: 'points.js',
     *     }),
     * });
     *
     * View.prototype.addLayer.call(view, points);
     * ```
     *
     * @param id - The id of the layer, that should be unique. It is
     * not mandatory, but an error will be emitted if this layer is added a
     * View that already has a layer going by that id.
     * @param config - Configuration, all elements in it
     * will be merged as is in the layer.
     */
    constructor(id: string, config: PotreeLayerParameters) {
        super(id, config);

        this.isPotreeLayer = true;

        const resolve = this.addInitializationStep();
        this.whenReady = this.source.whenReady.then((cloud) => {
            const normal = Array.isArray(cloud.pointAttributes) &&
                cloud.pointAttributes.find((elem: string) => elem.startsWith('NORMAL'));
            if (normal) {
                // @ts-expect-error PointsMaterial is not typed
                this.material.defines[normal] = 1;
            }

            this.supportsProgressiveDisplay = (this.source.extension === 'cin');

            this.setElevationRange();

            this.root = new PotreeNode(0, 0, this.source, this.crs);
            const { boundingBox } = cloud;
            this.root.setOBBes([boundingBox.lx, boundingBox.ly, boundingBox.lz],
                [boundingBox.ux, boundingBox.uy, boundingBox.uz]);

            return this.root.loadOctree().then(resolve);
        });
    }
}

export default PotreeLayer;
