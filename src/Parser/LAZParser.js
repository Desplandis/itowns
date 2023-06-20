import { LazPerf } from 'laz-perf';
import * as copc from 'copc';
import * as THREE from 'three';

const CDN_URL = 'https://unpkg.com/laz-perf@0.0.6/lib/';

function parseView(view, options = { in: { colorDepth: 16 } }) {
    const getPosition = ['X', 'Y', 'Z'].map(view.getter);
    const getIntensity = view.getter('Intensity');
    const getReturnNumber = view.getter('ReturnNumber');
    const getNumberOfReturns = view.getter('NumberOfReturns');
    const getClassification = view.getter('Classification');
    const getPointSourceID = view.getter('PointSourceId');
    const getColor = view.dimensions.Red ?
        ['Red', 'Green', 'Blue'].map(view.getter) : undefined;

    const positions = new Float32Array(view.pointCount * 3);
    const intensities = new Uint16Array(view.pointCount);
    const returnNumbers = new Uint8Array(view.pointCount);
    const numberOfReturns = new Uint8Array(view.pointCount);
    const classifications = new Uint8Array(view.pointCount);
    const pointSourceIDs = new Uint16Array(view.pointCount);
    const colors = getColor ? new Uint8Array(view.pointCount * 4) : undefined;

    for (let i = 0; i < view.pointCount; i++) {
        // `getPosition` apply scale and offset transform to the X, Y, Z values.
        // See https://github.com/connormanning/copc.js/blob/master/src/las/extractor.ts.
        const [x, y, z] = getPosition.map(f => f(i));
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        intensities[i] = getIntensity(i);
        returnNumbers[i] = getReturnNumber(i);
        numberOfReturns[i] = getNumberOfReturns(i);

        if (getColor) {
            // Note that we do not infer color depth as it is expensive (i.e.
            // traverse the whole view to check if there exists a red, green or
            // blue value > 255).
            let [r, g, b] = getColor.map(f => f(i));

            if (options.in.colorDepth === 16) {
                r /= 256;
                g /= 256;
                b /= 256;
            }

            colors[i * 4] = r;
            colors[i * 4 + 1] = g;
            colors[i * 4 + 2] = b;
            colors[i * 4 + 3] = 255;
        }

        classifications[i] = getClassification(i);
        pointSourceIDs[i] = getPointSourceID(i);
    }

    return {
        position: positions,
        intensity: intensities,
        returnNumber: returnNumbers,
        numberOfReturns,
        classification: classifications,
        pointSourceID: pointSourceIDs,
        color: colors,
    };
}

function parseBuffer(pointData, options) {
    const { header, eb } = options.in;
    const view = copc.Las.View.create(pointData, header, eb);
    const attrs = parseView(view, options);

    const geometry = new THREE.BufferGeometry();
    geometry.userData = header;
    geometry.userData.vertexCount = view.pointCount;

    const positionBuffer = new THREE.BufferAttribute(attrs.position, 3);
    geometry.setAttribute('position', positionBuffer);

    const intensityBuffer = new THREE.BufferAttribute(attrs.intensity, 1, true);
    geometry.setAttribute('intensity', intensityBuffer);

    const returnNumber = new THREE.BufferAttribute(attrs.returnNumber, 1);
    geometry.setAttribute('returnNumber', returnNumber);

    const numberOfReturns = new THREE.BufferAttribute(attrs.numberOfReturns, 1);
    geometry.setAttribute('numberOfReturns', numberOfReturns);

    const classBuffer = new THREE.BufferAttribute(attrs.classification, 1, true);
    geometry.setAttribute('classification', classBuffer);

    const pointSourceID = new THREE.BufferAttribute(attrs.pointSourceID, 1);
    geometry.setAttribute('pointSourceID', pointSourceID);

    if (attrs.color) {
        const colorBuffer = new THREE.BufferAttribute(attrs.color, 4, true);
        geometry.setAttribute('color', colorBuffer);
    }

    geometry.computeBoundingBox();
    return geometry;
}

/** The LAZParser module provides a [parseChunk]{@link
 * module:LASParser.parseChunk} method that takes a LAZ (LASZip) chunk in, and
 * gives a `THREE.BufferGeometry` containing all the necessary attributes to be
 * displayed in iTowns. It uses the
 * [copc.js](https://github.com/connormanning/copc.js/) library.
 *
 * @module LAZParser
 */
export default {
    /**
     * @typedef {Object} ParsingOptions - Options of the parser.
     * @property {Object} in - Options from the source input.
     * @property {number} in.pointCount - Number of points in this data
     * chunk.
     * @property {8 | 16} [in.colorDepth=16] - Color depth in bits (either 8
     * or 16).
     * @property {Object} in.header - Partial LAS header.
     * @property {number} in.header.pointDataRecordFormat - Type of point data
     * records contained by the buffer.
     * @property {number} in.header.pointDataRecordLength - Size (in bytes) of
     * the point data records.
     * @property {number[]} in.header.scale - Scale factors (an array `[xScale,
     * yScale, zScale]`) multiplied to the X, Y, Z point record values.
     * @property {number[]} in.header.offset - Offsets (an array `[xOffset,
     * xOffset, zOffset]`) added to the scaled X, Y, Z point record values.
     * @property {copc.Las.ExtraBytes[]} [in.eb] - Extra bytes LAS VLRs headers
     */

    /**
     * @callback {ChunkParser} - Parse a LASZip compressed chunk and return the
     * corresponding `THREE.BufferGeometry`.
     * @param {ArrayBuffer} data - The chunk of compressed point data to parse.
     * @param {ParsingOptions} options - Options of the parser.
     * @return {THREE.BufferGeometry} - A buffer geometry containing the following
     * attributes:
     * - `position`
     * - `intensity` (normalized)
     * - `returnNumber`
     * - `numberOfReturns`
     * - `classification` (normalized)
     * - `pointSourceID`
     * - `color` (normalized, optionally)
     */

    /**
     * Parse a LASzip compressed chunk and return the corresponding
     * `THREE.BufferGeometry`.
     *
     * @param {Object} [config]
     * @param {string} [config.baseUrl] - Base url of the `las-zip.wasm` file
     * (defaults to the `unpkg` CDN of `las-zip@0.0.6`).
     * @return {ChunkParser}
     */
    parseChunk(config = {}) {
        const baseUrl = config.baseUrl ?? CDN_URL;

        // Lazy-load laz-perf on first parse call
        let LazPerfModule;
        const getLAZPerf = () => {
            if (!LazPerfModule) {
                LazPerfModule = LazPerf.create({
                    ...config,
                    locateFile: file => `${baseUrl}/${file}`,
                });
            }
            return LazPerfModule;
        };

        /**
         * @param {Uint8Array} data
         * @param {ParsingOptions} options
         */
        return async (data, options) => {
            const { header, pointCount } = options.in;
            const { pointDataRecordFormat, pointDataRecordLength } = header;

            const bytes = new Uint8Array(data);
            const buffer = await copc.Las.PointData.decompressChunk(bytes, {
                pointCount,
                pointDataRecordFormat,
                pointDataRecordLength,
            }, await getLAZPerf());

            return parseBuffer(buffer, options);
        };
    },
};
