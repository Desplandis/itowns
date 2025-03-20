import * as THREE from 'three';

let _canvas;
function _readTextureValueAt(metadata, texture, ...uv) {
    for (let i = 0; i < uv.length; i += 2) {
        uv[i] = THREE.MathUtils.clamp(uv[i], 0, texture.image.width - 1);
        uv[i + 1] = THREE.MathUtils.clamp(uv[i + 1], 0, texture.image.height - 1);
    }

    if (texture.image.data) {
        // read a single value
        if (uv.length === 2) {
            const v = texture.image.data[uv[1] * texture.image.width + uv[0]];
            return v != metadata.noDataValue ? v : undefined;
        }
        // or read multiple values
        const result = [];
        for (let i = 0; i < uv.length; i += 2) {
            const v = texture.image.data[uv[i + 1] * texture.image.width + uv[i]];
            result.push(v != metadata.noDataValue ? v : undefined);
        }
        return result;
    } else {
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

        const ctx = _canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(texture.image, minx, miny, dw, dh, 0, 0, dw, dh);
        const d = ctx.getImageData(0, 0, dw, dh);

        const result = [];
        for (let i = 0; i < uv.length; i += 2) {
            const ox = uv[i] - minx;
            const oy = uv[i + 1] - miny;

            // d is 4 bytes per pixel
            const v = THREE.MathUtils.lerp(
                metadata.colorTextureElevationMinZ,
                metadata.colorTextureElevationMaxZ,
                d.data[4 * oy * dw + 4 * ox] / 255);
            result.push(v != metadata.noDataValue ? v : undefined);
        }
        if (uv.length === 2) {
            return result[0];
        } else {
            return result;
        }
    }
}

function _convertUVtoTextureCoords(texture, u, v) {
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

export function readTextureValueNearestFiltering(metadata, texture, vertexU, vertexV) {
    const coords = _convertUVtoTextureCoords(texture, vertexU, vertexV);

    const u = (coords.wu <= 0) ? coords.u1 : coords.u2;
    const v = (coords.wv <= 0) ? coords.v1 : coords.v2;

    return _readTextureValueAt(metadata, texture, u, v);
}

function _lerpWithUndefinedCheck(x, y, t) {
    if (x == undefined) {
        return y;
    } else if (y == undefined) {
        return x;
    } else {
        return THREE.MathUtils.lerp(x, y, t);
    }
}

export function readTextureValueWithBilinearFiltering(metadata, texture, vertexU, vertexV) {
    const coords = _convertUVtoTextureCoords(texture, vertexU, vertexV);

    const [z11, z21, z12, z22] = _readTextureValueAt(metadata, texture,
        coords.u1, coords.v1,
        coords.u2, coords.v1,
        coords.u1, coords.v2,
        coords.u2, coords.v2);


    // horizontal filtering
    const zu1 = _lerpWithUndefinedCheck(z11, z21, coords.wu);
    const zu2 = _lerpWithUndefinedCheck(z12, z22, coords.wu);
    // then vertical filtering
    return _lerpWithUndefinedCheck(zu1, zu2, coords.wv);
}

function minMax4Corners(texture, pitch, options) {
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
 * @param      {THREE.Texture}   texture                     The texture to parse
 * @param      {THREE.Vector4}   pitch                       The pitch,  restrict zone to parse
 * @param      {Object}          options                     No data value and clamp values
 * @param      {number}          options.noDataValue         No data value
 * @param      {number}          [options.zmin]   The minimum elevation value after which it will be clamped
 * @param      {number}          [options.zmax]   The maximum elevation value after which it will be clamped
 * @return     {Object}  The minimum and maximum elevation.
 */
export function computeMinMaxElevation(texture, pitch, options) {
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
export function checkNodeElevationTextureValidity(data, noDataValue) {
    const l = data.length;
    return data[0] > noDataValue &&
           data[l - 1] > noDataValue &&
           data[Math.sqrt(l) - 1] > noDataValue &&
           data[l - Math.sqrt(l)] > noDataValue;
}

// This function replaces noDataValue by significant values from parent texture (or 0)
export function insertSignificantValuesFromParent(data, dataParent = () => 0, noDataValue) {
    for (let i = 0, l = data.length; i < l; ++i) {
        if (data[i] === noDataValue) {
            data[i] = dataParent(i);
        }
    }
}
