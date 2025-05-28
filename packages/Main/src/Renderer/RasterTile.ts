import * as THREE from 'three';
import { ELEVATION_MODES } from 'Renderer/LayeredMaterial';
import {
    checkNodeElevationTextureValidity,
    insertSignificantValuesFromParent,
    computeMinMaxElevation,
} from 'Utils/ElevationTextureUtils';

import type Tile from 'Core/Tile/Tile';
import type { ElevationModes } from 'Renderer/LayeredMaterial';

// This is a workaround to make the `extent` property of `Texture` available,
// since we dynamically add it to `Texture` instances in all parsers.
declare module 'three' {
    interface Texture {
        extent?: Tile;
    }
}

interface RasterLayerEventMap {
    'visible-property-changed': { visible: boolean };
    'opacity-property-changed': { opacity: number };
}

interface ElevationLayerEventMap extends RasterLayerEventMap {
    'scale-property-changed': { scale: number };
}

interface RasterLayerLike<E extends RasterLayerEventMap = RasterLayerEventMap> extends THREE.EventDispatcher<E> {
    id: string;
    opacity: number;
    visible: boolean;
    crs: string;
    parent: {
        tileMatrixSets: string[];
    };
}

interface ColorLayerLike extends RasterLayerLike {
    effect_type: number;
    effect_parameter: number;
    transparent: boolean;
}

interface ElevationLayerLike extends RasterLayerLike<ElevationLayerEventMap> {
    scale: number;
    bias?: number;
    mode?: number;
    zmin?: number;
    zmax?: number;
    noDataValue?: number;
    useRgbaTextureElevation?: boolean;
    useColorTextureElevation?: boolean;
    colorTextureElevationMinZ?: number;
    colorTextureElevationMaxZ?: number;
}

export const EMPTY_TEXTURE_ZOOM = -1;

const pitch = new THREE.Vector4();

function getIndiceWithPitch(i: number, pitch: THREE.Vector4, w: number) {
    // Return corresponding indice in parent tile using pitch
    const currentX = (i % w) / w;  // normalized
    const currentY = Math.floor(i / w) / w; // normalized
    const newX = pitch.x + currentX * pitch.z;
    const newY = pitch.y + currentY * pitch.w;
    const newIndice = Math.floor(newY * w) * w + Math.floor(newX * w);
    return newIndice;
}

export interface RasterElevationTileEventMap {
    rasterElevationLevelChanged: { node: RasterElevationTile };
}

/**
 * A `RasterTile` is part of raster {@link Layer} data.
 * This part is a spatial subdivision of the extent of a layer.
 * In the `RasterTile`, The data are converted on three.js textures.
 * This `RasterTile` textures are assigned to a `LayeredMaterial`.
 * This material is applied on terrain (TileMesh).
 * The color textures are mapped to color the terrain.
 * The elevation textures are used to displace vertex terrain.
 *
 * @class RasterTile
 */
export class RasterTile<
    L extends RasterLayerLike = RasterLayerLike,
    E extends {} = {},
> extends THREE.EventDispatcher<E> {
    offsetScales: THREE.Vector4[];
    textures: THREE.Texture[];

    protected layer: L;
    protected crs: number;
    protected level: number;
    protected needsUpdate: boolean;
    protected _handlerCBEvent: () => void;

    protected constructor(layer: L) {
        super();
        this.layer = layer;
        // TODO: This is fragile as we get the TMS from the parent geomety layer
        this.crs = layer.parent.tileMatrixSets.indexOf(layer.crs);
        if (this.crs == -1) {
            console.error('Unknown crs:', layer.crs);
        }

        this.textures = [];
        this.offsetScales = [];
        this.level = EMPTY_TEXTURE_ZOOM;
        this.needsUpdate = false;

        this._handlerCBEvent = () => { this.needsUpdate = true; };
        layer.addEventListener('visible-property-changed', this._handlerCBEvent);
        layer.addEventListener('opacity-property-changed', this._handlerCBEvent);
    }

    get id() {
        return this.layer.id;
    }

    get opacity() {
        return this.layer.opacity;
    }

    get visible() {
        return this.layer.visible;
    }

    initFromParent(parent: RasterTile | null, extents: Tile[]) { // TODO: Fix
        if (parent && parent.level > this.level) {
            let index = 0;
            const sortedParentTextures = this.sortBestParentTextures(parent.textures);
            for (const childExtent of extents) {
                const matchingParentTexture = sortedParentTextures
                    .find(parentTexture => parentTexture?.extent && childExtent.isInside(parentTexture.extent));
                if (matchingParentTexture?.extent) {
                    this.setTexture(index++, matchingParentTexture,
                        childExtent.offsetToParent(matchingParentTexture.extent));
                }
            }

            if (__DEBUG__) {
                if (index != extents.length) {
                    console.error(`non-coherent result ${index} vs ${extents.length}.`, extents);
                }
            }
        }
    }

    sortBestParentTextures(textures: THREE.Texture[]) {
        const sortByValidity = (a: THREE.Texture, b: THREE.Texture) => {
            if (a.isTexture === b.isTexture) {
                return 0;
            } else {
                return a.isTexture ? -1 : 1;
            }
        };
        const sortByZoom = (a: THREE.Texture, b: THREE.Texture) => {
            if (a.extent && b.extent) {
                return b.extent.zoom - a.extent.zoom;
            }
            return 0; // TODO: Fix
        };

        return textures.toSorted((a, b) => sortByValidity(a, b) || sortByZoom(a, b));
    }

    disposeRedrawnTextures(newTextures: THREE.Texture[]) {
        const validTextureIndexes = newTextures
            .map((texture, index) => (this.shouldWriteTextureAtIndex(index, texture) ? index : -1))
            .filter(index => index !== -1);

        if (validTextureIndexes.length === newTextures.length) {
            // Dispose the whole tile when all textures are overwritten
            this.dispose(false);
        } else {
            this.disposeAtIndexes(validTextureIndexes);
        }
    }

    dispose(removeEvent = true) {
        if (removeEvent) {
            this.layer.removeEventListener('visible-property-changed', this._handlerCBEvent);
            this.layer.removeEventListener('opacity-property-changed', this._handlerCBEvent);
            // @ts-ignore-next-line
            this._listeners = {};
        }
        // TODO: WARNING  verify if textures to dispose aren't attached with ancestor
        // Dispose all textures
        this.disposeAtIndexes(this.textures.keys());
        this.textures = [];
        this.offsetScales = [];
        this.level = EMPTY_TEXTURE_ZOOM;
    }

    disposeAtIndexes(indexes: Iterable<number>) {
        for (const index of indexes) {
            const texture = this.textures[index];
            if (texture && texture.isTexture) {
                texture.dispose();
            }
        }
        this.needsUpdate = true;
    }

    setTexture(index: number, texture: THREE.Texture, offsetScale: THREE.Vector4) {
        if (this.shouldWriteTextureAtIndex(index, texture)) {
            this.level = (texture && texture.extent) ? texture.extent.zoom : this.level;
            this.textures[index] = texture || null;
            this.offsetScales[index] = offsetScale;
            this.needsUpdate = true;
        }
    }

    setTextures(textures: THREE.Texture[], pitchs: THREE.Vector4[]) {
        this.disposeRedrawnTextures(textures);
        for (let i = 0, il = textures.length; i < il; ++i) {
            this.setTexture(i, textures[i], pitchs[i]);
        }
    }

    shouldWriteTextureAtIndex(index: number, texture: THREE.Texture) {
        // Do not apply noData texture if current texture is valid
        return !this.textures[index] || texture && texture.isTexture;
    }
}

export class RasterColorTile extends RasterTile<ColorLayerLike> {
    get effect_type() {
        return this.layer.effect_type;
    }
    get effect_parameter() {
        return this.layer.effect_parameter;
    }
    get transparent() {
        return this.layer.transparent;
    }
}

export class RasterElevationTile extends RasterTile<ElevationLayerLike, RasterElevationTileEventMap> {
    protected scaleFactor: number;
    protected min: number;
    protected max: number;
    protected bias: number;
    protected mode: number;
    protected zmin: number;
    protected zmax: number;

    constructor(layer: ElevationLayerLike) {
        super(layer);

        this.scaleFactor = 1.0;

        let bias = 0;
        let mode: ElevationModes = ELEVATION_MODES.DATA;
        let zmin = -Infinity;
        let zmax = Infinity;
        // Define elevation properties
        if (layer.useRgbaTextureElevation) {
            mode = ELEVATION_MODES.RGBA;
            zmax = 5000;
            throw new Error('Restore this feature');
        } else if (layer.useColorTextureElevation) {
            this.scaleFactor = (layer.colorTextureElevationMaxZ ?? 0) - (layer.colorTextureElevationMinZ ?? 0);
            mode = ELEVATION_MODES.COLOR;
            bias = layer.colorTextureElevationMinZ ?? 0;
            this.min = this.layer.colorTextureElevationMinZ ?? 0;
            this.max = this.layer.colorTextureElevationMaxZ ?? 0;
        } else {
            this.min = 0;
            this.max = 0;
        }
        this.bias = layer.bias ?? bias;
        this.mode = layer.mode ?? mode;
        this.zmin = layer.zmin ?? zmin;
        this.zmax = layer.zmax ?? zmax;

        layer.addEventListener('scale-property-changed', this._handlerCBEvent);
    }

    get scale() {
        return this.layer.scale * this.scaleFactor;
    }

    dispose(removeEvent: boolean = true) {
        super.dispose(removeEvent);
        if (removeEvent) {
            this.layer.removeEventListener('scale-property-changed', this._handlerCBEvent);
        }
    }

    override initFromParent(parent: RasterTile | null, extents: Tile[]) { // TODO: Fix
        const currentLevel = this.level;
        super.initFromParent(parent, extents);
        this.updateMinMaxElevation();
        if (currentLevel !== this.level) {
            this.dispatchEvent({ type: 'rasterElevationLevelChanged', node: this });
        }
    }

    setTextures(textures: THREE.Texture[], offsetScales: THREE.Vector4[]) {
        const anyValidTexture = textures.find(texture => texture != null);
        if (!anyValidTexture) {
            return;
        }
        const currentLevel = this.level;
        this.replaceNoDataValueFromTexture(anyValidTexture);
        super.setTextures(textures, offsetScales);
        this.updateMinMaxElevation();
        if (currentLevel !== this.level) {
            this.dispatchEvent({ type: 'rasterElevationLevelChanged', node: this });
        }
    }

    updateMinMaxElevation() {
        const firstValidIndex = this.textures.findIndex(texture => texture.isTexture);
        if (firstValidIndex !== -1 && !this.layer.useColorTextureElevation) {
            const { min, max } = computeMinMaxElevation(
                this.textures[firstValidIndex],
                this.offsetScales[firstValidIndex],
                {
                    noDataValue: this.layer.noDataValue ?? 0,
                    colorTextureElevationMinZ: this.layer.colorTextureElevationMinZ ?? 0,
                    colorTextureElevationMaxZ: this.layer.colorTextureElevationMaxZ ?? 0,
                    zmin: this.layer.zmin ?? null,
                    zmax: this.layer.zmax ?? null,
                });
            if (this.min !== min || this.max !== max) {
                this.min = (min !== null && !isNaN(min)) ? min : this.min;
                this.max = (max !== null && !isNaN(max)) ? max : this.max;
            }
        }
    }

    replaceNoDataValueFromTexture(texture: THREE.Texture) {
        const nodatavalue = this.layer.noDataValue;
        if (nodatavalue == undefined) {
            return;
        }
        // replace no data value with parent texture value or 0 (if no significant value found).
        const parentTexture = this.textures.find(texture => texture != null);
        const parentDataElevation = parentTexture && parentTexture.image && parentTexture.image.data;
        const dataElevation = texture.image && texture.image.data;

        if (dataElevation && !checkNodeElevationTextureValidity(dataElevation, nodatavalue)) {
            insertSignificantValuesFromParent(dataElevation, parentDataElevation && dataParent(texture, parentTexture, parentDataElevation, pitch), nodatavalue);
        }
    }
}

function dataParent(texture: THREE.Texture, parentTexture: THREE.Texture, parentDataElevation: Uint8Array, pitch: THREE.Vector4) {
    if (parentTexture.extent) {
        texture.extent?.offsetToParent(parentTexture.extent, pitch);
    }
    return (i: number) => parentDataElevation[getIndiceWithPitch(i, pitch, 256)];
}
