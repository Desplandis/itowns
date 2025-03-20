import { MathUtils } from 'three';
import type { DataTexture, Texture, Vector4Like, TypedArray } from 'three';

interface ImageTexture extends Texture {
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
}

type ElevationTexture = ImageTexture | DataTexture;

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
 * @remarks This only supports single-component textures for now (e.g. xBIL
 * textures which have a single Float32 component).
 */
function readDataTextureValueAt(
    metadata: Metadata,
    texture: DataTexture,
    uv: number[]
): (number | undefined)[] {
    const { width, data } = texture.image;
    const result = [];
    for (let i = 0; i < uv.length; i += 2) {
        const v = (data as TypedArray)[uv[i + 1] * width + uv[i]];
        result.push(v !== metadata.noDataValue ? v : undefined);
    }
    return result;
}

/**
 * Reads and interprets the given pixels from an image texture as elevation
 * values. `noDataValues` are replaced by `undefined`.
 * 
 * @remarks This only supports greyscale textures and performs a linear
 * interpolation of the red component between `colorTextureElevationMinZ` and
 * `colorTextureElevationMaxZ`.
 */
function readImageTextureValueAt(
    metadata: Metadata,
    texture: ImageTexture,
    uv: number[]
) {
    const { image } = texture;

    // TODO: we should create an utility providing a shared context, this is
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
    for (let i = 0; i < uv.length; i += 2) {
        minx = Math.min(uv[i], minx);
        miny = Math.min(uv[i + 1], miny);
        maxx = Math.max(uv[i], maxx);
        maxy = Math.max(uv[i + 1], maxy);
    }

    const dw = maxx - minx + 1;
    const dh = maxy - miny + 1;
    _canvas.width = Math.max(_canvas.width, dw);
    _canvas.height = Math.max(_canvas.height, dh);

    const ctx = _canvas.getContext('2d', {willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(image, minx, miny, dw, dh, 0, 0, dw, dh);
    const d = ctx.getImageData(0, 0, dw, dh);

    const result: Array<number | undefined> = [];
    for (let i = 0; i < uv.length; i += 2) {
        const ox = uv[i] - minx;
        const oy = uv[i + 1] - miny;

        // d is 4 bytes per pixel
        const v = MathUtils.lerp(
            metadata.colorTextureElevationMinZ,
            metadata.colorTextureElevationMaxZ,
            d.data[4 * oy * dw + 4 * ox] / 255
        );
        result.push(v !== metadata.noDataValue ? v : undefined);
    }

    return result;
}

function _readTextureValueAt(metadata: Metadata, texture: ElevationTexture, uv: number[]) {
    for (let i = 0; i < uv.length; i += 2) {
        uv[i] = MathUtils.clamp(uv[i], 0, texture.image.width - 1);
        uv[i + 1] = MathUtils.clamp(uv[i + 1], 0, texture.image.height - 1);
    }

    if ('isDataTexture' in texture) {
        return readDataTextureValueAt(metadata, texture, uv);
    } else {
        return readImageTextureValueAt(metadata, texture, uv);
    }
}

/**
 * @remarks This function ignores the uv-transform matrix of the texture.
 */
function _convertUVtoTextureCoords(texture: Texture, u: number, v: number) {
    const { width, height } = texture.image;

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

export function readTextureValueNearestFiltering(metadata: Metadata, texture: Texture, vertexU: number, vertexV: number) {
    const coords = _convertUVtoTextureCoords(texture, vertexU, vertexV);

    const u = (coords.wu <= 0) ? coords.u1 : coords.u2;
    const v = (coords.wv <= 0) ? coords.v1 : coords.v2;

    return _readTextureValueAt(metadata, texture, [u, v])[0];
}

function _lerpWithUndefinedCheck(x: number | undefined, y: number | undefined, t: number) {
    if (x == undefined) {
        return y;
    } else if (y == undefined) {
        return x;
    } else {
        return MathUtils.lerp(x, y, t);
    }
}

export function readTextureValueWithBilinearFiltering(metadata: Metadata, texture: Texture, vertexU: number, vertexV: number) {
    const coords = _convertUVtoTextureCoords(texture, vertexU, vertexV);

    const [z11, z21, z12, z22] = _readTextureValueAt(metadata, texture, [
        coords.u1, coords.v1,
        coords.u2, coords.v1,
        coords.u1, coords.v2,
        coords.u2, coords.v2,
    ]);


    // horizontal filtering
    const zu1 = _lerpWithUndefinedCheck(z11, z21, coords.wu);
    const zu2 = _lerpWithUndefinedCheck(z12, z22, coords.wu);
    // then vertical filtering
    return _lerpWithUndefinedCheck(zu1, zu2, coords.wv);
}

function minMax4Corners(texture: Texture, pitch: Vector4Like, options: Metadata) {
    const u = pitch.x;
    const v = pitch.y;
    const w = pitch.z;
    const z = [
        readTextureValueWithBilinearFiltering(options, texture, u, v),
        readTextureValueWithBilinearFiltering(options, texture, u + w, v),
        readTextureValueWithBilinearFiltering(options, texture, u + w, v + w),
        readTextureValueWithBilinearFiltering(options, texture, u, v + w),
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
 * @param texture - The texture to parse
 * @param pitch - The pitch, restrict zone to parse
 * @param options - No data value and clamp values
 * @returns The minimum and maximum elevation
 */
export function computeMinMaxElevation(texture: ElevationTexture, pitch: Vector4Like, options: Metadata) {
    if (!('isDataTexture' in texture)) {
        // Return null values means there's no elevation values.
        // They can't be determined.
        // Don't return 0 because the result will be wrong
        return { min: null, max: null };
    }
    const { width, height, data } = texture.image;

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
                const val = (data as TypedArray)[x];
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
