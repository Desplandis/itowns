import Source from 'Source/Source';
import Fetcher from 'Provider/Fetcher';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import { load } from '@loaders.gl/core';

/**
 * @param {ArrayBuffer} buffer
 */
async function parseTileset(buffer) {
    const tilesetJSON = await Tiles3DLoader.parse(buffer, {
        '3d-tiles': {
            isTileset: true,
        },
    });
    return tilesetJSON;
}

/**
 * @param {string} url
 */
async function loadURL(url) {
    const tilesetJSON = await load(url, Tiles3DLoader, {});
    return tilesetJSON;
}

/**
 * @classdesc
 * An object defining the source connection to a 3DTiles dataset from a web server.
 *
 * @extends Source
 *
 * @property {boolean} isC3DTilesSource - Used to checkout whether this source is a isC3DTilesSource. Default is
 * true. You should not change this, as it is used internally for optimisation.
 * @property {string} url - The URL of the tileset json.
 * @property {string} baseUrl - The base URL to access tiles.
 * @extends Source
 */
class C3DTilesSource extends Source {
    /**
     * Create a new Source for 3D Tiles data from a web server.
     *
     * @constructor
     *
     * @param {Object} source An object that can contain all properties of {@link Source}.
     * Only `url` is mandatory.
     */
    constructor(source) {
        super(source);
        this.isC3DTilesSource = true;
        this.baseUrl = this.url.slice(0, this.url.lastIndexOf('/') + 1);
        // this.whenReady = Fetcher.arrayBuffer(this.url, this.networkOptions)
        //     .then(parseTileset);
        this.whenReady = loadURL(this.url);
    }
}

export default C3DTilesSource;
