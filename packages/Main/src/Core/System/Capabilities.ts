import type { WebGLRenderer } from 'three';

// Default values
let capabilities = {
    logarithmicDepthBuffer: false,
    maxTextures: 8,
    maxTextureSize: 4096,
};

export function isLogDepthBufferSupported(): boolean {
    return capabilities.logarithmicDepthBuffer;
}

export function getMaxTextureUnitsCount(): number {
    return capabilities.maxTextures;
}

export function getMaxTextureSize(): number {
    return capabilities.maxTextureSize;
}

export function updateCapabilities(renderer: WebGLRenderer) {
    capabilities = renderer.capabilities;
}