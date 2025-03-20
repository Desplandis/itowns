import { MathUtils } from 'three';
import type { DataTexture, Texture, Vector4Like, TypedArray } from 'three';

interface ImageTexture extends Texture {
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
}

type ElevationTexture = DataTexture | ImageTexture;

interface Metadata {
    noDataValue: number;
    colorTextureElevationMinZ: number;
    colorTextureElevationMaxZ: number;
    zmin: number | null;
    zmax: number | null;
}

let _canvas: HTMLCanvasElement;

/**
 * Reads and interprets the given pixels from a data texture as elevation
 * values. `noDataValues` are replaced by `undefined`.
 * 
 * **Warning**: This only supports single-component textures for now (e.g. xBIL
 * textures which have a single Float32 component).
 */
function readDataTextureValueAt(
    texture: DataTexture,
    metadata: { noDataValue: number },
    ...pixels: [number, number][]
): Array<number | undefined> {
    const result: Array<number | undefined> = [];
    for (let i = 0; i < pixels.length; i += 1) {
        const v = (texture.image.data as TypedArray)[pixels[i][1] * texture.image.width + pixels[i][0]];
        result.push(v !== metadata.noDataValue ? v : undefined)
    }
    console.log(texture.image);
    return result;
}

/**
 * Reads and interprets the given pixels from an image texture as elevation
 * values. `noDataValues` are replaced by `undefined`.
 * 
 * **Warning**: This only supports greyscale textures and performs a linear
 * interpolation of the red component between `colorTextureElevationMinZ` and
 * `colorTextureElevationMaxZ`.
 */
function readImageTextureValueAt(
    texture: ImageTexture,
    metadata: Metadata,
    ...uvs: [number, number][]
): Array<number | undefined> {
    // TODO: we shoud create an utility providing a shared context, this is
    // not the first time I encounter this pattern in iTowns...
    if (!_canvas) {
        _canvas = document.createElement('canvas');
        _canvas.width = 2;
        _canvas.height = 2;
    }
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (let i = 0; i < uvs.length; i += 1) {
        minx = Math.min(uvs[i][0], minx);
        miny = Math.min(uvs[i][1], miny);
        maxx = Math.max(uvs[i][0], maxx);
        maxy = Math.max(uvs[i][1], maxy);
    }
    const dw = maxx - minx + 1;
    const dh = maxy - miny + 1;
    _canvas.width = Math.max(_canvas.width, dw);
    _canvas.height = Math.max(_canvas.height, dh);

    const ctx = _canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(texture.image, minx, miny, dw, dh, 0, 0, dw, dh);
    const d = ctx.getImageData(0, 0, dw, dh);

    const result: Array<number | undefined> = [];
    for (let i = 0; i < uvs.length; i += 1) {
        const ox = uvs[i][0] - minx;
        const oy = uvs[i][1] - miny;

        // d is 4 bytes per pixel
        const v = MathUtils.lerp(
            metadata.colorTextureElevationMinZ,
            metadata.colorTextureElevationMaxZ,
            d.data[4 * oy * dw + 4 * ox] / 255);
        result.push(v != metadata.noDataValue ? v : undefined);
    }
    return result;
}

function readTextureValueAt(
    texture: ElevationTexture,
    metadata: Metadata,
    ...pixels: [number, number][]
): Array<number | undefined> {
    for (let i = 0; i < pixels.length; i += 1) {
        pixels[i][0] = MathUtils.clamp(pixels[i][0], 0, texture.image.width - 1);
        pixels[i][1] = MathUtils.clamp(pixels[i][1], 0, texture.image.height - 1);
    }

    if ('isDataTexture' in texture) {
        return readDataTextureValueAt(texture, metadata, ...pixels);
    } else {
        return readImageTextureValueAt(texture, metadata, ...pixels);
    }
}

function convertUVtoPixelCoords(texture: ElevationTexture, u: number, v: number) {
    const width = texture.image.width;
    const height = texture.image.height;

    const up = Math.max(0, u * width - 0.5);
    const vp = Math.max(0, v * height - 0.5);

    const u1 = Math.floor(up);
    const u2 = Math.ceil(up);
    const v1 = Math.floor(vp);
    const v2 = Math.ceil(vp);

    const wu = up - u1;
    const wv = vp - v1;

    return { u1, u2, v1, v2, wu, wv };
}

function lerpWithUndefinedCheck(
    x: number | undefined,
    y: number | undefined,
    t: number,
): number | undefined {
    if (x == undefined) {
        return y;
    } else if (y == undefined) {
        return x;
    } else {
        return MathUtils.lerp(x, y, t);
    }
}

export function readTextureValueNearestFiltering(
    texture: ElevationTexture,
    metadata: Metadata,
    vertexU: number,
    vertexV: number,
): number | undefined {
    const coords = convertUVtoPixelCoords(texture, vertexU, vertexV);

    const u = (coords.wu <= 0) ? coords.u1 : coords.u2;
    const v = (coords.wv <= 0) ? coords.v1 : coords.v2;

    return readTextureValueAt(texture, metadata, [u, v])[0]; // correct by single arg
}

export function readTextureValueWithBilinearFiltering(
    texture: ElevationTexture,
    metadata: Metadata,
    vertexU: number,
    vertexV: number,
) {
    const coords = convertUVtoPixelCoords(texture, vertexU, vertexV);

    const [z11, z21, z12, z22] = readTextureValueAt(texture, metadata,
        [coords.u1, coords.v1],
        [coords.u2, coords.v1],
        [coords.u1, coords.v2],
        [coords.u2, coords.v2],
    );


    // horizontal filtering
    const zu1 = lerpWithUndefinedCheck(z11, z21, coords.wu);
    const zu2 = lerpWithUndefinedCheck(z12, z22, coords.wu);
    // then vertical filtering
    return lerpWithUndefinedCheck(zu1, zu2, coords.wv);
}

function minMax4Corners(texture: DataTexture, pitch: Vector4Like, options: Metadata) {
    const u = pitch.x;
    const v = pitch.y;
    const w = pitch.z;
    const z = [
        readTextureValueWithBilinearFiltering(texture, options, u, v),
        readTextureValueWithBilinearFiltering(texture, options, u + w, v),
        readTextureValueWithBilinearFiltering(texture, options, u + w, v + w),
        readTextureValueWithBilinearFiltering(texture, options, u, v + w),
    ].filter(val => val != undefined);

    if (z.length) {
        return { min: Math.min(...z), max: Math.max(...z) };
    } else {
        return {
            min: Infinity,
            max: -Infinity,
        };
    }
}

/**
 * Calculates the minimum maximum texture elevation with xbil data
 *
 * @param      {THREE.Texture}   texture                     The texture to parse
 * @param      {THREE.Vector4}   pitch                       The pitch,  restrict zone to parse
 * @param      {Object}          options                     No data value and clamp values
 * @param      {number}          options.noDataValue         No data value
 * @param      {number}          [options.zmin]   The minimum elevation value after which it will be clamped
 * @param      {number}          [options.zmax]   The maximum elevation value after which it will be clamped
 * @return     {Object}  The minimum and maximum elevation.
 */
export function computeMinMaxElevation(texture: Texture, pitch: Vector4Like, options: Metadata) {
    const { width, height, data } = texture.image;
    if (!data) {
        // Return null values means there's no elevation values.
        // They can't be determined.
        // Don't return 0 because the result will be wrong
        return { min: null, max: null };
    }

    // compute the minimum and maximum elevation on the 4 corners texture.
    let { min, max } = minMax4Corners(texture, pitch, options);

    const sizeX = Math.floor(pitch.z * width);

    if (sizeX > 2) {
        const sizeY = Math.floor(pitch.z * height);
        const xs = Math.floor(pitch.x * width);
        const ys = Math.floor(pitch.y * height);
        const inc = Math.max(Math.floor(sizeX / 32), 2);
        const limX = ys + sizeY;
        for (let y = ys; y < limX; y += inc) {
            const pit = y * (width || 0);
            let x = pit + xs;
            const limX = x + sizeX;
            for (x; x < limX; x += inc) {
                const val = data[x];
                if (val !== options.noDataValue) {
                    max = Math.max(max, val);
                    min = Math.min(min, val);
                }
            }
        }
    }

    // Clamp values to zmin and zmax values configured in ElevationLayer
    if (options.zmin != null) {
        if (min < options.zmin) { min = options.zmin; }
        if (max < options.zmin) { max = options.zmin; }
    }

    if (options.zmax != null) {
        if (min > options.zmax) { min = options.zmax; }
        if (max > options.zmax) { max = options.zmax; }
    }

    if (max === -Infinity || min === Infinity) {
        // Return null values means the elevation values are incoherent
        // They can't be determined.
        // Don't return 0, -Infinity or Infinity because the result will be wrong
        return { min: null, max: null };
    } else {
        return { min, max };
    }
}

// We check if the elevation texture has some significant values through corners
export function checkNodeElevationTextureValidity(data: number[], noDataValue: number) {
    const l = data.length;
    return data[0] > noDataValue &&
           data[l - 1] > noDataValue &&
           data[Math.sqrt(l) - 1] > noDataValue &&
           data[l - Math.sqrt(l)] > noDataValue;
}

// This function replaces noDataValue by significant values from parent texture (or 0)
export function insertSignificantValuesFromParent(data: number[], dataParent = (i: number) => 0, noDataValue: number) {
    for (let i = 0, l = data.length; i < l; ++i) {
        if (data[i] === noDataValue) {
            data[i] = dataParent(i);
        }
    }
}
