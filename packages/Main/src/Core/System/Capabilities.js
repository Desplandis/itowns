import SampleTestFS from '../../Renderer/Shader/SampleTestFS.glsl';
import SampleTestVS from '../../Renderer/Shader/SampleTestVS.glsl';

// default values
let logDepthBufferSupported = false;
let maxTexturesUnits = 8;
let maxTextureSize = 4096;

function _WebGLShader(renderer, type, string) {
    const gl = renderer.getContext();
    const shader = gl.createShader(type);

    gl.shaderSource(shader, string);
    gl.compileShader(shader);
    return shader;
}

function isFirefox() {
    return navigator && navigator.userAgent && navigator.userAgent.toLowerCase().includes('firefox');
}


async function getGPUInfo() {
    if (!navigator.gpu) {
        console.error('WebGPU non supporté sur ce navigateur.');
        return;
    }

    // Récupérer l'adaptateur GPU
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.error('Aucun adaptateur GPU disponible.');
        return;
    }

    // Récupérer les limites et les fonctionnalités supportées
    console.log('Limites du GPU:', adapter.limits);
    console.log('Fonctionnalités supportées:', adapter.features);

    maxTexturesUnits = adapter.limits.maxSampledTexturesPerShaderStage;
    maxTextureSize = adapter.limits.maxTextureDimension2D;

    // Récupérer les informations sur l'adaptateur
    // const info = adapter.requestDevice().then((device) => {
    //     console.log('Device label:', device.label);
    // });

    return adapter;
}

export default {
    isLogDepthBufferSupported() {
        return logDepthBufferSupported;
    },
    isFirefox,
    getMaxTextureUnitsCount() {
        return maxTexturesUnits;
    },
    getMaxTextureSize() {
        return maxTextureSize;
    },
    updateCapabilities(renderer) {
        // renderer.
        if (renderer.isWebGPURenderer) {
            logDepthBufferSupported = renderer.logarithmicDepthBuffer;

            getGPUInfo();
        } else {
            const gl = renderer.getContext();
            maxTexturesUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
            maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

            const program = gl.createProgram();
            const glVertexShader = _WebGLShader(renderer, gl.VERTEX_SHADER, SampleTestVS);

            let fragmentShader = `#define SAMPLE ${maxTexturesUnits}\n`;
            fragmentShader += SampleTestFS;

            const glFragmentShader = _WebGLShader(renderer, gl.FRAGMENT_SHADER, fragmentShader);

            gl.attachShader(program, glVertexShader);
            gl.attachShader(program, glFragmentShader);
            gl.linkProgram(program);

            if (gl.getProgramParameter(program, gl.LINK_STATUS) === false) {
                if (maxTexturesUnits > 16) {
                    const info = gl.getProgramInfoLog(program);
                    // eslint-disable-next-line no-console
                    console.warn(`${info}: using a maximum of 16 texture units instead of the reported value (${maxTexturesUnits})`);
                    if (isFirefox()) {
                        // eslint-disable-next-line no-console
                        console.warn(`It can come from a Mesa/Firefox bug;
                            the shader compiles to an error when using more than 16 sampler uniforms,
                            see https://bugzilla.mozilla.org/show_bug.cgi?id=777028`);
                    }
                    maxTexturesUnits = 16;
                } else {
                    throw (new Error(`The GPU capabilities could not be determined accurately.
                        Impossible to link a shader with the Maximum texture units ${maxTexturesUnits}`));
                }
            }

            gl.deleteProgram(program);
            gl.deleteShader(glVertexShader);
            gl.deleteShader(glFragmentShader);
            logDepthBufferSupported = renderer.capabilities.logarithmicDepthBuffer;
        }
    },
};
