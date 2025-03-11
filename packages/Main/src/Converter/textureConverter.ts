import * as THREE from 'three';
import Feature2Texture from 'Converter/Feature2Texture';
import { Extent } from '@itowns/geographic';

import type { FeatureCollection } from 'Core/Feature';
import Tile from 'Core/Tile/Tile';

interface Layer {
    crs: string;
    subdivisionThreshold: number;
    source: { backgroundLayer?: THREE.Color };
    magFilter: THREE.MagnificationTextureFilter;
    minFilter: THREE.MinificationTextureFilter;
    transparent: boolean;
    backgroundLayer: {
        paint: any, // TODO[QB]
    }
}

const extentTexture = new Extent('EPSG:4326');

const textureLayer = (texture: THREE.Texture, layer: Layer) => { // TODO[QB]
    texture.generateMipmaps = false;
    texture.magFilter = layer.magFilter || THREE.LinearFilter;
    texture.minFilter = layer.minFilter || THREE.LinearFilter;
    return texture;
};

function textureColorLayer(texture: THREE.Texture, layer: Layer) { // TODO[QB]
    texture.anisotropy = 16;
    texture.premultiplyAlpha = layer.transparent;
    return textureLayer(texture, layer);
}

export default {
    // TODO[QB]: Why not split convert into two functions:
    // - convertToColor which takes textures and featurecollections
    // - convertToElevation which takes textures
    convert(data: THREE.Texture | FeatureCollection, destinationTile: Tile, layer: Layer) {
        let texture;
        if ('isFeatureCollection' in data) {
            const backgroundLayer = layer.source.backgroundLayer;
            const backgroundColor = (backgroundLayer && backgroundLayer.paint) ?
                new THREE.Color(backgroundLayer.paint['background-color']) :
                undefined;

            destinationTile.toExtent(layer.crs, extentTexture);
            texture = Feature2Texture.createTextureFromFeature(data, extentTexture, layer.subdivisionThreshold, layer.style, backgroundColor);
            // TODO[QB]: use Texture#userData
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

        console.log('TOTO');
    },
};
