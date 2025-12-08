import { Binary, Info, Las } from 'copc';
import { CRS } from '@itowns/geographic';
import Fetcher from 'Provider/Fetcher';
import LASParser from 'Parser/LASParser';
import Source from 'Source/Source';

interface COPCSourceParameters {
    url: string;
    crs: string;
    colorDepth?: 8 | 16;
    networkOptions?: RequestInit;
}

async function getHeaders(fetcher: (begin: number, end: number) => Promise<Uint8Array>) {
    const header =
        Las.Header.parse(await fetcher(0, Las.Constants.minHeaderLength));
    const vlrs = await Las.Vlr.walk(fetcher, header);

    // info VLR: required by COPC
    const infoVlr = Las.Vlr.find(vlrs, 'copc', 1);
    if (!infoVlr) { return Promise.reject('COPC info VLR is required'); }
    const info = Info.parse(await Las.Vlr.fetch(fetcher, infoVlr));

    // OGC Coordinate System WKT: required by LAS1.4
    const wktVlr = Las.Vlr.find(vlrs, 'LASF_Projection', 2112);
    if (!wktVlr) { return Promise.reject('LAS1.4 WKT VLR is required'); }
    const wkt = Binary.toCString(await Las.Vlr.fetch(fetcher, wktVlr));

    // Extra bytes: optional by LAS1.4
    const ebVlr = Las.Vlr.find(vlrs, 'LASF_Spec', 4);
    const eb = ebVlr ?
        Las.ExtraBytes.parse(await Las.Vlr.fetch(fetcher, ebVlr)) :
        [];

    return { header, info, wkt, eb };
}

/**
 * A source for [Cloud Optimised Point Cloud](https://copc.io/) (COPC) data.
 * Such data consists of a [LAZ 1.4](https://www.ogc.org/standard/las/) file
 * that stores compressed points data organized in a clustered octree.
 *
 * A freshly created source fetches and parses portions of the file
 * corresponding to the LAS 1.4 header, all the Variable Length Record (VLR)
 * headers as well the following VLRs:
 * - COPC [`info`](https://copc.io/#info-vlr) record (mandatory)
 * - LAS 1.4 `OGC Coordinate System WKT` record (mandatory, see [Las 1.4
 *   spec](https://portal.ogc.org/files/?artifact_id=74523))
 * - LAS 1.4 `Extra Bytes` record (optional, see [Las 1.4
 *   spec](https://portal.ogc.org/files/?artifact_id=74523))
 */
class CopcSource extends Source {
    /** Read-only flag to check that a given object is of type CopcSource. */
    readonly isCopcSource: true;

    colorDepth: 8 | 16;

    /** LAS header of the source. */
    header!: Las.Header;
    /**
     * COPC `info` VLR.
     *
     * - `info.cube` - Bounding box of the octree as a 6-elements tuple
     *   `[minX, minY, minZ, maxX, maxY, maxZ]`. Computed from `center_x`,
     *   `center_y`, `center_z` and `halfSize` properties.
     * - `info.rootHierarchyPage` - Hierarchy page of the root node.
     * - `info.rootHierarchyPage.pageOffset` - Absolute Offset to the root node
     *   data chunk.
     * - `info.rootHierarchyPage.pageLength` - Size (in bytes) of the root node
     *   data chunk.
     */
    info!: Info;
    /** List of headers of each Variable Length Records (VLRs). */
    eb!: Las.ExtraBytes[];
    spacing!: number;
    zmin!: number;
    zmax!: number;

    fetcher: (url: string, options?: RequestInit) => Promise<ArrayBuffer>;
    parser: typeof LASParser.parseChunk;

    /**
     * @param config - Source configuration with the following properties:
     * `url` (URL of the COPC resource), `colorDepth` (encoding of the `color`
     * attribute, either 8 or 16 bits, defaults to 16), `crs` (native CRS of
     * the COPC resource), and `networkOptions` (fetch options passed directly
     * to `fetch()`).
     */
    constructor(config: COPCSourceParameters) {
        super(config);

        this.isCopcSource = true;

        this.parser = LASParser.parseChunk;
        this.fetcher = Fetcher.arrayBuffer;

        this.colorDepth = config.colorDepth ?? 16;

        const get = (begin: number, end: number) =>
            this.fetcher(this.url, {
                ...this.networkOptions,
                headers: {
                    ...this.networkOptions.headers,
                    range: `bytes=${begin}-${end - 1}`,
                },
            }).then(buffer => new Uint8Array(buffer));

        this.whenReady = getHeaders(get).then((metadata) => {
            this.header = metadata.header;
            this.info = metadata.info;
            this.eb = metadata.eb;

            this.zmin = this.header.min[2];
            this.zmax = this.header.max[2];

            this.spacing = this.info.spacing;

            this.crs = CRS.defsFromWkt(metadata.wkt);

            return this;
        });
    }
}

export default CopcSource;
