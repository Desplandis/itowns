// SPDX-License-Identifier: BSD-2-Clause AND MIT
/*
 * Copyright (c) 2011-2020, Markus Schütz
 * Copyright (c) 2023, Kévin Étourneau <kevin.etourneau@sogelink.com>
 * Copyright (c) 2023-2025, iTowns contributors
 *
 * This file incorporates code from Potree by Markus Schütz (BSD-2-Clause) and
 * includes modifications by iTowns contributors (MIT).
 * Full license texts are provided in the LICENSE.md file.
 */

import { computeChildBBox } from 'Core/PotreeNode';
import type Potree2Source from 'Source/Potree2Source';
import PointCloudNode from './PointCloudNode';

const NODE_TYPE = {
    NORMAL: 0,
    LEAF: 1,
    PROXY: 2,
} as const;

type NodeType = typeof NODE_TYPE[keyof typeof NODE_TYPE];

class Potree2Node extends PointCloudNode {
    source: Potree2Source;

    childrenBitField: number;
    hierarchyKey: string;
    baseurl: string;
    crs: string;

    loaded: boolean;
    loading: boolean;

    byteOffset!: bigint;
    byteSize!: bigint;
    hierarchyByteOffset!: bigint;
    hierarchyByteSize!: bigint;
    nodeType!: NodeType;

    constructor(numPoints = 0, childrenBitField = 0, source: Potree2Source, crs: string) {
        super(numPoints);
        this.source = source;

        this.depth = 0;

        this.hierarchyKey = 'r';

        this.childrenBitField = childrenBitField;

        this.baseurl = source.baseurl;

        this.crs = crs;

        this.loaded = false;
        this.loading = false;
    }

    get octreeIsLoaded() {
        return !(this.childrenBitField && this.children.length === 0);
    }

    get url() {
        return `${this.baseurl}/octree.bin`;
    }

    get id() {
        return this.hierarchyKey;
    }

    add(node: this, indexChild: number) {
        node.hierarchyKey = this.hierarchyKey + indexChild;
        node.depth = this.depth + 1;
        super.add(node, indexChild);
    }

    createChildAABB(childNode: Potree2Node, childIndex: number) {
        childNode.voxelOBB.copy(this.voxelOBB);
        childNode.voxelOBB.box3D = computeChildBBox(this.voxelOBB.box3D, childIndex);

        childNode.clampOBB.copy(childNode.voxelOBB);
        const childClampBBox = childNode.clampOBB.box3D;

        if (childClampBBox.min.z < this.source.zmax) {
            childClampBBox.max.z = Math.min(childClampBBox.max.z, this.source.zmax);
        }
        if (childClampBBox.max.z > this.source.zmin) {
            childClampBBox.min.z = Math.max(childClampBBox.min.z, this.source.zmin);
        }

        childNode.voxelOBB.matrixWorldInverse = this.voxelOBB.matrixWorldInverse;
        childNode.clampOBB.matrixWorldInverse = this.clampOBB.matrixWorldInverse;
    }

    networkOptions(byteOffset = this.byteOffset, byteSize = this.byteSize) {
        if (byteOffset === undefined || byteSize === undefined) {
            throw new Error('Potree2Node: network options called before hierarchy is loaded');
        }
        const first = byteOffset;
        const last = first + byteSize - 1n;

        // When we specify 'multipart/byteranges' on headers request it trigger
        // a preflight request.
        // Actually github doesn't support it, see:
        // https://github.com/orgs/community/discussions/24659
        // But if we omit header parameter, github seems to know it's a
        // 'multipart/byteranges' request (thanks to 'Range' parameter)
        const networkOptions = {
            ...this.source.networkOptions,
            headers: {
                ...this.source.networkOptions.headers,
                ...(this.url.startsWith('https://raw.githubusercontent.com') ? {} : { 'content-type': 'multipart/byteranges' }),
                Range: `bytes=${first}-${last}`,
            },
        };

        return networkOptions;
    }

    async load() {
        // Query octree/HRC if we don't have children yet.
        if (!this.octreeIsLoaded) {
            await this.loadOctree();
        }

        const networkOptions = this.networkOptions();
        const file = await this.source.fetcher(this.url, networkOptions);
        const data = await this.source.parser(file, { in: this });
        this.loaded = true;
        this.loading = false;
        return data.geometry;
    }

    loadOctree() {
        if (this.loaded || this.loading) {
            return Promise.resolve();
        }
        this.loading = true;
        return (this.nodeType === NODE_TYPE.PROXY) ? this.loadHierarchy() : Promise.resolve();
    }

    async loadHierarchy() {
        const hierarchyUrl = `${this.baseurl}/hierarchy.bin`;
        const buffer = await this.source.fetcher(
            hierarchyUrl,
            this.networkOptions(this.hierarchyByteOffset, this.hierarchyByteSize),
        );
        this.parseHierarchy(buffer);
    }

    parseHierarchy(buffer: ArrayBuffer) {
        const view = new DataView(buffer);

        const bytesPerNode = 22;
        const numNodes = buffer.byteLength / bytesPerNode;

        const stack = [];
        stack.push(this);

        for (let indexNode = 0; indexNode < numNodes; indexNode++) {
            const current = stack.shift()!;
            const offset = indexNode * bytesPerNode;

            const type = view.getUint8(offset + 0) as NodeType;
            const childMask = view.getUint8(offset + 1);
            const numPoints = view.getUint32(offset + 2, true);
            const byteOffset = view.getBigInt64(offset + 6, true);
            const byteSize = view.getBigInt64(offset + 14, true);

            if (current.nodeType === NODE_TYPE.PROXY) {
                // replace proxy with real node
                current.byteOffset = byteOffset;
                current.byteSize = byteSize;
                current.numPoints = numPoints;
            } else if (type === NODE_TYPE.PROXY) {
                // load proxy
                current.hierarchyByteOffset = byteOffset;
                current.hierarchyByteSize = byteSize;
                current.numPoints = numPoints;
            } else {
                // load real node
                current.byteOffset = byteOffset;
                current.byteSize = byteSize;
                current.numPoints = numPoints;
            }

            if (current.byteSize === 0n) {
                // workaround for issue potree/potree#1125
                // some inner nodes erroneously report >0 points even though
                // have 0 points
                // however, they still report a byteSize of 0, so based on that
                // we now set node.numPoints to 0
                current.numPoints = 0;
            }

            current.nodeType = type;

            if (current.nodeType === NODE_TYPE.PROXY) {
                continue;
            }

            for (let childIndex = 0; childIndex < 8; childIndex++) {
                const childExists = ((1 << childIndex) & childMask) !== 0;

                if (!childExists) {
                    continue;
                }

                const child = new Potree2Node(numPoints, childMask, this.source, this.crs);

                current.add(child, childIndex);
                stack.push(child);
            }
        }
    }
}

export default Potree2Node;
