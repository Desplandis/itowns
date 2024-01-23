import { PNTS_MODE, PNTS_SHAPE, PNTS_SIZE_MODE } from 'Renderer/PointsMaterial';
import Gradients from 'Utils/Gradients';

function getController(datUI, name) {
    let controller = null;
    const controllers = datUI.__folders['Entwine Point Tile'].__folders.Styling.__controllers;
    for (let i = 0; i < controllers.length; i += 1) {
        const c = controllers[i];
        if (c.property === name || c.name === name) {
            controller = c;
            break;
        }
    }
    return controller;
}

function hideController(datUI, name) {
    getController(datUI, name).__li.style.display = 'none';
}

function showController(datUI, name) {
    getController(datUI, name).__li.style.display = '';
}

function setupControllerVisibily(datUi, mode) {
    if ([PNTS_MODE.INTENSITY, PNTS_MODE.ELEVATION, PNTS_MODE.SCAN_ANGLE].includes(parseInt(mode, 10))) {
        showController(datUi, 'gradient');
    } else {
        hideController(datUi, 'gradient');
    }
    if (PNTS_MODE.INTENSITY === parseInt(mode, 10)) {
        showController(datUi, 'minIntensityRange');
        showController(datUi, 'maxIntensityRange');
    } else {
        hideController(datUi, 'minIntensityRange');
        hideController(datUi, 'maxIntensityRange');
    }
    if (PNTS_MODE.ELEVATION === parseInt(mode, 10)) {
        showController(datUi, 'minElevationRange');
        showController(datUi, 'maxElevationRange');
    } else {
        hideController(datUi, 'minElevationRange');
        hideController(datUi, 'maxElevationRange');
    }
    if (PNTS_MODE.SCAN_ANGLE === parseInt(mode, 10)) {
        showController(datUi, 'minAngleRange');
        showController(datUi, 'maxAngleRange');
    } else {
        hideController(datUi, 'minAngleRange');
        hideController(datUi, 'maxAngleRange');
    }
}

export default {
    initTools(view, layer, datUi) {
        const update = () => {
            setupControllerVisibily(datUi, layer.material.mode);
            view.notifyChange(layer, true);
        };

        layer.debugUI = datUi.addFolder(`${layer.id}`);

        layer.debugUI.add(layer, 'visible').name('Visible').onChange(update);
        layer.debugUI.add(layer, 'sseThreshold').name('SSE threshold').onChange(update);
        layer.debugUI.add(layer, 'octreeDepthLimit', -1, 20).name('Depth limit').onChange(update);
        layer.debugUI.add(layer, 'pointBudget', 1, 15000000).name('Max point count').onChange(update);
        layer.debugUI.add(layer.object3d.position, 'z', -50, 50).name('Z translation').onChange(() => {
            layer.object3d.updateMatrixWorld();
            view.notifyChange(layer);
        });

        layer.dbgStickyNode = '';
        layer.dbgDisplaySticky = false;
        layer.dbgDisplayChildren = true;
        layer.dbgDisplayParents = true;

        const styleUI = layer.debugUI.addFolder('Styling');
        if (layer.material.mode != undefined) {
            styleUI.add(layer.material, 'mode', PNTS_MODE).name('Display mode').onChange(update);
            styleUI.add(layer.material, 'gradient', Object.keys(Gradients)).name('gradient').onChange(update);
            styleUI.add(layer, 'minIntensityRange', layer.minIntensityRange, layer.maxIntensityRange - 1).name('Intensity min')
                .onChange((value) => {
                    if (value >= layer.maxIntensityRange) {
                        layer.maxIntensityRange = value + 1;
                        getController(datUi, 'maxIntensityRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
            styleUI.add(layer, 'maxIntensityRange', layer.minIntensityRange + 1, layer.maxIntensityRange).name('Intensity max')
                .onChange((value) => {
                    if (value <= layer.minIntensityRange) {
                        layer.minIntensityRange = value - 1;
                        getController(datUi, 'minIntensityRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
            styleUI.add(layer, 'minElevationRange', layer.minElevationRange, layer.maxElevationRange).name('Elevation min')
                .onChange((value) => {
                    if (value >= layer.maxElevationRange) {
                        layer.maxElevationRange = value + 1;
                        getController(datUi, 'maxElevationRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
            styleUI.add(layer, 'maxElevationRange', layer.minElevationRange, layer.maxElevationRange).name('Elevation max')
                .onChange((value) => {
                    if (value <= layer.minElevationRange) {
                        layer.minElevationRange = value - 1;
                        getController(datUi, 'minElevationRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
            styleUI.add(layer, 'minAngleRange', layer.minAngleRange, layer.maxAngleRange).name('Angle min')
                .onChange((value) => {
                    if (value >= layer.maxAngleRange) {
                        layer.maxAngleRange = value + 1;
                        getController(datUi, 'maxAngleRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
            styleUI.add(layer, 'maxAngleRange', layer.minAngleRange, layer.maxAngleRange).name('Angle max')
                .onChange((value) => {
                    if (value <= layer.minAngleRange) {
                        layer.minAngleRange = value - 1;
                        getController(datUi, 'minAngleRange').updateDisplay();
                    }
                    setupControllerVisibily(datUi, layer.material.mode);
                    view.notifyChange(layer, true);
                });
        }
        if (layer.material.shape != undefined) {
            styleUI.add(layer.material, 'shape', PNTS_SHAPE).name('Shape mode').onChange(update);
        }
        styleUI.add(layer, 'opacity', 0, 1).name('Layer Opacity').onChange(update);
        styleUI.add(layer, 'pointSize', 0, 15).name('Point Size').onChange(update);
        if (layer.material.sizeMode != undefined) {
            styleUI.add(layer.material, 'sizeMode', PNTS_SIZE_MODE).name('Point size mode').onChange(() => {
                update();
            });
        }
        styleUI.add(layer.material, 'minAttenuatedSize', 0, 15).name('Min attenuated size').onChange(update);
        styleUI.add(layer.material, 'maxAttenuatedSize', 0, 15).name('Max attenuated size').onChange(update);
        if (layer.material.picking != undefined) {
            styleUI.add(layer.material, 'picking').name('Display picking id').onChange(update);
        }

        // UI
        const debugUI = layer.debugUI.addFolder('Debug');
        debugUI.add(layer.bboxes, 'visible').name('Display Bounding Boxes').onChange(update);
        debugUI.add(layer, 'dbgStickyNode').name('Sticky node name').onChange(update);
        debugUI.add(layer, 'dbgDisplaySticky').name('Display sticky node').onChange(update);
        debugUI.add(layer, 'dbgDisplayChildren').name('Display children of sticky node').onChange(update);
        debugUI.add(layer, 'dbgDisplayParents').name('Display parents of sticky node').onChange(update);

        setupControllerVisibily(datUi, layer.material.mode);

        const isInHierarchy = function isInHierarchy(name1, name2) {
            return (layer.dbgDisplaySticky && name1 === name2)
                || (layer.dbgDisplayParents && name1.startsWith(name2))
                || (layer.dbgDisplayChildren && name2.startsWith(name1));
        };

        view.addFrameRequester('before_layer_update', () => {
            if (layer.dbgStickyNode.length) {
                layer.displayedCount = 0;
                const stickies = layer.dbgStickyNode.split(',');
                for (const pts of layer.group.children) {
                    pts.visible = stickies.some(name => isInHierarchy(name, pts.owner.name));
                    if (pts.boxHelper) {
                        pts.boxHelper.visible = pts.visible;
                    }
                    if (pts.visible) {
                        layer.displayedCount += pts.geometry.attributes.position.count;
                    }
                }
            }
        });
    },
};
