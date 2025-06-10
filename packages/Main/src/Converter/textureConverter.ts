import * as THREE from 'three';
import Feature2Texture from 'Converter/Feature2Texture';
import { Extent } from '@itowns/geographic';

import type Tile from 'Core/Tile/Tile';
import type { FeatureCollection } from 'Core/Feature';

const extentTexture = new Extent('EPSG:4326');

interface LayerLike {
    crs: string;
    subdivisionThreshold: number;
    minFilter: THREE.MinificationTextureFilter;
    magFilter: THREE.MagnificationTextureFilter;
    transparent: boolean;
    source: {
        backgroundLayer: {
            paint: {
                'background-color': string;
            };
        };
    };
}

interface ColorLayerLike extends LayerLike {
    readonly isColorLayer: boolean;
}


const textureLayer = (texture: THREE.Texture, layer: LayerLike) => {
    texture.generateMipmaps = false;
    texture.magFilter = layer.magFilter || THREE.LinearFilter;
    texture.minFilter = layer.minFilter || THREE.LinearFilter;
    return texture;
};

function textureColorLayer(texture: THREE.Texture, layer: LayerLike) {
    texture.anisotropy = 16;
    texture.premultiplyAlpha = layer.transparent;
    return textureLayer(texture, layer);
}

export default {
    convert(data: FeatureCollection | THREE.Texture, destinationTile: Tile, layer: LayerLike) {
        let texture;
        if ('isFeatureCollection' in data) {
            const backgroundLayer = layer.source.backgroundLayer;
            const backgroundColor = (backgroundLayer && backgroundLayer.paint) ?
                new THREE.Color(backgroundLayer.paint['background-color']) :
                undefined;

            destinationTile.toExtent(layer.crs, extentTexture);
            texture = Feature2Texture.createTextureFromFeature(data, extentTexture, layer.subdivisionThreshold, layer.style, backgroundColor);
            texture.features = data;
            texture.extent = destinationTile;
        } else if (data.isTexture) {
            texture = data;
        } else {
            throw (new Error('Data type is not supported to convert into texture'));
        }

        if (layer.isColorLayer) {
            return textureColorLayer(texture, layer);
        } else if (layer.isElevationLayer) {
            if (texture.flipY) {
                // DataTexture default to false, so make sure other Texture types
                // do the same (eg image texture)
                // See UV construction for more details
                texture.flipY = false;
            }
            return textureLayer(texture, layer);
        }
    },
};
