import {
    WebGLRenderTarget,
    DepthTexture,
    FloatType,
} from 'three';
// eslint-disable-next-line import/extensions
import { Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * A pass that renders specific objects from a scene with visibility toggling.
 * Stores both color and depth in render targets for later compositing.
 */
class SceneRenderPass extends Pass {
    /**
     * @param {THREE.Scene} scene - The scene to render
     * @param {THREE.Camera} camera - The camera to use
     * @param {Object} options - Configuration options
     * @param {THREE.Object3D[]} [options.include] - Objects to show (hide all others)
     * @param {THREE.Object3D[]} [options.exclude] - Objects to hide (show all others)
     */
    constructor(scene, camera, options = {}) {
        super();

        this.scene = scene;
        this.camera = camera;
        this.include = options.include || [];
        this.exclude = options.exclude || [];

        this.clear = true;
        this.clearDepth = true;
        this.needsSwap = false;

        // Create render target with depth texture
        this._renderTarget = null;
    }

    /**
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        if (this._renderTarget) {
            this._renderTarget.dispose();
        }
        this._renderTarget = new WebGLRenderTarget(width, height);
        this._renderTarget.depthTexture = new DepthTexture(width, height, FloatType);
    }

    /**
     * Get the color texture from the last render
     * @returns {THREE.Texture}
     */
    get colorTexture() {
        return this._renderTarget?.texture;
    }

    /**
     * Get the depth texture from the last render
     * @returns {THREE.DepthTexture}
     */
    get depthTexture() {
        return this._renderTarget?.depthTexture;
    }

    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.WebGLRenderTarget} writeBuffer
     * @param {THREE.WebGLRenderTarget} readBuffer
     */
    render(renderer, writeBuffer, readBuffer) {
        if (!this._renderTarget) {
            return;
        }

        // Store original visibility states
        const visibilityStates = new Map();

        // Handle include mode (show only specified objects)
        if (this.include.length > 0) {
            this.scene.traverse((obj) => {
                visibilityStates.set(obj, obj.visible);
            });
            // Hide everything first
            this.scene.traverse((obj) => {
                if (obj !== this.scene) {
                    obj.visible = false;
                }
            });
            // Show included objects and their ancestors
            for (const obj of this.include) {
                let current = obj;
                while (current) {
                    current.visible = true;
                    current = current.parent;
                }
                // Also show all children
                obj.traverse((child) => {
                    child.visible = visibilityStates.get(child) ?? true;
                });
            }
        }

        // Handle exclude mode (hide specified objects)
        if (this.exclude.length > 0) {
            for (const obj of this.exclude) {
                visibilityStates.set(obj, obj.visible);
                obj.visible = false;
            }   
        }

        // Render to our target
        renderer.setRenderTarget(this._renderTarget);
        if (this.clear) {
            renderer.clear();
        }
        renderer.render(this.scene, this.camera);

        // Restore visibility
        for (const [obj, visible] of visibilityStates) {
            obj.visible = visible;
        }
    }

    dispose() {
        if (this._renderTarget) {
            this._renderTarget.dispose();
        }
    }
}

export { SceneRenderPass };
