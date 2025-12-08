import Source from 'Source/Source';
import Fetcher from 'Provider/Fetcher';
import PotreeBinParser from 'Parser/PotreeBinParser';
import PotreeCinParser from 'Parser/PotreeCinParser';

type PotreeBBox = {
    lx: number; ly: number; lz: number;
    ux: number; uy: number; uz: number;
}

interface PotreeCloud {
    boundingBox: PotreeBBox;
    tightBoundingBox: PotreeBBox;
    pointAttributes: string[];
    spacing: number;
    scale: number;
    hierarchyStepSize: number;
    octreeDir: string;
}

interface PotreeSourceParameters {
    url: string;
    file: string;
    crs: string;
    cloud?: PotreeCloud;
    networkOptions?: RequestInit;
}

/**
 * PotreeSource are objects containing informations on how to fetch points
 * cloud resources.
 *
 * The `cloud` file stores information about the potree cloud in JSON format.
 * The structure is:
 *
 * - `version` - The cloud.js format may change over time. The version number
 *   is necessary so that parsers know how to interpret the data.
 * - `octreeDir` - Directory or URL where node data is stored. Usually points
 *   to "data".
 * - `boundingBox` - Contains the minimum and maximum of the axis aligned
 *   bounding box. This bounding box is cubic and aligned to fit to the octree
 *   root.
 * - `tightBoundingBox` - This bounding box tightly fits the point data.
 * - `pointAttributes` - Declares the point data format. May be 'LAS', 'LAZ' or
 *   in case of the BINARY format an array of attributes like
 *   `['POSITION_CARTESIAN', 'COLOR_PACKED', 'INTENSITY']`
 * - `POSITION_CARTESIAN` - 3 x 32bit signed integers for x/y/z coordinates
 * - `COLOR_PACKED` - 4 x unsigned byte for r,g,b,a colors.
 * - `spacing` - The minimum distance between points at root level.
 *
 * @example
 * ```json
 * {
 *     "version": "1.6",
 *     "octreeDir": "data",
 *     "boundingBox": {
 *         "lx": -4.9854,
 *         "ly": 1.0366,
 *         "lz": -3.4494,
 *         "ux": 0.702300000000001,
 *         "uy": 6.7243,
 *         "uz": 2.2383
 *     },
 *     "tightBoundingBox": {
 *         "lx": -4.9854,
 *         "ly": 1.0375,
 *         "lz": -3.4494,
 *         "ux": -0.7889,
 *         "uy": 6.7243,
 *         "uz": 1.1245
 *     },
 *     "pointAttributes": [
 *         "POSITION_CARTESIAN",
 *         "COLOR_PACKED"
 *     ],
 *     "spacing": 0.03,
 *     "scale": 0.001,
 *     "hierarchyStepSize": 5
 * }
 * ```
 */
class PotreeSource extends Source {
    file: string;
    extensionOctree: 'hrc';

    // Properties initialized after fetching cloud file
    boundsConforming!: [number, number, number, number, number, number];
    pointAttributes!: string[];
    baseurl!: string;
    extension!: 'cin' | 'bin';
    scale!: number;
    zmin!: number;
    zmax!: number;
    spacing!: number;
    hierarchyStepSize!: number;

    /**
     * @param source - An object that can contain all properties of a
     * PotreeSource: `url` (folder url), `file` (cloud file name), and `crs`
     * (the coordinate reference system).
     */
    constructor(source: PotreeSourceParameters) {
        if (!source.file) {
            throw new Error('New PotreeSource: file is required');
        }
        if (!source.crs) {
            // with better data and the spec this might be removed
            throw new Error('New PotreeSource: crs is required');
        }

        super(source);
        this.file = source.file;
        this.fetcher = Fetcher.arrayBuffer;
        this.extensionOctree = 'hrc';

        // For cloud specification visit:
        // https://github.com/PropellerAero/potree-propeller-private/blob/master/docs/file_format.md#cloudjs
        const cloudPromise = source.cloud ?
            Promise.resolve(source.cloud) :
            Fetcher.json(`${this.url}/${this.file}`, this.networkOptions) as Promise<PotreeCloud>;
        this.whenReady = cloudPromise
            .then((cloud) => {
                this.boundsConforming = [
                    cloud.tightBoundingBox.lx,
                    cloud.tightBoundingBox.ly,
                    cloud.tightBoundingBox.lz,
                    cloud.tightBoundingBox.ux,
                    cloud.tightBoundingBox.uy,
                    cloud.tightBoundingBox.uz,
                ];
                this.pointAttributes = cloud.pointAttributes;
                this.baseurl = `${this.url}/${cloud.octreeDir}/r`;
                // @ts-expect-error non-standard CIN extension, shall be removed
                this.extension = cloud.pointAttributes === 'CIN' ? 'cin' : 'bin';
                this.parser = this.extension === 'cin' ?
                    PotreeCinParser.parse :
                    PotreeBinParser.parse;
                this.scale = cloud.scale;

                this.zmin = cloud.tightBoundingBox.lz;
                this.zmax = cloud.tightBoundingBox.uz;

                this.spacing = cloud.spacing;
                this.hierarchyStepSize = cloud.hierarchyStepSize;

                return cloud;
            });
    }
}

export default PotreeSource;
