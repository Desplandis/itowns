import Layer, { LayerConfig } from 'Layer/Layer';
import { STRATEGY_MIN_NETWORK_TRAFFIC } from 'Layer/LayerUpdateStrategy';
import { removeLayeredMaterialNodeTile } from 'Process/LayeredMaterialNodeProcessing';
import textureConverter from 'Converter/textureConverter';
import { CACHE_POLICIES } from 'Core/Scheduler/Cache';

import type * as THREE from 'three';

interface RasterLayerConfig extends LayerConfig {
    minFilter: THREE.TextureFilter;
    magFilter: THREE.TextureFilter;
    updateStrategy: {
        type: string;
        options: Record<string, unknown>;
    };
}

class RasterLayer extends Layer<string, THREE.Texture> {
    minFilter: THREE.TextureFilter;
    magFilter: THREE.TextureFilter;
    updateStrategy: {
        type: string;
        options: Record<string, unknown>;
    };

    constructor(id: string, config: RasterLayerConfig) {
        const {
            cacheLifeTime = CACHE_POLICIES.TEXTURE,
            minFilter,
            magFilter,
            updateStrategy,
            ...layerConfig
        } = config;

        super(id, {
            ...layerConfig,
            cacheLifeTime,
        });

        this.minFilter = minFilter;
        this.magFilter = magFilter;

        this.updateStrategy = updateStrategy ?? {
            type: STRATEGY_MIN_NETWORK_TRAFFIC,
            options: {},
        };
    }

    override convert(data: THREE.Texture, extentDestination: THREE.Vector2) {
        return textureConverter.convert(data, extentDestination, this);
    }

    /**
    * All layer's textures are removed from scene and disposed from video device.
    * @param {boolean} [clearCache=false] Whether to clear the layer cache or not
    */
    override delete(clearCache: boolean) {
        if (clearCache) {
            this.cache.clear();
        }
        for (const root of this.parent.level0Nodes) {
            root.traverse(removeLayeredMaterialNodeTile(this.id));
        }
    }
}

export default RasterLayer;
