import * as THREE from 'three';

import type PointCloudLayer from 'Layer/PointCloudLayer';

abstract class PointCloudNode extends THREE.EventDispatcher {
    numPoints: number;
    layer: PointCloudLayer;
    children: this[];
    bbox: THREE.Box3;
    tightbbox: THREE.Box3 | undefined;
    sse: number;

    // semi-private
    visible: boolean;
    notVisibleSince: number | undefined;
    obj: THREE.Object3D | undefined;
    promise: Promise<THREE.Object3D> | null;
    depth: number;
    parent: this | null;

    constructor(numPoints = 0, layer: PointCloudLayer) {
        super();

        this.numPoints = numPoints;
        this.layer = layer;

        this.children = [];
        this.bbox = new THREE.Box3();
        this.tightbbox = undefined;
        this.sse = -1;
        this.depth = -1;

        this.visible = false;
        this.obj = undefined;
        this.promise = null;
        this.parent = null;
    }

    add(node: this, indexChild: number) {
        this.children.push(node);
        node.parent = this;
        this.createChildAABB(node, indexChild);
    }

    load() {
        // Query octree/HRC if we don't have children potreeNode yet.
        if (!this.octreeIsLoaded) {
            this.loadOctree();
        }

        return this.layer.source.fetcher(this.url, this.layer.source.networkOptions)
            .then(file => this.layer.source.parse(file, { out: this.layer, in: this.layer.source }));
    }

    abstract loadOctree(): Promise<void>;
    abstract createChildAABB(node: this, indexChild: number): void;

    findCommonAncestor(node) {
        if (node.depth == this.depth) {
            if (node.id == this.id) {
                return node;
            } else if (node.depth != 0) {
                return this.parent.findCommonAncestor(node.parent);
            }
        } else if (node.depth < this.depth) {
            return this.parent.findCommonAncestor(node);
        } else {
            return this.findCommonAncestor(node.parent);
        }
    }
}

export default PointCloudNode;
