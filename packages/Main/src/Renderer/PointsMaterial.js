import {
    Color,
    CanvasTexture,
    DataTexture,
    LinearFilter,
    NearestFilter,
    Material,
    RepeatWrapping,
    RedFormat,
    RGBAFormat,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
    Vector2,
} from 'three';
import PointsVS from 'Renderer/Shader/PointsVS.glsl';
import PointsFS from 'Renderer/Shader/PointsFS.glsl';
import Gradients from 'Utils/Gradients';

export const PNTS_MODE = {
    COLOR: 0,
    INTENSITY: 1,
    CLASSIFICATION: 2,
    ELEVATION: 3,
    RETURN_NUMBER: 4,
    RETURN_TYPE: 5,
    RETURN_COUNT: 6,
    POINT_SOURCE_ID: 7,
    SCAN_ANGLE: 8,
    NORMAL: 9,
};

export const PNTS_SHAPE = {
    CIRCLE: 0,
    SQUARE: 1,
};

export const PNTS_SIZE_MODE = {
    VALUE: 0,
    ATTENUATED: 1,
};

const white = new Color(1.0,  1.0,  1.0);

function updateTransformUniform(map, uniform) {
    if (!map) { return; }

    if (map.matrixAutoUpdate) {
        map.updateMatrix();
    }

    uniform.value.copy(map.matrix);
}

/**
 * Every lidar point can have a classification assigned to it that defines
 * the type of object that has reflected the laser pulse. Lidar points can be
 * classified into a number of categories including bare earth or ground,
 * top of canopy, and water. The different classes are defined using numeric
 * integer codes in the files.
 *
 * @typedef {Object} Classification
 * @property {boolean} visible - category visibility,
 * @property {string} name - category name,
 * @property {THREE.Color} color - category color,
 * @property {number} opacity - category opacity,
 */

export const ClassificationScheme = {
    DEFAULT: {
        0: { visible: true, name: 'never classified', color: new Color(0.5,  0.5,  0.5), opacity: 1.0 },
        1: { visible: true, name: 'unclassified', color: new Color(0.5,  0.5,  0.5), opacity: 1.0 },
        2: { visible: true, name: 'ground', color: new Color(0.63, 0.32, 0.18), opacity: 1.0 },
        3: { visible: true, name: 'low vegetation', color: new Color(0.0,  1.0,  0.0), opacity: 1.0 },
        4: { visible: true, name: 'medium vegetation', color: new Color(0.0,  0.8,  0.0), opacity: 1.0 },
        5: { visible: true, name: 'high vegetation', color: new Color(0.0,  0.6,  0.0), opacity: 1.0 },
        6: { visible: true, name: 'building', color: new Color(1.0,  0.66, 0.0), opacity: 1.0 },
        7: { visible: true, name: 'low point(noise)', color: new Color(1.0,  0.0,  1.0), opacity: 1.0 },
        8: { visible: true, name: 'key-point', color: new Color(1.0,  0.0,  0.0), opacity: 1.0 },
        9: { visible: true, name: 'water', color: new Color(0.0,  0.0,  1.0), opacity: 1.0 },
        10: { visible: true, name: 'rail', color: new Color(0.8,  0.8,  1.0), opacity: 1.0 },
        11: { visible: true, name: 'road Surface', color: new Color(0.4,  0.4,  0.7), opacity: 1.0 },
        12: { visible: true, name: 'overlap', color: new Color(1.0,  1.0,  0.0), opacity: 1.0 },
        DEFAULT: { visible: true, name: 'default', color: new Color(0.3, 0.6, 0.6), opacity: 1.0 },
    },
};

const DiscreteScheme = {
    DEFAULT: {
        0: { visible: true, name: '0', color: new Color('rgb(67, 99, 216)'), opacity: 1.0 },
        1: { visible: true, name: '1', color: new Color('rgb(60, 180, 75);'), opacity: 1.0 },
        2: { visible: true, name: '2', color: new Color('rgb(255, 255, 25)'), opacity: 1.0 },
        3: { visible: true, name: '3', color: new Color('rgb(145, 30, 180)'), opacity: 1.0 },
        4: { visible: true, name: '4', color: new Color('rgb(245, 130, 49)'), opacity: 1.0 },
        5: { visible: true, name: '5', color: new Color('rgb(230, 25, 75)'), opacity: 1.0 },
        6: { visible: true, name: '6', color: new Color('rgb(66, 212, 244)'), opacity: 1.0 },
        7: { visible: true, name: '7', color: new Color('rgb(240, 50, 230)'), opacity: 1.0 },
        DEFAULT: { visible: true, name: 'default', color: white, opacity: 1.0 },
    },
};

// Taken from Potree. Copyright (c) 2011-2020, Markus Schütz All rights reserved.
// https://github.com/potree/potree/blob/develop/src/materials/PointCloudMaterial.js
function generateGradientTexture(gradient) {
    const size = 64;

    // create canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    // get context
    const context = canvas.getContext('2d');

    // draw gradient
    context.rect(0, 0, size, size);
    const ctxGradient = context.createLinearGradient(0, 0, size, size);

    for (let i = 0; i < gradient.length; i++) {
        const step = gradient[i];

        ctxGradient.addColorStop(step[0], `#${step[1].getHexString()}`);
    }

    context.fillStyle = ctxGradient;
    context.fill();

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;

    texture.minFilter = LinearFilter;
    texture.wrap = RepeatWrapping;
    texture.repeat = 2;

    return texture;
}

function recomputeTexture(scheme, texture, nbClass) {
    const data = texture.image.data;
    const width = texture.image.width;
    if (!nbClass) { nbClass = Object.keys(scheme).length; }

    for (let i = 0; i < width; i++) {
        let color;
        let opacity;

        if (scheme[i]) {
            color = scheme[i].color;
            opacity = scheme[i].opacity;
        } else if (scheme[i % nbClass]) {
            color = scheme[i % nbClass].color;
            opacity = scheme[i % nbClass].opacity;
        } else if (scheme.DEFAULT) {
            color = scheme.DEFAULT.color;
            opacity = scheme.DEFAULT.opacity;
        } else {
            color = white;
            opacity = 1.0;
        }

        const j = 4 * i;
        data[j + 0] = parseInt(255 * color.r, 10);
        data[j + 1] = parseInt(255 * color.g, 10);
        data[j + 2] = parseInt(255 * color.b, 10);
        data[j + 3] = parseInt(255 * opacity, 10);
    }
    texture.needsUpdate = true;
}

function mapFromMode(mode, params) {
    switch (mode) {
        case PNTS_MODE.CLASSIFICATION:
            return params.classificationTexture;
        case PNTS_MODE.INTENSITY:
        case PNTS_MODE.ELEVATION:
        case PNTS_MODE.SCAN_ANGLE:
            return params.gradientTexture;
        case PNTS_MODE.RETURN_NUMBER:
        case PNTS_MODE.RETURN_TYPE:
        case PNTS_MODE.RETURN_COUNT:
        case PNTS_MODE.POINT_SOURCE_ID:
            return params.discreteTexture;
        default:
            return null;
    }
}

function rangeFromMode(mode, params) {
    switch (mode) {
        case PNTS_MODE.INTENSITY:
            return params.intensityRange;
        case PNTS_MODE.ELEVATION:
            return params.elevationRange;
        case PNTS_MODE.SCAN_ANGLE:
            return params.angleRange;
        default:
            return new Vector2(0, 0);
    }
}

class PointsMaterial extends ShaderMaterial {
    /**
     * @class      PointsMaterial
     * @param      {object}  [options={}]  The options
     * @param      {number}  [options.size=1] point size
     * @param      {number}  [options.mode=PNTS_MODE.COLOR]  display mode.
     * @param      {number}  [options.shape=PNTS_SHAPE.CIRCLE]  rendered points shape.
     * @param      {THREE.Vector4}  [options.overlayColor=new THREE.Vector4(0, 0, 0, 0)]  overlay color.

     * @param      {Scheme}  [options.classificationScheme]  LUT for point classification colorization.
     * @param      {Scheme}  [options.discreteScheme]  LUT for other discret point values colorization.
     * @param      {string}  [options.gradient]  Descrition of the gradient to use for continuous point values.
     *                          (Default value will be the 'SPECTRAL' gradient from Utils/Gradients)
     * @param      {number}  [options.sizeMode=PNTS_SIZE_MODE.VALUE]  point cloud size mode. Only 'VALUE' or 'ATTENUATED' are possible. VALUE use constant size, ATTENUATED compute size depending on distance from point to camera.
     * @param      {number}  [options.minAttenuatedSize=3]  minimum scale used by 'ATTENUATED' size mode
     * @param      {number}  [options.maxAttenuatedSize=10]  maximum scale used by 'ATTENUATED' size mode
     *
     * @property {THREE.Vector2}  [options.intensityRange=new THREE.Vector2(1, 65536)]  intensity range (default value will be [1, 65536] if not defined at Layer level).
     * @property {THREE.Vector2}  [options.elevationRange=new THREE.Vector2(0, 1000)]  elevation range (default value will be [0, 1000] if not defined at Layer level).
     * @property {THREE.Vector2}  [options.angleRange=new THREE.Vector2(-90, 90)]  scan angle range (default value will be [-90, 90] if not defined at Layer level).
     * @property {Scheme}  classificationScheme - Color scheme for point classification values.
     * @property {Scheme}  discreteScheme - Color scheme for all other discrete values.
     * @property {object}  gradients - Descriptions of all available gradients.
     * @property {object}  gradient - Description of the gradient to use for display.
     * @property {THREE.CanvasTexture}  gradientTexture - The texture generate from the choosen gradient.
     *
     * @example
     * // change color category classification
     * const pointMaterial = new PointsMaterial();
     * pointMaterial.classification[3].color.setStyle('red');
     * pointMaterial.recomputeClassification();
     */
    constructor(options = {}) {
        const gradients = {
            ...Gradients,
        };

        super({
            ...options,
            fog: true,
            // transparent: true, // TODO: move to layer?
            precision: 'highp',
            // vertexColors: true,
        });

        this.name = 'PointsMaterial';

        this.uniforms = UniformsUtils.merge([
            // THREE.PointsMaterial uniforms
            UniformsLib.points,
            UniformsLib.fog,
            // Added uniforms (defaults emulate THREE.PointsMaterial behavior)
            {
                mode: { value: PNTS_MODE.COLOR },
                shape: { value: PNTS_SHAPE.SQUARE },
                sizeAttenuation: { value: true },
                picking: { value: false },
                minAttenuatedSize: { value: 0 },
                maxAttenuatedSize: { value: Infinity },
                gamma: { value: 1.0 },
                ambientBoost: { value: 0.0 },
                range: { value: new Vector2(0, 0) },
            },
        ]);
        this.vertexShader = PointsVS;
        this.fragmentShader = PointsFS;

        // Map THREE.PointsMaterial properties to UniformLibs.points uniforms
        Object.defineProperty(this, 'color', {
            get: () => this.uniforms.diffuse.value,
            set: (color) => { this.uniforms.diffuse.value.copy(color); },
        });

        Object.defineProperty(this, 'opacity', {
            get: () => this.uniforms.opacity.value,
            set: (opacity) => { this.uniforms.opacity.value = opacity; },
        });

        Object.defineProperty(this, 'size', {
            get: () => this.uniforms.size.value,
            set: (size) => { this.uniforms.size.value = size; },
        });

        Object.defineProperty(this, 'scale', {
            get: () => this.uniforms.scale.value,
            set: (scale) => { this.uniforms.scale.value = scale; },
        });

        Object.defineProperty(this, 'map', {
            get: () => this.uniforms.map.value,
            set: (map) => {
                this.uniforms.map.value = map;
                updateTransformUniform(map, this.uniforms.uvTransform);
            },
        });

        Object.defineProperty(this, 'alphaMap', {
            get: () => this.uniforms.alphaMap.value,
            set: (map) => {
                this.uniforms.alphaMap.value = map;
                updateTransformUniform(map, this.uniforms.alphaMapTransform);
            },
        });

        Object.defineProperty(this, 'sizeAttenuation', {
            get: () => this.uniforms.sizeAttenuation.value,
            set: (value) => { this.uniforms.sizeAttenuation.value = value; },
        });

        Object.defineProperty(this, 'mode', {
            get: () => this.uniforms.mode.value,
            set: (value) => {
                this.uniforms.mode.value = value;
                this.uniforms.range.value = rangeFromMode(value, this);
                this.map = mapFromMode(value, this);
                // TODO: needsUpdate only when necessary
                this.needsUpdate = true;
            },
        });

        Object.defineProperty(this, 'shape', {
            get: () => this.uniforms.shape.value,
            set: (value) => { this.uniforms.shape.value = value; },
        });

        Object.defineProperty(this, 'picking', {
            get: () => this.uniforms.picking.value,
            set: (value) => { this.uniforms.picking.value = value; },
        });

        Object.defineProperty(this, 'minAttenuatedSize', {
            get: () => this.uniforms.minAttenuatedSize.value,
            set: (value) => { this.uniforms.minAttenuatedSize.value = value; },
        });

        Object.defineProperty(this, 'maxAttenuatedSize', {
            get: () => this.uniforms.maxAttenuatedSize.value,
            set: (value) => { this.uniforms.maxAttenuatedSize.value = value; },
        });

        Object.defineProperty(this, 'gamma', {
            get: () => this.uniforms.gamma.value,
            set: (value) => { this.uniforms.gamma.value = value; },
        });

        Object.defineProperty(this, 'ambientBoost', {
            get: () => this.uniforms.ambientBoost.value,
            set: (value) => { this.uniforms.ambientBoost.value = value; },
        });

        this.color = new Color(0xffffff);
        this.opacity = 1.0;
        this.size = 1;
        this.scale = 1.0;
        this.map = null;
        this.alphaMap = null;
        this.sizeAttenuation = true;

        this.mode = PNTS_MODE.COLOR; // equivalent to THREE.PointsMaterial
        this.shape = PNTS_SHAPE.CIRCLE; // equivalent to THREE.PointsMaterial
        this.picking = false;
        this.minAttenuatedSize = 0;
        this.maxAttenuatedSize = Infinity;
        this.gamma = 1.0;
        this.ambientBoost = 0.0;
        this.intensityRange = new Vector2(1, 65536);
        this.elevationRange = new Vector2(0, 1000);
        this.angleRange = new Vector2(-90, 90);

        // TODO: ajouter surtout range comme unique uniform
        // TODO: ajouter ENFIN l'alphaMap (après tout ce temps)

        this.gradients = gradients;
        this.gradientTexture = new CanvasTexture();
        this.classificationTexture = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat);
        this.discreteTexture = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat);
        // add texture to apply visibility.
        // const dataVisi = new Uint8Array(256 * 1);
        // const textureVisi = new THREE.DataTexture(dataVisi, 256, 1, THREE.RedFormat);

        // textureVisi.needsUpdate = true;
        // textureVisi.magFilter = THREE.NearestFilter;
        // this.visibilityTexture = textureVisi;

        this.classificationScheme = ClassificationScheme.DEFAULT;
        this.discreteScheme = DiscreteScheme.DEFAULT;

        // Update classification and discrete Texture
        this.recomputeClassification();
        this.recomputeDiscreteTexture();
        this.gradientTexture = generateGradientTexture(Gradients.SPECTRAL);
        // this.recomputeVisibilityTexture();

        // Gradient texture for continuous values
        // this.gradient = gradient;
        // CommonMaterial.setUniformProperty(this, 'gradientTexture', this.gradientTexture);

        // this.map = this.gradientTexture;
    }

    /** @override */
    onBeforeCompile(shader) {
        Object.keys(PNTS_MODE).forEach((key) => {
            shader.defines[`PNTS_MODE_${key}`] = PNTS_MODE[key];
        });
        Object.keys(PNTS_SHAPE).forEach((key) => {
            shader.defines[`PNTS_SHAPE_${key}`] = PNTS_SHAPE[key];
        });
        if (__DEBUG__) {
            shader.defines.DEBUG = 1;
        }
    }

    /** @override */
    copy(source) {
        if (source.isShaderMaterial) {
            super.copy(source);
        } else {
            Material.prototype.copy.call(this, source);
        }

        // Parameters of THREE.PointsMaterial
        this.color.copy(source.color);
        this.map = source.map;
        this.alphaMap = source.alphaMap;
        this.size = source.size;
        this.sizeAttenuation = source.sizeAttenuation;
        this.fog = source.fog;

        return this;
    }

    get sizeMode() {
        return this.uniforms.sizeAttenuation ?
            PNTS_SIZE_MODE.ATTENUATED : PNTS_SIZE_MODE.VALUE;
    }

    set sizeMode(value) {
        this.uniforms.sizeAttenuation = value === PNTS_SIZE_MODE.ATTENUATED;
    }

    recomputeClassification() {
        recomputeTexture(this.classificationScheme, this.classificationTexture, 256);
        this.dispatchEvent({
            type: 'material_property_changed',
            target: this.uniforms,
        });
    }

    recomputeDiscreteTexture() {
        recomputeTexture(this.discreteScheme, this.discreteTexture);
        this.dispatchEvent({
            type: 'material_property_changed',
            target: this.uniforms,
        });
    }

    recomputeVisibilityTexture() {
        if (this.alphaMap === null) {
            this.alphaMap = new DataTexture(new Uint8Array(256 * 1), 256, 1, RedFormat);
            this.alphaMap.magFilter = NearestFilter;
        }
        const texture = this.visibilityTexture;
        const scheme = this.classificationScheme;

        const data = texture.image.data;
        const width = texture.image.width;

        for (let i = 0; i < width; i++) {
            let visible;

            if (scheme[i]) {
                visible  = scheme[i].visible;
            } else if (scheme.DEFAULT) {
                visible  = scheme.DEFAULT.visible;
            } else {
                visible = true;
            }

            data[i] = visible ? 255 : 0;
        }
        texture.needsUpdate = true;

        this.dispatchEvent({
            type: 'material_property_changed',
            target: this.uniforms,
        });
    }
}

export default PointsMaterial;
