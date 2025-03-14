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
export function setFromVectorTileLayer(layer, sprites, symbolToCircle = false) {
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
                    console.log(style.icon.source);
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
