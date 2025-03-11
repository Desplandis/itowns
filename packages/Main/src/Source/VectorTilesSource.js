import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import TMSSource from 'Source/TMSSource';
import URLBuilder from 'Provider/URLBuilder';
import Fetcher from 'Provider/Fetcher';
import urlParser from 'Parser/MapBoxUrlParser';
import * as maplibre from '@maplibre/maplibre-gl-style-spec';

function readVectorProperty(property, options) {
    if (property != undefined) {
        if (maplibre.expression.isExpression(property)) {
            return maplibre.expression.createExpression(property, options).value;
        } else {
            return property;
        }
    }
}

const inv255 = 1 / 255;

function rgba2rgb(orig) {
    if (!orig) {
        return {};
    } else if (orig.stops || orig.expression) {
        return { color: orig };
    } else if (typeof orig == 'string') {
        const result = orig.match(/(?:((hsl|rgb)a? *\(([\d.%]+(?:deg|g?rad|turn)?)[ ,]*([\d.%]+)[ ,]*([\d.%]+)[ ,/]*([\d.%]*)\))|(#((?:[\d\w]{3}){1,2})([\d\w]{1,2})?))/i);
        if (result === null) {
            return { color: orig, opacity: 1.0 };
        } else if (result[7]) {
            let opacity = 1.0;
            if (result[9]) {
                opacity = parseInt(result[9].length == 1 ? `${result[9]}${result[9]}` : result[9], 16) * inv255;
            }
            return { color: `#${result[8]}`, opacity };
        } else if (result[1]) {
            return { color: `${result[2]}(${result[3]},${result[4]},${result[5]})`, opacity: (result[6] ? Number(result[6]) : 1.0) };
        }
    }
}

/**
 * generate a StyleOptions from vector tile layer properties.
 * @param {Object} layer vector tile layer.
 * @param {Object} sprites vector tile layer.
 * @param {Boolean} [symbolToCircle=false]
 *
 * @returns {StyleOptions} containing all properties for itowns.Style
 */
function setFromVectorTileLayer(layer, sprites, symbolToCircle = false) {
    const style = {
        fill: {},
        stroke: {},
        point: {},
        text: {},
        icon: {},
    };

    layer.layout = layer.layout || {};
    layer.paint = layer.paint || {};

    if (layer.type === 'fill') {
        const { color, opacity } = rgba2rgb(readVectorProperty(layer.paint['fill-color'] || layer.paint['fill-pattern'], { type: 'color' }));
        style.fill.color = color;
        style.fill.opacity = readVectorProperty(layer.paint['fill-opacity']) || opacity;
        if (layer.paint['fill-pattern']) {
            try {
                style.fill.pattern = {
                    id: layer.paint['fill-pattern'],
                    source: sprites.source,
                    cropValues: sprites[layer.paint['fill-pattern']],
                };
            } catch (err) {
                err.message = `VTlayer '${layer.id}': argument sprites must not be null when using layer.paint['fill-pattern']`;
                throw err;
            }
        }

        if (layer.paint['fill-outline-color']) {
            const { color, opacity } = rgba2rgb(readVectorProperty(layer.paint['fill-outline-color'], { type: 'color' }));
            style.stroke.color = color;
            style.stroke.opacity = opacity;
            style.stroke.width = 1.0;
        } else {
            style.stroke.width  = 0.0;
        }
    } else if (layer.type === 'line') {
        const prepare = readVectorProperty(layer.paint['line-color'], { type: 'color' });
        const { color, opacity } = rgba2rgb(prepare);
        style.stroke.dasharray = readVectorProperty(layer.paint['line-dasharray']);
        style.stroke.color = color;
        style.stroke.lineCap = layer.layout['line-cap'];
        style.stroke.width = readVectorProperty(layer.paint['line-width']);
        style.stroke.opacity = readVectorProperty(layer.paint['line-opacity']) || opacity;
    } else if (layer.type === 'circle' || symbolToCircle) {
        const { color, opacity } = rgba2rgb(readVectorProperty(layer.paint['circle-color'], { type: 'color' }));
        style.point.color = color;
        style.point.opacity = opacity;
        style.point.radius = readVectorProperty(layer.paint['circle-radius']);
    } else if (layer.type === 'symbol') {
        // if symbol we shouldn't draw stroke but defaut value is 1.
        style.stroke.width = 0.0;
        // overlapping order
        style.text.zOrder = readVectorProperty(layer.layout['symbol-z-order']);
        if (style.text.zOrder == 'auto') {
            style.text.zOrder = readVectorProperty(layer.layout['symbol-sort-key']) || 'Y';
        } else if (style.text.zOrder == 'viewport-y') {
            style.text.zOrder = 'Y';
        } else if (style.text.zOrder == 'source') {
            style.text.zOrder = 0;
        }

        // position
        style.text.anchor = readVectorProperty(layer.layout['text-anchor']);
        style.text.offset = readVectorProperty(layer.layout['text-offset']);
        style.text.padding = readVectorProperty(layer.layout['text-padding']);
        style.text.size = readVectorProperty(layer.layout['text-size']);
        style.text.placement = readVectorProperty(layer.layout['symbol-placement']);
        style.text.rotation = readVectorProperty(layer.layout['text-rotation-alignment']);

        // content
        style.text.field = readVectorProperty(layer.layout['text-field']);
        style.text.wrap = readVectorProperty(layer.layout['text-max-width']);// Units ems
        style.text.spacing = readVectorProperty(layer.layout['text-letter-spacing']);
        style.text.transform = readVectorProperty(layer.layout['text-transform']);
        style.text.justify = readVectorProperty(layer.layout['text-justify']);

        // appearance
        const { color, opacity } = rgba2rgb(readVectorProperty(layer.paint['text-color'], { type: 'color' }));
        style.text.color = color;
        style.text.opacity = readVectorProperty(layer.paint['text-opacity']) || (opacity !== undefined && opacity);

        style.text.font = readVectorProperty(layer.layout['text-font']);
        const haloColor = readVectorProperty(layer.paint['text-halo-color'], { type: 'color' });
        if (haloColor) {
            style.text.haloColor = haloColor.color || haloColor;
            style.text.haloWidth = readVectorProperty(layer.paint['text-halo-width']);
            style.text.haloBlur = readVectorProperty(layer.paint['text-halo-blur']);
        }

        // additional icon
        const iconImg = readVectorProperty(layer.layout['icon-image']);
        if (iconImg) {
            const cropValueDefault = {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            };
            try {
                style.icon.id = iconImg;
                if (iconImg.stops) {
                    const iconCropValue = {
                        ...(iconImg.base !== undefined && { base: iconImg.base }),
                        stops: iconImg.stops.map((stop) => {
                            let cropValues = sprites[stop[1]];
                            if (stop[1].includes('{')) {
                                cropValues = function _(p) {
                                    const id = stop[1].replace(/\{(.+?)\}/g, (a, b) => (p[b] || '')).trim();
                                    if (cropValues === undefined) {
                                        // const warning = `WARNING: "${id}" not found in sprite file`;
                                        sprites[id] = cropValueDefault;// or return cropValueDefault;
                                    }
                                    return sprites[id];
                                };
                            } else if (cropValues === undefined) {
                                // const warning = `WARNING: "${stop[1]}" not found in sprite file`;
                                cropValues = cropValueDefault;
                            }
                            return [stop[0], cropValues];
                        }),
                    };
                    style.icon.cropValues = iconCropValue;
                } else {
                    style.icon.cropValues = sprites[iconImg];
                    if (iconImg.includes('{')) {
                        style.icon.cropValues = function _(p) {
                            const id = iconImg.replace(/\{(.+?)\}/g, (a, b) => (p[b] || '')).trim();
                            if (sprites[id] === undefined) {
                                // const warning = `WARNING: "${id}" not found in sprite file`;
                                sprites[id] = cropValueDefault;// or return cropValueDefault;
                            }
                            return sprites[id];
                        };
                    } else if (sprites[iconImg] === undefined) {
                        // const warning = `WARNING: "${iconImg}" not found in sprite file`;
                        style.icon.cropValues = cropValueDefault;
                    }
                }
                style.icon.source = sprites.source;
                style.icon.size = readVectorProperty(layer.layout['icon-size']) ?? 1;
                const { color, opacity } = rgba2rgb(readVectorProperty(layer.paint['icon-color'], { type: 'color' }));
                // https://docs.mapbox.com/style-spec/reference/layers/#paint-symbol-icon-color
                if (iconImg.sdf) {
                    style.icon.color = color;
                }
                style.icon.opacity = readVectorProperty(layer.paint['icon-opacity']) ?? (opacity !== undefined && opacity);
            } catch (err) {
                err.message = `VTlayer '${layer.id}': argument sprites must not be null when using layer.layout['icon-image']`;
                throw err;
            }
        }
    }
    // VectorTileSet: by default minZoom = 0 and maxZoom = 24
    // https://docs.mapbox.com/style-spec/reference/layers/#maxzoom and #minzoom
    // Should be move to layer properties, when (if) one mapBox layer will be considered as several itowns layers.
    // issue https://github.com/iTowns/itowns/issues/2153 (last point)
    style.zoom = {
        min: layer.minzoom || 0,
        max: layer.maxzoom || 24,
    };
    return style;
}

function toTMSUrl(url) {
    return url.replace(/\{/g, '${');
}

function mergeCollections(collections) {
    const collection = collections[0];
    collections.forEach((col, index) => {
        if (index === 0) { return; }
        col.features.forEach((feature) => {
            collection.features.push(feature);
        });
    });
    return collection;
}

// A deprecated (but still in use) Mapbox spec allows using 'ref' as a propertie to reference an other layer
// instead of duplicating the following properties: 'type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'filter', 'layout'
function getPropertiesFromRefLayer(layers, layer) {
    const refProperties = ['type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'filter', 'layout'];
    const refLayer = layers.filter(l => l.id === layer.ref)[0];
    refProperties.forEach((prop) => {
        layer[prop] = refLayer[prop];
    });
}

/**
 * VectorTilesSource are object containing informations on how to fetch vector
 * tiles resources.
 *
 * @property {function} filter - function to filter vector tiles layers, the
 * parameter function is a layer.
 * @property {boolean} [symbolToCircle=false] - If true, all symbols from a tile
 * will be considered as circle, and render as circles.
 */
class VectorTilesSource extends TMSSource {
    /**
     * @param {Object} source - An object that can contain all properties of a
     * VectorTilesSource and {@link Source}.
     * @param {string|Object} source.style - The URL of the JSON style, of the
     * JSON style directly.
     * @param {string} [source.sprite] - The base URL to load informations about
     * the sprite of the style. If this is set, it overrides the `sprite` value
     * of the `source.style`. A style's sprite property supplies a URL template
     * for loading small images.
     * ```js
     * {
     *      sprite: 'http//:xxxxx/maps/sprites/'
     * }
     * ```
     * A valid sprite source must supply two types of files:
     * * An index file, which is a JSON document containing a description of each image contained in the sprite.
     * * Image files, which are PNG images containing the sprite data.
     *
     * For more specification : [the Mapbox sprite Specification](https://docs.mapbox.com/mapbox-gl-js/style-spec/sprite/)
     *
     * @param {string} [source.url] - The base URL to load the tiles. If no url
     * is specified, it reads it from the loaded style. Read [the Mapbox Style
     * Specification](https://docs.mapbox.com/mapbox-gl-js/style-spec/sources/)
     * for more informations.
     * @param {string} [source.accessToken] - Mapbox access token
     */
    constructor(source) {
        source.format = 'application/x-protobuf;type=mapbox-vector';
        source.crs = 'EPSG:3857';
        source.isInverted = true;
        source.url = source.url || '.';
        super(source);
        const ffilter = source.filter || (() => true);
        this.urls = [];
        this.layers = {};
        this.styles = {};
        let promise;
        this.isVectorTileSource = true;

        this.accessToken = source.accessToken;

        let mvtStyleUrl;
        if (source.style) {
            if (typeof source.style == 'string') {
                mvtStyleUrl = urlParser.normalizeStyleURL(source.style, this.accessToken);
                promise = Fetcher.json(mvtStyleUrl, this.networkOptions);
            } else {
                promise = Promise.resolve(source.style);
            }
        } else {
            throw new Error('New VectorTilesSource: style is required');
        }

        this.whenReady = promise.then((mvtStyle) => {
            this.jsonStyle = mvtStyle;
            let baseurl = source.sprite || mvtStyle.sprite;
            if (baseurl) {
                baseurl = new URL(baseurl, mvtStyleUrl).toString();
                const spriteUrl = urlParser.normalizeSpriteURL(baseurl, '', '.json', this.accessToken);
                return Fetcher.json(spriteUrl, this.networkOptions).then((sprites) => {
                    this.sprites = sprites;
                    const imgUrl = urlParser.normalizeSpriteURL(baseurl, '', '.png', this.accessToken);
                    this.sprites.source = imgUrl;
                    return mvtStyle;
                });
            }

            return mvtStyle;
        }).then((mvtStyle) => {
            mvtStyle.layers.forEach((layer, order) => {
                layer.sourceUid = this.uid;
                if (layer.type === 'background') {
                    this.backgroundLayer = layer;
                } else if (ffilter(layer)) {
                    if (layer['source-layer'] === undefined) {
                        getPropertiesFromRefLayer(mvtStyle.layers, layer);
                    }
                    const style = setFromVectorTileLayer(layer, this.sprites, this.symbolToCircle);
                    this.styles[layer.id] = style;

                    if (!this.layers[layer['source-layer']]) {
                        this.layers[layer['source-layer']] = [];
                    }
                    this.layers[layer['source-layer']].push({
                        id: layer.id,
                        order,
                        filterExpression: featureFilter(layer.filter),
                    });
                }
            });

            if (this.url == '.') {
                const TMSUrlList = Object.values(mvtStyle.sources).map((sourceVT) => {
                    if (sourceVT.url) {
                        sourceVT.url = new URL(sourceVT.url, mvtStyleUrl).toString();
                        const urlSource = urlParser.normalizeSourceURL(sourceVT.url, this.accessToken);
                        return Fetcher.json(urlSource, this.networkOptions).then((tileJSON) => {
                            if (tileJSON.tiles[0]) {
                                tileJSON.tiles[0] = decodeURIComponent(new URL(tileJSON.tiles[0], urlSource).toString());
                                return toTMSUrl(tileJSON.tiles[0]);
                            }
                        });
                    } else if (sourceVT.tiles) {
                        return Promise.resolve(toTMSUrl(sourceVT.tiles[0]));
                    }
                    return Promise.reject();
                });
                return Promise.all(TMSUrlList);
            }
            return (Promise.resolve([toTMSUrl(this.url)]));
        }).then((TMSUrlList) => {
            this.urls = Array.from(new Set(TMSUrlList));
        });
    }

    urlFromExtent(tile, url) {
        return URLBuilder.xyz(tile, { tileMatrixCallback: this.tileMatrixCallback, url });
    }

    onLayerAdded(options) {
        super.onLayerAdded(options);
        if (options.out.style) {
            if (options.out.isFeatureGeometryLayer && options.out.accurate) {
                console.warn('With VectorTilesSource and FeatureGeometryLayer, the accurate option is always false');
                options.out.accurate = false;
            }
        }
    }

    loadData(extent, out) {
        const cache = this._featuresCaches[out.crs];
        const key = this.getDataKey(extent);
        // try to get parsed data from cache
        let features = cache.get(key);
        if (!features) {
            // otherwise fetch/parse the data
            features = Promise.all(this.urls.map(url =>
                this.fetcher(this.urlFromExtent(extent, url), this.networkOptions)
                    .then(file => this.parser(file, { out, in: this, extent }))))
                .then(collections => mergeCollections(collections))
                .catch(err => this.handlingError(err));

            cache.set(key, features);
        }
        return features;
    }
}

export default VectorTilesSource;
