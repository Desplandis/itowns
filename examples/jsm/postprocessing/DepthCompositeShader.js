/**
 * Shader for depth-based compositing of two render targets.
 * The foreground is shown where it's closer than the background.
 *
 * Usage with ShaderPass:
 * ```js
 * import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
 * import { DepthCompositeShader } from './DepthCompositePass.js';
 *
 * const compositePass = new ShaderPass(DepthCompositeShader);
 * compositePass.uniforms.tBackground.value = backgroundTexture;
 * compositePass.uniforms.tBackgroundDepth.value = backgroundDepthTexture;
 * compositePass.uniforms.tForeground.value = foregroundTexture;
 * compositePass.uniforms.tForegroundDepth.value = foregroundDepthTexture;
 * ```
 */
const DepthCompositeShader = {
    name: 'DepthCompositeShader',

    uniforms: {
        tBackground: { value: null },
        tBackgroundDepth: { value: null },
        tForeground: { value: null },
        tForegroundDepth: { value: null },
    },

    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */ `
        uniform sampler2D tBackground;
        uniform sampler2D tBackgroundDepth;
        uniform sampler2D tForeground;
        uniform sampler2D tForegroundDepth;
        varying vec2 vUv;

        void main() {
            vec4 bgColor = texture2D(tBackground, vUv);
            vec4 fgColor = texture2D(tForeground, vUv);
            float bgDepth = texture2D(tBackgroundDepth, vUv).r;
            float fgDepth = texture2D(tForegroundDepth, vUv).r;

            // If foreground is closer (smaller depth) and has content, use it
            // fgDepth of 1.0 means nothing was rendered there (far plane)
            if (fgDepth < 1.0 && fgDepth <= bgDepth) {
                gl_FragColor = fgColor;
            } else {
                gl_FragColor = bgColor;
            }
        }
    `,
};

export { DepthCompositeShader };
