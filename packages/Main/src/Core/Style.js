import { Coordinates } from '@itowns/geographic';
import itowns_stroke_single_before from './StyleChunk/itowns_stroke_single_before.css';

function baseAltitudeDefault(properties, ctx) {
    return ctx?.coordinates?.z || 0;
}

export function readExpression(property, ctx) {
    if (property.expression) {
        return property.expression.evaluate(ctx);
    }
    if (property.stops) {
        const stops = property.stops;
        property = property.stops[0][1];
        for (let i = stops.length - 1; i >= 0; i--) {
            const stop = stops[i];

            if (ctx.zoom >= stop[0]) {
                property = stop[1];
                break;
            }
        }
    }
    if (typeof property === 'string' || property instanceof String) {
        return property.replace(/\{(.+?)\}/g, (a, b) => (ctx.properties[b] || '')).trim();
    }
    if (property instanceof Function) {
        // TOBREAK: Pass the current `context` as a unique parameter.
        // In this proposal, metadata will be accessed in the callee by the
        // `context.properties` property.
        return property(ctx.properties, ctx);
    }
    return property;
}

/**
 * Defines a property for the given Style for a specific parameter in a given category (one of fill, stroke, point, text, icon or zoom),
 * by generating its getter and setter.
 * The getter is in charge of returning the right style value from the following ones if they are defined (in that specific order):
 * the value set by the user (`userValue`)
 * the value read from the data source (`dataValue`)
 * the default fallback value (`defaultValue`).
 * The setter can be called to change dynamically the value.
 * @param {Style} style - The Style instance to set.
 * @param {string} category - The category (fill, stroke, point, test, icon or zoom) to set.
 * @param {string} parameter - The parameter of the category to set.
 * @param {All} userValue - The value given by the user (if any). Can be undefined.
 * @param {All} [defaultValue] - The default value to return (if needed).
 */
function defineStyleProperty(style, category, parameter, userValue, defaultValue) {
    let property;
    Object.defineProperty(
        style[category],
        parameter,
        {
            enumerable: true,
            get: () => {
                // != to check for 'undefined' and 'null' value)
                if (property != undefined) { return property; }
                if (userValue != undefined) { return readExpression(userValue, style.context); }
                const dataValue = style.context.featureStyle?.[category]?.[parameter];
                if (dataValue != undefined) { return readExpression(dataValue, style.context); }
                if (defaultValue instanceof Function) {
                    return defaultValue(style.context.properties, style.context) ?? defaultValue;
                }
                return defaultValue;
            },
            set: (v) => {
                property = v;
            },
        });
}

/**
 * StyleContext stores metadata of one FeatureGeometry that are needed for its style computation:
 * type of feature and what is needed (fill, stroke or draw a point, etc.) as well as where to get its
 * properties and its coordinates (for base_altitude).
 *
 * @property {number}               zoom Current zoom to display the FeatureGeometry.
 * @property {Object}               collection The FeatureCollection to which the FeatureGeometry is attached.
 * @property {Object}               properties Properties of the FeatureGeometry.
 * @property {string}               type Geometry type of the feature. Can be `point`, `line`, or `polygon`.
 * @property {StyleOptions|Function}featureStyle StyleOptions object (or a function returning one) to get style
 *                                  information at feature and FeatureGeometry level from the data parsed.
 * @property {Coordinates}          coordinates The coordinates (in world space) of the last vertex (x, y, z) set with
 *                                  setLocalCoordinatesFromArray().
 * private properties:
 * @property {Coordinates}          worldCoord @private Coordinates object to store coordinates in world space.
 * @property {Coordinates}          localCoordinates @private Coordinates object to store coordinates in local space.
 * @property {boolean}              worldCoordsComputed @private Have the world coordinates already been computed
 *                                      from the local coordinates?
 * @property {Feature}              feature  @private The itowns feature of interest.
 * @property {FeatureGeometry}      geometry  @private The FeatureGeometry to compute the style.
 */
export class StyleContext {
    #worldCoord = new Coordinates('EPSG:4326', 0, 0, 0);
    #localCoordinates = new Coordinates('EPSG:4326', 0, 0, 0);
    #worldCoordsComputed = true;
    #feature = {};
    #geometry = {};

    setZoom(zoom) {
        this.zoom = zoom;
    }

    setFeature(f) {
        this.#feature = f;
    }

    setGeometry(g) {
        this.#geometry = g;
    }

    setCollection(c) {
        this.collection = c;
        this.#localCoordinates.setCrs(c.crs);
    }

    setLocalCoordinatesFromArray(vertices, offset) {
        this.#worldCoordsComputed = false;
        return this.#localCoordinates.setFromArray(vertices, offset);
    }

    get properties() {
        return this.#geometry.properties;
    }

    get type() {
        return this.#feature.type;
    }
    get featureStyle() {
        let featureStyle = this.#feature.style;
        if (featureStyle instanceof Function) {
            featureStyle = featureStyle(this.properties, this);
        }
        return featureStyle;
    }

    get coordinates() {
        if (!this.#worldCoordsComputed) {
            this.#worldCoordsComputed = true;
            this.#worldCoord.copy(this.#localCoordinates).applyMatrix4(this.collection.matrixWorld);
            if (this.#localCoordinates.crs == 'EPSG:4978') {
                return this.#worldCoord.as('EPSG:4326', this.#worldCoord);
            }
        }
        return this.#worldCoord;
    }
}

/**
 * A Style is a class that defines the visual appearance of {@link
 * FeatureCollection} and {@link Feature}. It is taken into account when drawing
 * them in textures that will be placed onto tiles.
 *
 * As there are five basic elements present in `Features`, there are also five
 * main components in a `Style` object:
 * - `fill` is for all fillings and polygons
 * - `stroke` is for all lines and polygons edges
 * - `point` is for all points
 * - `text` contains all {@link Label} related things
 * - `icon` defines the appearance of icons attached to label.
 *
 * Many style property can be set to functions. When that is the case, the function's
 * return type must necessarily be the same as the types (other than function) of the property.
 * For instance, if the `fill.pattern` property is set to a function, this function must return
 * an `Image`, a `Canvas`, or `String`.
 * The first parameter of functions used to set `Style` properties is always an object containing
 * the properties of the features displayed with the current `Style` instance.
 *
 * @property {Object} fill - Polygons and fillings style.
 * @property {String|Function|THREE.Color} fill.color - Defines the main color of the filling. Can be
 * any [valid color
 * string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Default is no value, indicating that no filling needs to be done.
 * If the `Layer` is a `GeometryLayer` you can use `THREE.Color`.
 * @property {Image|Canvas|String|Object|Function} [fill.pattern] - Defines a pattern to fill the
 * surface with. It can be an `Image` to use directly, an url to fetch the pattern or an object containing
 * the url of the image to fetch and the transformation to apply.
 * from. See [this example] (http://www.itowns-project.org/itowns/examples/#source_file_geojson_raster)
 * for how to use.
 * @property {Image|String} [fill.pattern.source] - The image or the url to fetch the pattern image
 * @property {Object} [fill.pattern.cropValues] - The x, y, width and height (in pixel) of the sub image to use.
 * @property {THREE.Color} [fill.pattern.color] - Can be any [valid color string]
 * @property {Number|Function} fill.opacity - The opacity of the color or of the
 * pattern. Can be between `0.0` and `1.0`. Default is `1.0`.
 * For a `GeometryLayer`, this opacity property isn't used.
 * @property {Number|Function} fill.base_altitude - Only for {@link GeometryLayer}, defines altitude
 * for each coordinate.
 * If `base_altitude` is `undefined`, the original altitude is kept, and if it doesn't exist
 * then the altitude value is set to 0.
 * @property {Number|Function} [fill.extrusion_height] - Only for {@link GeometryLayer} and if user sets it.
 * If defined, polygons will be extruded by the specified amount.
 * @property {Object} stroke - Lines and polygons edges.
 * @property {String|Function|THREE.Color} stroke.color The color of the line. Can be any [valid
 * color string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Default is no value, indicating that no stroke needs to be done.
 * If the `Layer` is a `GeometryLayer` you can use `THREE.Color`.
 * @property {Number|Function} stroke.opacity - The opacity of the line. Can be between
 * `0.0` and `1.0`. Default is `1.0`.
 * For a `GeometryLayer`, this opacity property isn't used.
 * @property {Number|Function} stroke.width - The width of the line. Default is `1.0`.
 * @property {Number|Function} stroke.base_altitude - Only for {@link GeometryLayer}, defines altitude
 * for each coordinate.
 * If `base_altitude` is `undefined`, the original altitude is kept, and if it doesn't exist
 * then the altitude value is set to 0.
 *
 * @property {Object} point - Point style.
 * @property {String|Function} point.color - The color of the point. Can be any [valid
 * color string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Default is no value, indicating that no point will be shown.
 * @property {Number|Function} point.radius - The radius of the point, in pixel. Default
 * is `2.0`.
 * @property {String|Function} point.line - The color of the border of the point. Can be
 * any [valid color
 * string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Not supported for `GeometryLayer`.
 * @property {Number|Function} point.width - The width of the border, in pixel. Default
 * is `0.0` (no border).
 * @property {Number|Function} point.opacity - The opacity of the point. Can be between
 * `0.0` and `1.0`. Default is `1.0`.
 * Not supported for `GeometryLayer`.
 * @property {Number|Function} point.base_altitude - Only for {@link GeometryLayer}, defines altitude
 * for each coordinate.
 * If `base_altitude` is `undefined`, the original altitude is kept, and if it doesn't exist
 * then the altitude value is set to 0.
 * @property {Object} point.model - 3D model to instantiate at each point position

 *
 * @property {Object} text - All things {@link Label} related.
 * @property {String|Function} text.field - A string representing a property key of
 * a `FeatureGeometry` enclosed in brackets, that will be replaced by the value of the
 * property for each geometry. For example, if each geometry contains a `name` property,
 * `text.field` can be set to `{name}`. Default is no value, indicating that no
 * text will be displayed.
 *
 * It's also possible to create more complex expressions. For example, you can combine
 * text that will always be displayed (e.g. `foo`) and variable properties (e.g. `{bar}`)
 * like the following: `foo {bar}`. You can also use multiple variables in one field.
 * Let's say for instance that you have two properties latin name and local name of a
 * place, you can write something like `{name_latin} - {name_local}` which can result
 * in `Marrakesh - مراكش` for example.
 * @property {String|Function} text.color - The color of the text. Can be any [valid
 * color string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Default is `#000000`.
 * @property {String|Number[]|Function} text.anchor - The anchor of the text relative to its
 * position (see {@link Label} for the position). Can be one of the following values: `top`,
 * `left`, `bottom`, `right`, `center`, `top-left`, `top-right`, `bottom-left`
 * or `bottom-right`. Default is `center`.
 *
 * It can also be defined as an Array of two numbers. Each number defines an offset (in
 * fraction of the label width and height) between the label position and the top-left
 * corner of the text. The first value is the horizontal offset, and the second is the
 * vertical offset. For example, `[-0.5, -0.5]` will be equivalent to `center`.
 * @property {Array|Function} text.offset - The offset of the text, depending on its
 * anchor, in pixels. First value is from `left`, second is from `top`. Default
 * is `[0, 0]`.
 * @property {Number|Function} text.padding - The padding outside the text, in pixels.
 * Default is `2`.
 * @property {Number|Function} text.size - The size of the font, in pixels. Default is
 * `16`.
 * @property {Number|Function} text.wrap - The maximum width, in pixels, before the text
 * is wrapped, because the string is too long. Default is `10`.
 * @property {Number|Function} text.spacing - The spacing between the letters, in `em`.
 * Default is `0`.
 * @property {String|Function} text.transform - A value corresponding to the [CSS
 * property
 * `text-transform`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-transform).
 * Default is `none`.
 * @property {String|Function} text.justify - A value corresponding to the [CSS property
 * `text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align).
 * Default is `center`.
 * @property {Number|Function} text.opacity - The opacity of the text. Can be between
 * `0.0` and `1.0`. Default is `1.0`.
 * @property {Array|Function} text.font - A list (as an array of string) of font family
 * names, prioritized in the order it is set. Default is `Open Sans Regular,
 * Arial Unicode MS Regular, sans-serif`.
 * @property {String|Function} text.haloColor - The color of the halo. Can be any [valid
 * color string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * Default is `#000000`.
 * @property {Number|Function} text.haloWidth - The width of the halo, in pixels.
 * Default is `0`.
 * @property {Number|Function} text.haloBlur - The blur value of the halo, in pixels.
 * Default is `0`.
 *
 * @property {Object} icon - Defines the appearance of icons attached to label.
 * @property {String} icon.source - The url of the icons' image file.
 * @property {String} icon.id - The id of the icons' sub-image in a vector tile data set.
 * @property {String} icon.cropValues - the x, y, width and height (in pixel) of the sub image to use.
 * @property {String} icon.anchor - The anchor of the icon compared to the label position.
 * Can be `left`, `bottom`, `right`, `center`, `top-left`, `top-right`, `bottom-left`
 * or `bottom-right`. Default is `center`.
 * @property {Number} icon.size - If the icon's image is passed with `icon.source` and/or
 * `icon.id`, its size when displayed on screen is multiplied by `icon.size`. Default is `1`.
 * @property {String|Function} icon.color - The color of the icon. Can be any [valid
 * color string](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value).
 * It will change the color of the white pixels of the icon source image.
 * @property {Number|Function} icon.opacity - The opacity of the icon. Can be between
 * `0.0` and `1.0`. Default is `1.0`.
 *
 * @example
 * const style = new itowns.Style({
 *      stroke: { color: 'red' },
 *      point: { color: 'white', line: 'red' },
 * });
 *
 * const source = new itowns.FileSource(...);
 *
 * const layer = new itowns.ColorLayer('foo', {
 *      source: source,
 *      style: style,
 * });
 *
 * view.addLayer(layer);
 */

class Style {
    /**
     * @param {StyleOptions} [params={}] An object that contain any properties
     * (zoom, fill, stroke, point, text or/and icon)
     * and sub properties of a Style ({@link StyleOptions}).
     */
    constructor(params = {}) {
        this.isStyle = true;
        this.context = new StyleContext();

        params.zoom = params.zoom || {};
        params.fill = params.fill || {};
        params.stroke = params.stroke || {};
        params.point = params.point || {};
        params.text = params.text || {};
        params.icon = params.icon || {};

        this.zoom = {};
        defineStyleProperty(this, 'zoom', 'min', params.zoom.min);
        defineStyleProperty(this, 'zoom', 'max', params.zoom.max);

        this.fill = {};
        defineStyleProperty(this, 'fill', 'color', params.fill.color);
        defineStyleProperty(this, 'fill', 'opacity', params.fill.opacity, 1.0);
        defineStyleProperty(this, 'fill', 'pattern', params.fill.pattern);
        defineStyleProperty(this, 'fill', 'base_altitude', params.fill.base_altitude, baseAltitudeDefault);
        if (params.fill.extrusion_height) {
            defineStyleProperty(this, 'fill', 'extrusion_height', params.fill.extrusion_height);
        }

        this.stroke = {};
        defineStyleProperty(this, 'stroke', 'color', params.stroke.color);
        defineStyleProperty(this, 'stroke', 'opacity', params.stroke.opacity, 1.0);
        defineStyleProperty(this, 'stroke', 'width', params.stroke.width, 1.0);
        defineStyleProperty(this, 'stroke', 'dasharray', params.stroke.dasharray, []);
        defineStyleProperty(this, 'stroke', 'base_altitude', params.stroke.base_altitude, baseAltitudeDefault);

        this.point = {};
        defineStyleProperty(this, 'point', 'color', params.point.color);
        defineStyleProperty(this, 'point', 'line', params.point.line);
        defineStyleProperty(this, 'point', 'opacity', params.point.opacity, 1.0);
        defineStyleProperty(this, 'point', 'radius', params.point.radius, 2.0);
        defineStyleProperty(this, 'point', 'width', params.point.width, 0.0);
        defineStyleProperty(this, 'point', 'base_altitude', params.point.base_altitude, baseAltitudeDefault);
        if (params.point.model) {
            defineStyleProperty(this, 'point', 'model', params.point.model);
        }

        this.text = {};
        defineStyleProperty(this, 'text', 'field', params.text.field);
        defineStyleProperty(this, 'text', 'zOrder', params.text.zOrder, 'auto');
        defineStyleProperty(this, 'text', 'color', params.text.color, '#000000');
        defineStyleProperty(this, 'text', 'anchor', params.text.anchor, 'center');
        defineStyleProperty(this, 'text', 'offset', params.text.offset, [0, 0]);
        defineStyleProperty(this, 'text', 'padding', params.text.padding, 2);
        defineStyleProperty(this, 'text', 'size', params.text.size, 16);
        defineStyleProperty(this, 'text', 'placement', params.text.placement, 'point');
        defineStyleProperty(this, 'text', 'rotation', params.text.rotation, 'auto');
        defineStyleProperty(this, 'text', 'wrap', params.text.wrap, 10);
        defineStyleProperty(this, 'text', 'spacing', params.text.spacing, 0);
        defineStyleProperty(this, 'text', 'transform', params.text.transform, 'none');
        defineStyleProperty(this, 'text', 'justify', params.text.justify, 'center');
        defineStyleProperty(this, 'text', 'opacity', params.text.opacity, 1.0);
        defineStyleProperty(this, 'text', 'font', params.text.font, ['Open Sans Regular', 'Arial Unicode MS Regular', 'sans-serif']);
        defineStyleProperty(this, 'text', 'haloColor', params.text.haloColor, '#000000');
        defineStyleProperty(this, 'text', 'haloWidth', params.text.haloWidth, 0);
        defineStyleProperty(this, 'text', 'haloBlur', params.text.haloBlur, 0);

        this.icon = {};
        defineStyleProperty(this, 'icon', 'source', params.icon.source);
        if (params.icon.key) {
            console.warn("'icon.key' is deprecated: use 'icon.id' instead");
            params.icon.id = params.icon.key;
        }
        defineStyleProperty(this, 'icon', 'id', params.icon.id);
        defineStyleProperty(this, 'icon', 'cropValues', params.icon.cropValues);
        defineStyleProperty(this, 'icon', 'anchor', params.icon.anchor, 'center');
        defineStyleProperty(this, 'icon', 'size', params.icon.size, 1);
        defineStyleProperty(this, 'icon', 'color', params.icon.color);
        defineStyleProperty(this, 'icon', 'opacity', params.icon.opacity, 1.0);
    }

    setContext(ctx) {
        this.context = ctx;
    }
}

// Add custom style sheet with iTowns specifics
const CustomStyle = {
    itowns_stroke_single_before,
};

const customStyleSheet = document.createElement('style');
customStyleSheet.type = 'text/css';

Object.keys(CustomStyle).forEach((key) => {
    customStyleSheet.innerHTML += `${CustomStyle[key]}\n\n`;
});

if (typeof document !== 'undefined') {
    document.getElementsByTagName('head')[0].appendChild(customStyleSheet);
}

export default Style;
