import * as THREE from 'three';
import LASLoader from 'Parser/LASLoader';

const lasLoader = new LASLoader();

const WORKER_LIMIT = 1;
/** @type{Worker[]} */
const workerPool = [];
let taskIdCounter = 0;

function createWorker() {
    const worker = new Worker(new URL('../Worker/LASWorker.js', import.meta.url));

    worker._callbacks = {};
    worker._taskCost = {};
    worker._taskLoad = 0;

    worker.onmessage = (event) => {
        const { id, attributes } = event.data;

        // console.log(`Task ${id} status: ???`);

        if (attributes !== undefined) {
            worker._callbacks[id].resolve(attributes);
        } else {
            worker._callbacks[id].reject();
        }

        returnWorker(worker, id);
    };

    return worker;
}

function getWorker(/** @type{number} */ taskId, /** @type{number} */ taskCost) {
    // console.warn(`[${taskId}]: get with ${taskCost}`);
    let worker;
    if (workerPool.length < WORKER_LIMIT) {
        worker = createWorker();
        workerPool.push(worker);
    } else {
        const pool = workerPool.sort((a, b) => b._taskLoad - a._taskLoad);
        worker = pool[pool.length - 1];
    }

    worker._taskCost[taskId] = taskCost;
    worker._taskLoad += taskCost;

    return worker;
}

function returnWorker(worker, taskId) {
    // console.log(`[${taskId}]: return with ${worker._taskCost[taskId]}`);
    worker._taskLoad -= worker._taskCost[taskId];
    delete worker._callbacks[taskId];
    delete worker._taskCost[taskId];
}

/**
 * Parses a LAS or LAZ (LASZip) file. Note that this function is
 * **CPU-bound** and shall be parallelised in a dedicated worker.
 * @param {ArrayBuffer} data - Binary data to parse.
 * @param {Object} [options] - Parsing options.
 * @param {8 | 16} [options.colorDepth] - Color depth encoding (in bits).
 * Either 8 or 16 bits. Defaults to 8 bits for LAS 1.2 and 16 bits for later
 * versions (as mandatory by the specification)
 */
async function parseFile(data, options) {
    const useWorker = true && !!window.Worker; // TODO: Add as options or when getWorker fails ?
    // TODO: Worker can throw SecurityError, NetworkError or SyntaxError

    if (useWorker) {
        const taskId = taskIdCounter++;
        const worker = getWorker(taskId, data.byteLength);
        return new Promise((resolve, reject) => {
            worker._callbacks[taskId] = { resolve, reject };
            worker.postMessage({
                id: taskId,
                data,
                options: {
                    colorDepth: options?.colorDepth,
                },
            }, [data]);
        });
    }

    return lasLoader.parseFile(data, options);
}

async function parseChunk(data, options) {
    const useWorker = true && !!window.Worker; // TODO: Add as options or when getWorker fails ?
    // TODO: Worker can throw SecurityError, NetworkError or SyntaxError

    if (useWorker) {
        const taskId = taskIdCounter++;
        const worker = getWorker(taskId, data.byteLength);
        return new Promise((resolve, reject) => {
            worker._callbacks[taskId] = { resolve, reject };
            worker.postMessage({
                id: taskId,
                data,
                options: {
                    colorDepth: options?.colorDepth,
                    pointCount: options.pointCount,
                    header: options.header,
                    min: options.min,
                },
            }, [data]);
        });
    }

    return lasLoader.parseChunk(data, options);
}


function buildBufferGeometry(attributes) {
    const geometry = new THREE.BufferGeometry();

    const positionBuffer = new THREE.BufferAttribute(attributes.position, 3);
    geometry.setAttribute('position', positionBuffer);

    const intensityBuffer = new THREE.BufferAttribute(attributes.intensity, 1);
    geometry.setAttribute('intensity', intensityBuffer);

    const returnNumber = new THREE.BufferAttribute(attributes.returnNumber, 1);
    geometry.setAttribute('returnNumber', returnNumber);

    const numberOfReturns = new THREE.BufferAttribute(attributes.numberOfReturns, 1);
    geometry.setAttribute('numberOfReturns', numberOfReturns);

    const classBuffer = new THREE.BufferAttribute(attributes.classification, 1);
    geometry.setAttribute('classification', classBuffer);

    const pointSourceID = new THREE.BufferAttribute(attributes.pointSourceID, 1);
    geometry.setAttribute('pointSourceID', pointSourceID);

    if (attributes.color) {
        const colorBuffer = new THREE.BufferAttribute(attributes.color, 4, true);
        geometry.setAttribute('color', colorBuffer);
    }
    const scanAngle = new THREE.BufferAttribute(attributes.scanAngle, 1);
    geometry.setAttribute('scanAngle', scanAngle);

    return geometry;
}

/** The LASParser module provides a [parse]{@link
 * module:LASParser.parse} method that takes a LAS or LAZ (LASZip) file in, and
 * gives a `THREE.BufferGeometry` containing all the necessary attributes to be
 * displayed in iTowns. It uses the
 * [copc.js](https://github.com/connormanning/copc.js/) library.
 *
 * @module LASParser
 */
export default {
    /**
     * Set the laz-perf decoder path.
     * @param {string} path - path to `laz-perf.wasm` folder.
     */
    enableLazPerf(path) {
        if (!path) {
            throw new Error('Path to laz-perf is mandatory');
        }
        lasLoader.lazPerf = path;
    },


    /**
     * Parses a chunk of a LAS or LAZ (LASZip) and returns the corresponding
     * `THREE.BufferGeometry`.
     *
     * @param {ArrayBuffer} data - The file content to parse.
     * @param {Object} options
     * @param {Object} options.in - Options to give to the parser.
     * @param {number} option.in.pointCount - Number of points encoded in this
     * data chunk.
     * @param {Object} options.in.header - Partial LAS file header.
     * @param {number} options.in.header.pointDataRecordFormat - Type of Point
     * Data Record contained in the LAS file.
     * @param {number} options.in.header.pointDataRecordLength - Size (in bytes)
     * of the Point Data Record.
     * @param {Object} [options.eb] - Extra bytes LAS VLRs headers.
     * @param { 8 | 16 } [options.in.colorDepth] - Color depth (in bits).
     * Defaults to 8 bits for LAS 1.2 and 16 bits for later versions
     * (as mandatory by the specification)
     *
     * @return {Promise<THREE.BufferGeometry>} A promise resolving with a
     * `THREE.BufferGeometry`.
     */
    parseChunk(data, options = {}) {
        return parseChunk(data, options.in).then((parsedData) => {
            const geometry = buildBufferGeometry(parsedData.attributes);
            geometry.userData = parsedData.header;
            geometry.computeBoundingBox();
            return geometry;
        });
    },

    /**
     * Parses a LAS file or a LAZ (LASZip) file and return the corresponding
     * `THREE.BufferGeometry`.
     *
     * @param {ArrayBuffer} data - The file content to parse.
     * @param {Object} [options]
     * @param {Object} [options.in] - Options to give to the parser.
     * @param { 8 | 16 } [options.in.colorDepth] - Color depth (in bits).
     * Defaults to 8 bits for LAS 1.2 and 16 bits for later versions
     * (as mandatory by the specification)
     *
     * @return {Promise} A promise resolving with a `THREE.BufferGeometry`. The
     * header of the file is contained in `userData`.
     */
    parse(data, options = {}) {
        if (options.out?.skip) {
            console.warn("Warning: options 'skip' not supported anymore");
        }
        return parseFile(data, {
            colorDepth: options.in?.colorDepth,
        }).then((parsedData) => {
            const geometry = buildBufferGeometry(parsedData.attributes);
            geometry.userData = parsedData.header;
            geometry.computeBoundingBox();
            return geometry;
        });
    },
};
