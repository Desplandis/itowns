import {
    Vector2,
} from 'three';

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
#include <begin_vertex>
#include <project_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <packing>

uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;

uniform sampler2D tDepth;
uniform sampler2D tDiffuse;

uniform vec2 kernel[KERNEL_SIZE];

in vec2 vUv;

float getLinearDepth(const in vec2 screenPosition) {
    // TODO: orthographic support
    float fragCoordZ = texture2D(tDepth, screenPosition).x;
    float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
    return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
}

float shadow(float depth) {
    vec2 uvRadius = 1.0 / resolution;

    float sum = 0.0;
    int validSamples = 0;

    vec2 uvNeighbour;
    float neighbourDepth;
    float neighbourAlpha;
    for (int i = 0; i < KERNEL_SIZE; ++i) {
        uvNeighbour = vUv + uvRadius * kernel[i];

        // Only consider neighbors that have actual point content (alpha > 0)
        neighbourAlpha = texture2D(tDiffuse, uvNeighbour).a;
        if (neighbourAlpha > 0.01) {
            neighbourDepth = getLinearDepth(uvNeighbour);
            sum += max(0.0, depth - neighbourDepth);
            validSamples++;
        }
    }

    // Avoid division by zero; return 0 shadow if no valid neighbors
    return validSamples > 0 ? sum / float(validSamples) : 0.0;
}

void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    // Skip EDL for pixels with no point content
    if (color.a < 0.01) {
        gl_FragColor = color;
        return;
    }

    float depth = getLinearDepth(vUv);
    float res = shadow(depth);

    float edl = exp(- 300.0 * res * 6000.);

    // Apply EDL to RGB, modulated by alpha (so semi-transparent points get proportional EDL)
    gl_FragColor = vec4(color.rgb * edl, color.a);
}

`;

const EDLShader = {
    name: 'EDLShader',

    defines: {
        KERNEL_SIZE: 8,
    },

    uniforms: {
        tDepth: { value: null },
        tDiffuse: { value: null },
        kernel: { value: null },
        cameraNear: { value: null },
        cameraFar: { value: null },
        resolution: { value: new Vector2() },
    },

    vertexShader,
    fragmentShader,
};

export { EDLShader };
