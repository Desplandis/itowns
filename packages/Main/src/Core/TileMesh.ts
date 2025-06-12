import * as THREE from 'three';
import { geoidLayerIsVisible } from 'Layer/GeoidLayer';
import { tiledCovering } from 'Core/Tile/Tile';

import type { Extent } from '@itowns/geographic';
import type { TileGeometry } from './TileGeometry';
import type { LayeredMaterial } from 'Renderer/LayeredMaterial';
import type OBB from 'Renderer/OBB';
import type LayerUpdateState from 'Layer/LayerUpdateState';

interface TiledLayerLike {
    tileMatrixSets: string[];
}

/**
 * A TileMesh is a THREE.Mesh with a geometricError and an OBB
 * The objectId property of the material is the with the id of the TileMesh
 * @param {TileGeometry} geometry - the tile geometry
 * @param {THREE.Material} material - a THREE.Material compatible with THREE.Mesh
 * @param {Layer} layer - the layer the tile is added to
 * @param {Extent} extent - the tile extent
 * @param {?number} level - the tile level (default = 0)
 */
class TileMesh extends THREE.Mesh<TileGeometry, LayeredMaterial> {
    readonly isTileMesh = true;

    layer: TiledLayerLike;
    extent: Extent;
    level: number;
    obb: OBB;
    boundingSphere: THREE.Sphere;
    geoidHeight: number;
    rotationAutoUpdate: boolean;
    layerUpdateState: Record<string, LayerUpdateState>;

    horizonCullingPointElevationScaled: THREE.Vector3 | undefined;
    horizonCullingPoint: THREE.Vector3 | undefined;

    link: {
        parent?: TileMesh | undefined;
        children?: TileMesh[];
    };

    private _tms = new Map();
    constructor(geometry: TileGeometry, material: LayeredMaterial, layer: TiledLayerLike, extent: Extent, level: number = 0) {
        super(geometry, material);

        if (!extent) {
            throw new Error('extent is mandatory to build a TileMesh');
        }
        this.layer = layer;
        this.extent = extent;

        this.level = level;

        this.material.setUniform('objectId', this.id);

        this.obb = (this.geometry.OBB as OBB).clone();
        this.boundingSphere = new THREE.Sphere();
        this.obb.box3D.getBoundingSphere(this.boundingSphere);

        for (const tms of layer.tileMatrixSets) {
            this._tms.set(tms, tiledCovering(this.extent, tms));
        }

        this.frustumCulled = false;
        this.matrixAutoUpdate = false;
        this.rotationAutoUpdate = false;

        this.layerUpdateState = {};
        this.isTileMesh = true;

        this.geoidHeight = 0;

        this.link = {};

        let _visible = true;
        Object.defineProperty(this, 'visible', {
            get() { return _visible; },
            set(v: boolean) {
                if (_visible != v) {
                    _visible = v;
                    this.dispatchEvent({ type: v ? 'shown' : 'hidden' });
                }
            },
        });
    }
    /**
     * If specified, update the min and max elevation of the OBB
     * and updates accordingly the bounding sphere and the geometric error
     *
     * @param {Object}  elevation
     * @param {number}  [elevation.min]
     * @param {number}  [elevation.max]
     * @param {number}  [elevation.scale]
     */
    setBBoxZ(elevation: { min?: number, max?: number, scale?: number, geoidHeight?: number } = {}) {
        elevation.geoidHeight = geoidLayerIsVisible(this.layer) ? this.geoidHeight : 0;
        this.obb.updateZ(elevation);
        if (this.horizonCullingPointElevationScaled && this.horizonCullingPoint) {
            this.horizonCullingPointElevationScaled.setLength(this.obb.z.delta + this.horizonCullingPoint.length());
        }
        this.obb.box3D.getBoundingSphere(this.boundingSphere);
    }

    getExtentsByProjection(tms: string) {
        return this._tms.get(tms);
    }

    /**
     * Search for a common ancestor between this tile and another one. It goes
     * through parents on each side until one is found.
     *
     * @param {TileMesh} tile
     *
     * @return {TileMesh} the resulting common ancestor
     */
    findCommonAncestor(tile: TileMesh): TileMesh | undefined {
        if (!tile) {
            return undefined;
        }
        if (tile.level == this.level) {
            if (tile.id == this.id) {
                return tile;
            } else if (tile.level != 0) {
                // @ts-expect-error A tilemesh parent is always a tilemesh
                return this.parent.findCommonAncestor(tile.parent);
            } else {
                return undefined;
            }
        } else if (tile.level < this.level) {
            // @ts-expect-error A tilemesh parent is always a tilemesh
            return this.parent.findCommonAncestor(tile);
        } else {
            // @ts-expect-error A tilemesh parent is always a tilemesh
            return this.findCommonAncestor(tile.parent);
        }
    }

    onBeforeRender() {
        this.material.updateLayersUniforms();
    }
}

export default TileMesh;
