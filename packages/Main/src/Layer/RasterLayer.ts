import Layer from 'Layer/Layer';
import { removeLayeredMaterialNodeLayer } from 'Process/LayeredMaterialNodeProcessing';
import textureConverter from 'Converter/textureConverter';
import { CACHE_POLICIES } from 'Core/Scheduler/Cache';

import type { Texture, MinificationTextureFilter, MagnificationTextureFilter } from 'three';
import type { Extent } from '@itowns/geographic';
import type { LayerOptions } from 'Layer/Layer';

interface RasterLayerOptions extends LayerOptions {
    minFilter?: MinificationTextureFilter;
    magFilter?: MagnificationTextureFilter;
}

abstract class RasterLayer extends Layer<Texture, Texture> { // TODO[QB]: Events
    parent: any;
    minFilter: MinificationTextureFilter | undefined;
    magFilter: MagnificationTextureFilter | undefined;

    constructor(id: string, config: RasterLayerOptions) {
        const {
            cacheLifeTime = CACHE_POLICIES.TEXTURE,
            minFilter,
            magFilter,
            ...layerConfig
        } = config;

        super(id, {
            ...layerConfig,
            cacheLifeTime,
        });

        this.minFilter = minFilter;
        this.magFilter = magFilter;
    }

    async convert(data: Texture, extentDestination: Tile) {
        return textureConverter.convert(data, extentDestination, this);
    }

    /**
    * All layer's textures are removed from scene and disposed from video device.
    * @param {boolean} [clearCache=false] Whether to clear the layer cache or not
    */
    delete(clearCache: boolean) {
        if (clearCache) {
            this.cache.clear();
        }
        for (const root of this.parent.level0Nodes) {
            root.traverse(removeLayeredMaterialNodeLayer(this.id));
        }
    }
}

export default RasterLayer;
