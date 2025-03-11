import { TextureLoader, DataTexture, RedFormat, FloatType } from 'three';
const TEXTURE_TILE_DIM = 256;
const TEXTURE_TILE_SIZE = TEXTURE_TILE_DIM * TEXTURE_TILE_DIM;
const textureLoader = new TextureLoader();
function checkResponse(response) {
    if (!response.ok) {
        const error = new Error(`Error loading ${response.url}: status ${response.status}`);
        error.cause = response;
        throw error;
    }
}
const arrayBuffer = (url, options = {}) => fetch(url, options).then((response) => {
    checkResponse(response);
    return response.arrayBuffer();
});
/**
 * Utilitary to fetch resources from a server using the [fetch API](
 * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch).
 *
 */
export default {
    /**
     * A fetch wrapper that returns the response as plain text.
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     * @returns A promise that resolves to a string.
     */
    text(url, options = {}) {
        return fetch(url, options).then((response) => {
            checkResponse(response);
            return response.text();
        });
    },
    /**
     * A fetch wrapper thet returns the response as a JSON object.
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     * @returns A promise that resolves to a JSON object.
     */
    json(url, options = {}) {
        return fetch(url, options).then((response) => {
            checkResponse(response);
            return response.json();
        });
    },
    /**
     * A fetch wrapper that returns the response as an XML document.
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     * @returns A promise that resolves to an XML Document.
     */
    xml(url, options = {}) {
        return fetch(url, options).then((response) => {
            checkResponse(response);
            return response.text();
        }).then(text => new window.DOMParser().parseFromString(text, 'text/xml'));
    },
    /**
     * A wrapper around [THREE.TextureLoader](https://threejs.org/docs/#api/en/loaders/TextureLoader).
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     * Note that THREE.js docs mentions `withCredentials`, but it is not
     * actually used in [THREE.TextureLoader](https://threejs.org/docs/#api/en/loaders/TextureLoader).
     *
     * @returns A promise that resolves to a
     * [THREE.Texture](https://threejs.org/docs/api/en/textures/Texture.html).
     */
    texture(url, options = {}) {
        if (options.crossOrigin) {
            textureLoader.crossOrigin = options.crossOrigin;
        }
        const promise = new Promise((resolve, reject) => {
            textureLoader.load(url, resolve, () => { }, (event) => {
                const error = new Error(`Failed to load texture from URL: \`${url}\``);
                error.cause = event;
                reject(error);
            });
        });
        return promise;
    },
    /**
     * A fetch wrapper that returns the response as an array buffer.
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     *
     * @returns A promise that resolves to an array buffer.
     */
    arrayBuffer,
    /**
     * A fetch wrapper that returns the response as a
     * [THREE.DataTexture](https://threejs.org/docs/#api/en/textures/DataTexture).
     *
     * @param url - The URL of the resource you want to fetch.
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     * @returns A promise that resolves to a DataTexture.
     */
    textureFloat(url, options = {}) {
        return arrayBuffer(url, options).then((buffer) => {
            if (buffer.byteLength !== TEXTURE_TILE_SIZE * Float32Array.BYTES_PER_ELEMENT) {
                throw new Error(`Invalid float data from URL: \`${url}\``);
            }
            const data = new Float32Array(buffer);
            const texture = new DataTexture(data, TEXTURE_TILE_DIM, TEXTURE_TILE_DIM, RedFormat, FloatType);
            texture.internalFormat = 'R32F';
            texture.needsUpdate = true;
            return texture;
        });
    },
    /**
     * Wrapper over fetch to get a bunch of files sharing the same name, but
     * different extensions.
     *
     * @param baseUrl - The shared URL of the resources to fetch.
     * @param extensions - An object containing arrays. The keys of
     * each of this array are available fetch type, such as `text`, `json` or
     * even `arrayBuffer`. The arrays contains the extensions to append after
     * the `baseUrl` (see example below).
     * @param options - Fetch options (passed directly to `fetch()`), see
     * [the syntax for more information](
     * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     *
     * @returns An array of promises, containing all the files, organized by
     * their extensions (see the example below).
     *
     * @example
     * ```
     * itowns.Fetcher.multiple('http://geo.server/shapefile', {
     *     // will fetch:
     *     // - http://geo.server/shapefile.shp
     *     // - http://geo.server/shapefile.dbf
     *     // - http://geo.server/shapefile.shx
     *     // - http://geo.server/shapefile.prj
     *     arrayBuffer: ['shp', 'dbf', 'shx'],
     *     text: ['prj'],
     * }).then(function _(result) {
     *     // result looks like:
     *     result = {
     *         shp: ArrayBuffer
     *         dbf: ArrayBuffer
     *         shx: ArrayBuffer
     *         prj: string
     *     };
     * });
     * ```
     */
    multiple(baseUrl, extensions, options = {}) {
        const promises = [];
        let url;
        for (const fetchType in extensions) {
            if (!this[fetchType]) {
                throw new Error(`${fetchType} is not a valid Fetcher method.`);
            }
            else {
                for (const extension of extensions[fetchType]) {
                    url = `${baseUrl}.${extension}`;
                    promises.push(this[fetchType](url, options).then(result => ({
                        type: extension,
                        result,
                    })));
                }
            }
        }
        return Promise.all(promises).then((result) => {
            const all = {};
            for (const res of result) {
                all[res.type] = res.result;
            }
            return Promise.resolve(all);
        });
    },
    get(format = '') {
        const [type, subtype] = format.split('/');
        switch (type) {
            case 'application':
                switch (subtype) {
                    case 'geo+json':
                    case 'json':
                        return this.json;
                    case 'kml':
                    case 'gpx':
                        return this.xml;
                    case 'x-protobuf;type=mapbox-vector':
                    case 'gtx':
                        return this.arrayBuffer;
                    case 'isg':
                    case 'gdf':
                    default:
                        return this.text;
                }
            case 'image':
                switch (subtype) {
                    case 'x-bil;bits=32':
                        return this.textureFloat;
                    default:
                        return this.texture;
                }
            default:
                return this.texture;
        }
    },
};
