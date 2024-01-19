import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import { init3dTilesLayer, pre3dTilesUpdate, process3dTilesNode } from 'Process/3dTilesProcessing';
import C3DTileset from 'Core/3DTiles/C3DTileset';
import C3DTExtensions from 'Core/3DTiles/C3DTExtensions';
import PointsMaterial, { PNTS_MODE, PNTS_SHAPE, PNTS_SIZE_MODE } from 'Renderer/PointsMaterial';
// eslint-disable-next-line no-unused-vars
import Style from 'Core/Style';
import C3DTFeature from 'Core/3DTiles/C3DTFeature';
import { optimizeGeometryGroups } from 'Utils/ThreeUtils';
import { Tileset3D, Tile3D, TILE_TYPE, TILE_CONTENT_STATE } from '@loaders.gl/tiles';
import {
    CullingVolume,
    Plane,
    _PerspectiveFrustum as PerspectiveFrustum,
} from '@math.gl/culling';
import { DRACOLoader } from 'ThreeExtended/loaders/DRACOLoader';
import { GLTFLoader } from 'ThreeExtended/loaders/GLTFLoader';

/** @typedef {import('../Core/View').default} View */
/**
 * @typedef {Object} GLTF
 * @property {THREE.Group} scene
 */

/**
 * @typedef {Object} Context
 * @property {Object} camera
 * @property {THREE.PerspectiveCamera} camera.camera3D
 * @property {number} camera.width
 * @property {number} camera.height
 */

export const C3DTILES_LAYER_EVENTS = {
    /**
     * Fires when a tile content has been loaded
     * @event C3DTilesLayer#on-tile-content-loaded
     * @type {object}
     * @property {THREE.Object3D} tileContent - object3D of the tile
     */
    ON_TILE_CONTENT_LOADED: 'on-tile-content-loaded',
    /**
     * Fires when a tile is requested
     * @event C3DTilesLayer#on-tile-requested
     * @type {object}
     * @property {object} metadata - tile
     */
    ON_TILE_REQUESTED: 'on-tile-requested',
};

const gltfLoader = new GLTFLoader();
const matrixChangeUpVectorZtoY = (new THREE.Matrix4()).makeRotationX(Math.PI / 2);

export function enableDracoLoader(path, config) {
    if (!path) {
        throw new Error('Path to draco folder is mandatory');
    }
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(path);
    if (config) {
        dracoLoader.setDecoderConfig(config);
    }
    gltfLoader.setDRACOLoader(dracoLoader);
}

/**
 * @param {THREE.ShaderMaterial} material
 */
function disposeMaterial(material) {
    if (material?.uniforms?.map) {
        material?.uniforms?.map.value?.dispose();
    } else if (material.map) {
        material.map?.dispose();
    }
    material.dispose();
}

/**
 * @param {THREE.Object3D} node
 */
function disposeNode(node) {
    node.traverse((object) => {
        if (object.isMesh) {
            object.geometry.dispose();

            if (object.material.isMaterial) {
                disposeMaterial(object.material);
            } else {
                // an array of materials
                for (const material of object.material) {
                    disposeMaterial(material);
                }
            }
        }
    });
    for (let i = node.children.length - 1; i >= 0; i--) {
        const obj = node.children[i];
        node.remove(obj);
    }
}


/**
 * @param {THREE.Camera} camera
 * @returns {THREE.Frustum}
 */
function getCameraFrustrum(camera) {
    camera.updateMatrix(); // make sure camera's local matrix is updated
    camera.updateMatrixWorld(); // make sure camera's world matrix is updated
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
        new THREE.Matrix4()
            .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );

    return frustum;
}

/**
 * @param {Tile3D} tile
 */
async function loadMesh(tile) {
    return new Promise((resolve /* , reject */) => {
        const transform = new THREE.Matrix4().fromArray(tile.computedTransform);
        transform.multiply(matrixChangeUpVectorZtoY);

        const onLoad = (/** @type {GLTF} */ gltf) => {
            const tileContent = gltf.scene;
            tileContent.visible = true;
            tileContent.applyMatrix4(transform);
            resolve(gltf.scene);
        };

        gltfLoader.parse(
            tile.content.gltfArrayBuffer,
            tile.contentUrl ? tile.contentUrl.substr(0, tile.contentUrl.lastIndexOf('/') + 1) : '',
            onLoad,
        );
    });
}

/**
 * @param {Tile3D} tile
 */
async function loadPoints(tile) {
    // Attributes
    const {
        positions,
        colors,
        ...attrs
    } = tile.content.attributes;
    const geometry = new THREE.BufferGeometry();

    if (positions !== undefined) {
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    if (colors?.size === 3) {
        const rgb = colors.value;
        geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3, true));
    } else {
        // console.warn('Unsupported non-RGB color attribute');
    }

    const unsupportedAttrs = Object.keys(attrs);
    if (unsupportedAttrs.length > 0) {
        // console.warn('Unsupported attributes:', unsupportedAttrs.join(','));
    }

    // Transforms
    const transform = new THREE.Matrix4().fromArray(tile.computedTransform);

    // Mesh
    const material = new PointsMaterial({
        size: 1,
        mode: PNTS_MODE.COLOR,
        shape: PNTS_SHAPE.SQUARE,
        sizeMode: PNTS_SIZE_MODE.VALUE,
        minAttenuatedSize: 0,
        maxAttenuatedSize: 10,
    });
    const points = new THREE.Points(geometry, material);
    points.applyMatrix4(transform);
    // console.log(transform);

    // TODO[QB]: RTC_CENTER

    return points;
}

/**
 * Find tileId of object
 *
 * @param {THREE.Object3D} object - object
 * @returns {number} tileId
 */
function findTileID(object) {
    let currentObject = object;
    let result = currentObject.tileId;
    while (isNaN(result) && currentObject.parent) {
        currentObject = currentObject.parent;
        result = currentObject.tileId;
    }

    return result;
}

/**
 * Check if object3d has feature
 *
 * @param {THREE.Object3D} object3d - object3d to check
 * @returns {boolean} - true if object3d has feature
 */
function object3DHasFeature(object3d) {
    return object3d.geometry && object3d.geometry.attributes._BATCHID;
}

class C3DTilesLayer extends GeometryLayer {
    #fillColorMaterialsBuffer;
    /**
     * Constructs a new instance of 3d tiles layer.
     * @constructor
     *
     * @example
     * // Create a new 3d-tiles layer from a web server
     * const l3dt = new C3DTilesLayer('3dtiles', {
     *      name: '3dtl',
     *      source: new C3DTilesSource({
     *           url: 'https://tileset.json'
     *      })
     * }, view);
     * View.prototype.addLayer.call(view, l3dt);
     *
     * // Create a new 3d-tiles layer from a Cesium ion server
     * const l3dt = new C3DTilesLayer('3dtiles', {
     *      name: '3dtl',
     *      source: new C3DTilesIonSource({
     *              accessToken: 'myAccessToken',
                    assetId: 12
     *      })
     * }, view);
     * View.prototype.addLayer.call(view, l3dt);
     *
     * @param      {string}  id - The id of the layer, that should be unique.
     *     It is not mandatory, but an error will be emitted if this layer is
     *     added a
     * {@link View} that already has a layer going by that id.
     * @param      {object}  config   configuration, all elements in it
     * will be merged as is in the layer.
     * @param {C3DTilesSource} config.source The source of 3d Tiles.
     *
     * name.
     * @param {Number} [config.sseThreshold=16] The [Screen Space Error](https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.md#geometric-error)
     * threshold at which child nodes of the current node will be loaded and added to the scene.
     * @param {Number} [config.cleanupDelay=1000] The time (in ms) after which a tile content (and its children) are
     * removed from the scene.
     * @param {C3DTExtensions} [config.registeredExtensions] 3D Tiles extensions managers registered for this tileset.
     * @param {String} [config.pntsMode= PNTS_MODE.COLOR] {@link PointsMaterials} Point cloud coloring mode. Only 'COLOR' or 'CLASSIFICATION' are possible. COLOR uses RGB colors of the points, CLASSIFICATION uses a classification property of the batch table to color points.
     * @param {String} [config.pntsShape= PNTS_SHAPE.CIRCLE] Point cloud point shape. Only 'CIRCLE' or 'SQUARE' are possible.
     * @param {String} [config.pntsSizeMode= PNTS_SIZE_MODE.VALUE] {@link PointsMaterials} Point cloud size mode. Only 'VALUE' or 'ATTENUATED' are possible. VALUE use constant size, ATTENUATED compute size depending on distance from point to camera.
     * @param {Number} [config.pntsMinAttenuatedSize=3] Minimum scale used by 'ATTENUATED' size mode
     * @param {Number} [config.pntsMaxAttenuatedSize=10] Maximum scale used by 'ATTENUATED' size mode
     * @param {Style} [config.style=null] - style used for this layer
     * @param  {View}  view  The view
     */
    constructor(id, config, view) {
        super(id, new THREE.Group(), { source: config.source });
        this.isC3DTilesLayer = true;
        this.sseThreshold = config.sseThreshold || 16;
        this.cleanupDelay = config.cleanupDelay || 1000;
        this.protocol = '3d-tiles';
        this.name = config.name;
        this.registeredExtensions = config.registeredExtensions || new C3DTExtensions();

        this.pntsMode = PNTS_MODE.COLOR;
        this.pntsShape = PNTS_SHAPE.CIRCLE;
        this.classification = config.classification;
        this.pntsSizeMode = PNTS_SIZE_MODE.VALUE;
        this.pntsMinAttenuatedSize = config.pntsMinAttenuatedSize || 3;
        this.pntsMaxAttenuatedSize = config.pntsMaxAttenuatedSize || 10;

        if (config.pntsMode) {
            const exists = Object.values(PNTS_MODE).includes(config.pntsMode);
            if (!exists) {
                console.warn("The points cloud mode doesn't exist. Use 'COLOR' or 'CLASSIFICATION' instead.");
            } else {
                this.pntsMode = config.pntsMode;
            }
        }

        if (config.pntsShape) {
            const exists = Object.values(PNTS_SHAPE).includes(config.pntsShape);
            if (!exists) {
                console.warn("The points cloud point shape doesn't exist. Use 'CIRCLE' or 'SQUARE' instead.");
            } else {
                this.pntsShape = config.pntsShape;
            }
        }

        if (config.pntsSizeMode) {
            const exists = Object.values(PNTS_SIZE_MODE).includes(config.pntsSizeMode);
            if (!exists) { console.warn("The points cloud size mode doesn't exist. Use 'VALUE' or 'ATTENUATED' instead."); } else { this.pntsSizeMode = config.pntsSizeMode; }
        }

        /** @type {Style} */
        this._style = config.style || null;

        /** @type {Map<string, THREE.MeshStandardMaterial>} */
        this.#fillColorMaterialsBuffer = new Map();

        /**
         * Map all C3DTFeature of the layer according their tileId and their batchId
         * Map< tileId, Map< batchId, C3DTFeature>>
         *
         * @type {Map<number, Map<number,C3DTFeature>>}
         */
        this.tilesC3DTileFeatures = new Map();

        if (config.onTileContentLoaded) {
            console.warn('DEPRECATED onTileContentLoaded should not be passed at the contruction, use C3DTILES_LAYER_EVENTS.ON_TILE_CONTENT_LOADED event instead');
            this.addEventListener(C3DTILES_LAYER_EVENTS.ON_TILE_CONTENT_LOADED, config.onTileContentLoaded);
        }

        if (config.overrideMaterials) {
            console.warn('overrideMaterials is deprecated, use style API instead');
            this.overrideMaterials = config.overrideMaterials;
        }

        this._cleanableTiles = [];

        const resolve = this.addInitializationStep();

        /** @type {Map<Tile3D, THREE.Group>} */
        this.renderMap = new Map();
        /** @type {Tile3D[]} */
        this.garbage = [];

        const tileOptions = {
            contentLoader: async (/** @type {Tile3D} */ tile) => {
                let object3d = null;
                switch (tile.type) {
                    case TILE_TYPE.POINTCLOUD: {
                        // console.log(`Loading Points ${tile.id}...`);
                        object3d = await loadPoints(tile);
                        this.renderMap.set(tile, object3d);
                        break;
                    }
                    case TILE_TYPE.SCENEGRAPH:
                    case TILE_TYPE.MESH: {
                        // console.log(`Loading Mesh ${tile.id}`);
                        object3d = await loadMesh(tile);
                        this.renderMap.set(tile, object3d);
                        break;
                    }
                    default:
                        break;
                }
            },
            onTileLoad: async (/** @type {Tile3D} */ tile) => {
                // console.log('loaded tile');
                view.notifyChange(this);
            },
            onTileUnload: async (/** @type {Tile3D} */ tile) => {
                // this.garbage.push(tile);
                // console.log('unloaded tile');
            },
            onTileError: async (/** @type {Tile3D} */ tile) => {
                // console.log('error tile');
            },
        };


        this.whenReady = this.source.whenReady.then((tilesetJson) => {
            const tileset = new Tileset3D(tilesetJson, {
                ...tileOptions,
                loadOptions: {
                    fetch: {
                        headers: {
                            // TODO: Special headers
                        },
                    },
                    worker: true,
                    gltf: {
                        loadImages: false,
                    },
                    '3d-tiles': {
                        loadGLTF: false,
                    },
                },
            });


            tileset._frameNumber = 1; // TODO


            this.tileset = tileset;

            // init3dTilesLayer(view, view.mainLoop.scheduler, this, this.tileset.root).then(resolve);
            return resolve(this);
        });
    }

    /**
     * @param {Context} context
     * @returns {Tile3D[]}
     */
    preUpdate(context) {
        this.tileset._frameNumber++;
        const viewportId = 0;
        this.tileset.update();
        // if (!this.tileset.roots[viewportId]) {
        //     this.tileset.roots[viewportId] =
        //         this.tileset._initializeTileHeaders(this.tileset.tileset, null);
        // }
        // console.log(this.tileset.isLoaded());

        const camera = context.camera.camera3D;
        const { width, height } = context.camera;

        // Compute preSSE
        // TODO: test if same compute than camera._preSSE
        // TODO: Private field, so kinda ugly
        const loadersFrustrum = new PerspectiveFrustum({
            fov: (camera.fov / 180) * Math.PI,
            aspectRatio: width / height,
            near: camera.near,
            far: camera.far,
        });
        const sseDenominator = loadersFrustrum.sseDenominator;
        // console.log('sseDenominator',
        //     sseDenominator,
        //     context.camera._preSSE,
        // );

        // Culling volume (from three to loaders.gl)
        const frustrum = getCameraFrustrum(camera);
        const planes = frustrum.planes
            .map(plane => new Plane(plane.normal.toArray(), plane.constant));
        const cullingVolume = new CullingVolume(planes);

        // console.log('cullingValue: ', cullingVolume.computeVisibilityWithPlaneMask(
        //     this.tileset.root.boundingVolume,
        //     CullingVolume.MASK_INDETERMINATE,
        // ), 'MASKS U, I, O',
        // CullingVolume.MASK_INDETERMINATE,
        // CullingVolume.MASK_INSIDE,
        // CullingVolume.MASK_OUTSIDE);

        // Set loaders.gl frame state (TODO: Only mandatory fields for now)
        const position = new THREE.Vector3(); // TODO: Move to toplevel
        this.frameState = {
            camera: {
                position: camera.getWorldPosition(position).toArray(),
                // direction: camera.getWorldDirection(position).toArray(),
                up: undefined,
            },
            viewport: { // TODO: Mandatory, why?
                id: viewportId,
            },
            // topDownViewport: undefined,
            height,
            cullingVolume,
            frameNumber: this.tileset._frameNumber, // TODO: Mandatory, increment?
            sseDenominator, // TODO: Hard-coded
        };

        // console.log('FrameNumber:', this.frameState.frameNumber);

        // console.log(this.tileset.root?.children);

        return this.tileset.root ? [this.tileset.root] : [];
    }

    /**
     * @param {Context} context
     * @param {this} layer
     * @param {Tile3D} tile
     * @returns {Tile3D[]}
     */
    update(context, layer, tile) {
        // this.tileset._traverser.updateTile(node, this.frameState);
        // this.tileset._cache.reset();

        // this.tileset;

        const tileset = this.tileset;
        tileset._cache.reset();
        tileset._traverser.traverse(tile, this.frameState, {});

        return [];
    }

    postUpdate() {
        this.object3d.clear();
        for (const tile of this.tileset.tiles) {
            const obj = this.renderMap.get(tile);
            if (obj === undefined) {
                continue;
            }

            if (tile.selected) {
                obj.updateMatrixWorld();
                this.object3d.add(obj);
            }
        }

        while (this.garbage.length > 0) {
            /** @type {Tile3D} */
            const tile = this.garbage.pop();
            const obj = this.renderMap.get(tile);
            if (obj && tile.contentState === TILE_CONTENT_STATE.UNLOADED) {
                disposeNode(obj);
                this.renderMap.delete(tile);
            }
        }
    }


    getObjectToUpdateForAttachedLayers(meta) {
        // if (meta.content) {
        //     const result = [];
        //     meta.content.traverse((obj) => {
        //         if (obj.isObject3D && obj.material && obj.layer == meta.layer) {
        //             result.push(obj);
        //         }
        //     });
        //     const p = meta.parent;
        //     if (p && p.content) {
        //         return {
        //             elements: result,
        //             parent: p.content,
        //         };
        //     } else {
        //         return {
        //             elements: result,
        //         };
        //     }
        // }
    }

    /**
     * Finds the batch table of an object in a 3D Tiles layer. This is
     * for instance needed when picking because we pick the geometric
     * object which is not at the same level in the layer structure as
     * the batch table. More details here on itowns internal
     * organization of 3DTiles:
     *  https://github.com/MEPP-team/RICT/blob/master/Doc/iTowns/Doc.md#itowns-internal-organisation-of-3d-tiles-data
     * @param {THREE.Object3D} object - a 3D geometric object
     * @returns {C3DTBatchTable} - the batch table of the object
     */
    findBatchTable(object) {
        if (object.batchTable) {
            return object.batchTable;
        }
        if (object.parent) {
            return this.findBatchTable(object.parent);
        }
    }

    /**
     * Get the closest c3DTileFeature of an intersects array.
     * @param {Array} intersects - @return An array containing all
     * targets picked under specified coordinates. Intersects can be
     * computed with view.pickObjectsAt(..). See fillHTMLWithPickingInfo()
     * in 3dTilesHelper.js for an example.
     * @returns {C3DTileFeature} - the closest C3DTileFeature of the intersects array
     */
    getC3DTileFeatureFromIntersectsArray(intersects) {
        // find closest intersect with an attributes _BATCHID + face != undefined
        let closestIntersect = null;
        for (let index = 0; index < intersects.length; index++) {
            const i = intersects[index];
            if (i.object.geometry &&
                i.object.geometry.attributes._BATCHID &&
                i.face && // need face to get batch id
                i.layer == this // just to be sure that the right layer intersected
            ) {
                closestIntersect = i;
                break;
            }
        }

        if (!closestIntersect) {
            return null;
        }

        const tileId = findTileID(closestIntersect.object);
        // face is a Face3 object of THREE which is a
        // triangular face. face.a is its first vertex
        const vertex = closestIntersect.face.a;
        const batchID = closestIntersect.object.geometry.attributes._BATCHID.array[vertex];

        return this.tilesC3DTileFeatures.get(tileId).get(batchID);
    }

    /**
     * Call by {@link 3dTilesProcessing} which handle load and unload of 3DTiles
     * @param {THREE.Object3D} tileContent - tile as THREE.Object3D
     */
    onTileContentLoaded(tileContent) {
        this.initC3DTileFeatures(tileContent);

        // notify observer
        this.dispatchEvent({ type: C3DTILES_LAYER_EVENTS.ON_TILE_CONTENT_LOADED, tileContent });

        // only update style of tile features
        this.updateStyle([tileContent.tileId]);
    }

    /**
     * Initialize C3DTileFeatures from tileContent
     *
     * @param {THREE.Object3D} tileContent - tile as THREE.Object3D
     */
    initC3DTileFeatures(tileContent) {
        this.tilesC3DTileFeatures.set(tileContent.tileId, new Map()); // initialize
        tileContent.traverse((child) => {
            if (object3DHasFeature(child)) {
                const batchTable = this.findBatchTable(child);
                if (!batchTable) {
                    throw new Error('no batchTable');
                }

                const geometryAttributes = child.geometry.attributes;
                let currentBatchId = geometryAttributes._BATCHID.array[0];
                let start = 0;
                let count = 0;

                const registerBatchIdGroup = () => {
                    if (this.tilesC3DTileFeatures.get(tileContent.tileId).has(currentBatchId)) {
                        // already created
                        const c3DTileFeature = this.tilesC3DTileFeatures.get(tileContent.tileId).get(currentBatchId);
                        // add new group
                        c3DTileFeature.groups.push({
                            start,
                            count,
                        });
                    } else {
                        // first occurence
                        const c3DTileFeature = new C3DTFeature(
                            tileContent.tileId,
                            currentBatchId,
                            [{ start, count }], // initialize with current group
                            batchTable.getInfoById(currentBatchId),
                            {},
                            child,
                        );
                        this.tilesC3DTileFeatures.get(tileContent.tileId).set(currentBatchId, c3DTileFeature);
                    }
                };

                for (let index = 0; index < geometryAttributes.position.array.length; index += geometryAttributes.position.itemSize) {
                    const batchIndex = index / geometryAttributes.position.itemSize;
                    const batchId = geometryAttributes._BATCHID.array[batchIndex];

                    // check if batchId is currentBatchId
                    if (currentBatchId !== batchId) {
                        registerBatchIdGroup();

                        // reset
                        currentBatchId = batchId;
                        start = batchIndex;
                        count = 0;
                    }

                    // record this position in current C3DTileFeature
                    count++;

                    // check if end of the array
                    if (index + geometryAttributes.position.itemSize >= geometryAttributes.position.array.length) {
                        registerBatchIdGroup();
                    }
                }
            }
        });
    }

    /**
     * Update style of the C3DTFeatures, an allowList of tile id can be passed to only update certain tile.
     * Note that this function only update THREE.Object3D materials, in order to see style changes you should call view.notifyChange()
     *
     * @param {Array<number>|null} [allowTileIdList] - tile ids to allow in updateStyle computation if null all tiles are updated
     * @returns {boolean} true if style updated false otherwise
     */
    updateStyle(allowTileIdList = null) {
        if (!this._style) {
            return false;
        }
        if (!this.object3d) {
            return false;
        }

        const currentMaterials = [];// list materials used for this update

        const mapObjects3d = new Map();
        this.object3d.traverse((child) => {
            if (object3DHasFeature(child)) {
                const tileId = findTileID(child);

                if (allowTileIdList && !allowTileIdList.includes(tileId)) {
                    return; // this tileId is not updated
                }

                // push for update style
                if (!mapObjects3d.has(tileId)) {
                    mapObjects3d.set(tileId, []);
                }
                mapObjects3d.get(tileId).push(child);
            }
        });

        for (const [tileId, objects3d] of mapObjects3d) {
            const c3DTileFeatures = this.tilesC3DTileFeatures.get(tileId); // features of this tile
            objects3d.forEach((object3d) => {
                // clear
                object3d.geometry.clearGroups();
                object3d.material = [];

                for (const [, c3DTileFeature] of c3DTileFeatures) {
                    if (c3DTileFeature.object3d != object3d) {
                        continue;// this feature do not belong to object3d
                    }
                    /** @type {THREE.Color} */
                    let color = null;
                    if (typeof this._style.fill.color === 'function') {
                        color = new THREE.Color(this._style.fill.color(c3DTileFeature));
                    } else {
                        color = new THREE.Color(this._style.fill.color);
                    }

                    /** @type {number} */
                    let opacity = null;
                    if (typeof this._style.fill.opacity === 'function') {
                        opacity = this._style.fill.opacity(c3DTileFeature);
                    } else {
                        opacity = this._style.fill.opacity;
                    }

                    const materialId = color.getHexString() + opacity;

                    let material = null;
                    if (this.#fillColorMaterialsBuffer.has(materialId)) {
                        material = this.#fillColorMaterialsBuffer.get(materialId);
                    } else {
                        material = new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, alphaTest: 0.09 });
                        this.#fillColorMaterialsBuffer.set(materialId, material);// bufferize
                    }

                    // compute materialIndex
                    let materialIndex = -1;
                    for (let index = 0; index < object3d.material.length; index++) {
                        const childMaterial = object3d.material[index];
                        if (material.uuid === childMaterial.uuid) {
                            materialIndex = index;
                            break;
                        }
                    }
                    if (materialIndex < 0) {
                        // not in object3d.material add it
                        object3d.material.push(material);
                        materialIndex = object3d.material.length - 1;
                    }

                    // materialIndex groups is computed
                    c3DTileFeature.groups.forEach((group) => {
                        object3d.geometry.addGroup(group.start, group.count, materialIndex);
                    });
                }

                optimizeGeometryGroups(object3d);

                // record material(s) used in object3d
                if (object3d.material instanceof Array) {
                    object3d.material.forEach((material) => {
                        if (!currentMaterials.includes(material)) {
                            currentMaterials.push(material);
                        }
                    });
                } else if (!currentMaterials.includes(object3d.material)) {
                    currentMaterials.push(object3d.material);
                }
            });
        }

        // remove buffered materials not in currentMaterials
        for (const [id, fillMaterial] of this.#fillColorMaterialsBuffer) {
            if (!currentMaterials.includes(fillMaterial)) {
                fillMaterial.dispose();
                this.#fillColorMaterialsBuffer.delete(id);
            }
        }

        return true;
    }

    get materialCount() {
        return this.#fillColorMaterialsBuffer.size;
    }

    set style(value) {
        this._style = value;
        this.updateStyle();
    }

    get style() {
        return this._style;
    }
}

export default C3DTilesLayer;
