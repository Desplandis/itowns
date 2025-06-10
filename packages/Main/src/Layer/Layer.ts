import * as THREE from 'three';
import InfoLayer from 'Layer/InfoLayer';
import Source from 'Source/Source';
import { LRUCache } from 'lru-cache';
import { ProjectionDefinition } from '@maplibre/maplibre-gl-style-spec';

export interface LayerConfig {
    source?: Source | boolean;
    name?: string;
    subdivisionThreshold?: number;
    cacheLifeTime?: number;
    options?: Record<string, any> | undefined;
    zoom?: { min: number; max: number };
    crs: ProjectionDefinition;
}

/**
 * @property {boolean} isLayer - Used to checkout whether this layer is a Layer.
 * Default is true. You should not change this, as it is used internally for
 * optimisation.
 * @property {boolean} ready - This property is false when the layer isn't added.
 * It's true when the layer is added and all initializations are done.
 * @property {Source} source - This source determines the datas to be displayed with the layer.
 * The layer determines how this data are displayed.
 * By example:
 * * For ColorLayer/ElevationLayer, the source datas are rasterised (if it's necessary).
 * * For GeometryLayer, the source datas are converted to meshes (not possible for the raster data sources).
 * @property {Promise} whenReady - this promise is resolved when the layer is added and all initializations are done.
 * This promise is resolved with this layer.
 * This promise is returned by [View#addLayer]{@link View}.
 * @property {object} [zoom] - This property is used only the layer is attached
 * to {@link TiledGeometryLayer}.
 * By example,
 * The layer checks the tile zoom level to determine if the layer is visible in this tile.
 *
 * ![tiled geometry](/docs/static/images/wfszoommaxmin.jpeg)
 * _In `GlobeView`, **red lines** represents the **WGS84 grid** and **orange lines** the Pseudo-mercator grid_
 * _In this example [WFS to 3D objects](http://www.itowns-project.org/itowns/examples/index.html#source_stream_wfs_3d), the building layer zoom min is 14._
 * _In the lower part of the picture, the zoom tiles 14 have buildings, while in the upper part of the picture, the level 13 tiles have no buildings._
 *
 * @property {number} [zoom.max=Infinity] - this is the maximum zoom beyond which it'll be hidden.
 * @property {number} [zoom.min=0] - this is the minimum zoom from which it'll be visible.
 *
 */
abstract class Layer<K, V extends {}, E extends {} = {}> extends THREE.EventDispatcher<E> {
    readonly isLayer: boolean;

    readonly id: string;
    crs: ProjectionDefinition;

    name: string | undefined;
    source: Source;
    subdivisionThreshold: number;
    sizeDiagonalTexture: number;
    options: unknown;

    frozen: boolean;
    zoom: { min: number; max: number };
    info: InfoLayer;
    ready: boolean;

    cache: LRUCache<string, V, unknown>;
    whenReady: Promise<this>;

    private _promises: Promise<any>[];
    private _resolve!: (value: this) => void;
    private _reject!: (reason?: any) => void;

    /**
     * Don't use directly constructor to instance a new Layer. Instead, use
     * another available type of Layer, implement a new one inheriting from this
     * one or use [View#addLayer]{@link View}.
     *
     * @protected
     *
     * @param {string} id - The id of the layer, that should be unique. It is
     * not mandatory, but an error will be emitted if this layer is added a
     * {@link View} that already has a layer going by that id.
     * @param {Object} config - configuration, all elements in it
     * will be merged as is in the layer. For example, if the configuration
     * contains three elements `name, extent`, these elements will be
     * available using `layer.name` or something else depending on the property
     * name.
     * @param {Source|boolean} config.source - instantiated Source specifies data source to display.
     * if config.source is a boolean, it can only be false. if config.source is false,
     * the layer doesn't need Source (like debug Layer or procedural layer).
     * @param {number} [config.cacheLifeTime=Infinity] - set life time value in cache.
     * This value is used for cache expiration mechanism.
     * @param {boolean} [config.addLabelLayer.performance=false] - In case label layer adding, so remove labels that have no chance of being visible.
     * Indeed, even in the best case, labels will never be displayed. By example, if there's many labels.
     * @param {boolean} [config.addLabelLayer.forceClampToTerrain=false] - use elevation layer to clamp label on terrain.
     * @param {number} [config.subdivisionThreshold=256] - set the texture size and, if applied to the globe, affects the tile subdivision.
     *
     * @example
     * // Add and create a new Layer
     * const newLayer = new Layer('id', options);
     * view.addLayer(newLayer);
     *
     * // Change layer's visibility
     * const layerToChange = view.getLayerById('idLayerToChange');
     * layerToChange.visible = false;
     * view.notifyChange(); // update viewer
     *
     * // Change layer's opacity
     * const layerToChange = view.getLayerById('idLayerToChange');
     * layerToChange.opacity = 0.5;
     * view.notifyChange(); // update viewer
     *
     * // Listen properties
     * const layerToListen = view.getLayerById('idLayerToListen');
     * layerToListen.addEventListener('visible-property-changed', (event) => console.log(event));
     * layerToListen.addEventListener('opacity-property-changed', (event) => console.log(event));
     */
    constructor(id: string, config: LayerConfig) {
        const {
            source,
            name,
            subdivisionThreshold = 256,
            cacheLifeTime,
            options = {},
            zoom,
            crs,
        } = config;

        super();

        this.isLayer = true;

        this.id = id;
        Object.defineProperty(this, 'id', {
            writable: false,
        });

        this.name = name;

        if (source === undefined || source === true) {
            throw new Error(`Layer ${id} needs Source`);
        }

        this.source = source || new Source({ url: 'none' });

        this.crs = crs;

        this.subdivisionThreshold = subdivisionThreshold;
        this.sizeDiagonalTexture =  (2 * (this.subdivisionThreshold * this.subdivisionThreshold)) ** 0.5;

        // Default properties
        this.options = options;

        this.frozen = false;
        this.defineLayerProperty('frozen', false);

        this.zoom = {
            min: zoom?.min ?? 0,
            max: zoom?.max ?? Infinity,
        };

        this.info = new InfoLayer(this);

        /**
         * @type {boolean}
         */
        this.ready = false;

        /**
         * @type {Array<Promise<any>>}
         * @protected
         */
        this._promises = [];

        /**
         * @type {Promise<this>}
         */
        this.whenReady = new Promise<this>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });

        this._promises.push(this.source.whenReady);

        /**
         * @type {Cache}
         */
        this.cache = new LRUCache({
            max: 500,
            ...(cacheLifeTime !== Infinity && { ttl: cacheLifeTime }),
        });
    }

    addInitializationStep() {
        // Possibility to add rejection handler, if it's necessary.
        let resolve;
        this._promises.push(new Promise((re) => { resolve = re; }));
        return resolve;
    }

    // TODO: Pass context to these functions
    async startup(): Promise<void> {
        try {
            await Promise.all(this._promises);
            this.ready = true;
            this.source.onLayerAdded({ out: this });
            this._resolve(this);
        } catch (error) {
            this._reject(error);
        }
    }

    abstract update(): Promise<void>;
    abstract preUpdate(): Promise<void>;
    abstract postUpdate(): Promise<void>;

    /**
     * Defines a property for this layer, with a default value and a callback
     * executed when the property changes.
     * <br><br>
     * When changing the property, it also emits an event, named following this
     * convention: `${propertyName}-property-changed`, with `${propertyName}`
     * being replaced by the name of the property.  For example, if the added
     * property name is `frozen`, it will emit a `frozen-property-changed`.
     * <br><br>
     * @example <caption>The emitted event has some properties assigned to it</caption>
     * event = {
     *     new: {
     *         ${propertyName}: * // the new value of the property
     *     },
     *     previous: {
     *         ${propertyName}: * // the previous value of the property
     *     },
     *     target: Layer // the layer it has been dispatched from
     *     type: string // the name of the emitted event
     * }
     *
     * @param {string} propertyName - The name of the property, also used in
     * the emitted event name.
     * @param {*} defaultValue - The default set value.
     * @param {function} [onChange] - The function executed when the property is
     * changed. Parameters are the layer the property is defined on, and the
     * name of the property.
     */
    defineLayerProperty<T extends keyof this>(propertyName: T, defaultValue: this[T], onChange?: (layer: this, propertyName: T) => void) {
        const existing = Object.getOwnPropertyDescriptor(this, propertyName);
        if (!existing || !existing.set) {
            let property = this[propertyName] == undefined ? defaultValue : this[propertyName];

            Object.defineProperty(
                this,
                propertyName,
                {
                    get: () => property,
                    set: (newValue) => {
                        if (property !== newValue) {
                            const event = {
                                type: `${String(propertyName)}-property-changed`,
                                previous: property,
                                new: newValue,
                            };
                            property = newValue;
                            if (onChange) {
                                onChange(this, propertyName);
                            }
                            this.dispatchEvent(event);
                        }
                    },
                });
        }
    }

    // Placeholder
    // eslint-disable-next-line
    convert(data) {
        return data;
    }

    getData(from: K, to: K): Promise<V> {
        const key = this.source.getDataKey(this.source.isVectorSource ? to : from);
        let data = this.cache.get(key);
        if (!data) {
            data = this.source.loadData(from, this)
                .then(feat => this.convert(feat, to), (err) => {
                    throw err;
                });
            this.cache.set(key, data);
        }
        return data;
    }

    /**
     * Remove and dispose all objects from layer.
     * @param {boolean} [clearCache=false] Whether to clear the layer cache or not
     */
    // eslint-disable-next-line
    delete(clearCache: boolean) {
        console.warn('Function delete doesn\'t exist for this layer');
    }
}

export default Layer;

export const ImageryLayers = {
    // move this to new index
    // After the modification :
    //      * the minimum sequence will always be 0
    //      * the maximum sequence will always be layers.lenght - 1
    // the ordering of all layers (Except that specified) doesn't change
    moveLayerToIndex: function moveLayerToIndex(layer, newIndex, imageryLayers) {
        newIndex = Math.min(newIndex, imageryLayers.length - 1);
        newIndex = Math.max(newIndex, 0);
        const oldIndex = layer.sequence;

        for (const imagery of imageryLayers) {
            if (imagery.id === layer.id) {
                // change index of specified layer
                imagery.sequence = newIndex;
            } else if (imagery.sequence > oldIndex && imagery.sequence <= newIndex) {
                // down all layers between the old index and new index (to compensate the deletion of the old index)
                imagery.sequence--;
            } else if (imagery.sequence >= newIndex && imagery.sequence < oldIndex) {
                // up all layers between the new index and old index (to compensate the insertion of the new index)
                imagery.sequence++;
            }
        }
    },

    moveLayerDown: function moveLayerDown(layer, imageryLayers) {
        if (layer.sequence > 0) {
            this.moveLayerToIndex(layer, layer.sequence - 1, imageryLayers);
        }
    },

    moveLayerUp: function moveLayerUp(layer, imageryLayers) {
        const m = imageryLayers.length - 1;
        if (layer.sequence < m) {
            this.moveLayerToIndex(layer, layer.sequence + 1, imageryLayers);
        }
    },

    getColorLayersIdOrderedBySequence: function getColorLayersIdOrderedBySequence(imageryLayers) {
        const copy = Array.from(imageryLayers);
        copy.sort((a, b) => a.sequence - b.sequence);
        return copy.map(l => l.id);
    },
};
