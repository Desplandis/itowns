// import { texture, uv, uvec2, vec4, positionWorld, attribute, fract, range, hash } from 'three/tsl';
// eslint-disable-next-line import/no-unresolved
import { vec4, uniform, texture, mix } from 'three/tsl';
import { chooseNextLevelToFetch } from 'Layer/LayerUpdateStrategy';
import LayerUpdateState from 'Layer/LayerUpdateState';
import handlingError from 'Process/handlerNodeError';

function materialCommandQueuePriorityFunction(material) {
    // We know that 'node' is visible because commands can only be
    // issued for visible nodes.
    // TODO: need priorization of displayed nodes
    // Then prefer displayed node over non-displayed one
    return material.visible ? 100 : 10;
}

function refinementCommandCancellationFn(cmd) {
    if (!cmd.requester.parent || !cmd.requester.material) {
        return true;
    }
    // Cancel the command if the tile already has a better texture.
    // This is only needed for elevation layers, because we may have several
    // concurrent layers but we can only use one texture.
    if (cmd.layer.isElevationLayer && cmd.requester.material.getElevationTile() &&
        cmd.targetLevel <= cmd.requester.material.getElevationTile().level) {
        return true;
    }

    // Cancel the command if the layer was removed between command scheduling and command execution
    if (!cmd.requester.layerUpdateState[cmd.layer.id]
        || !cmd.layer.source._featuresCaches[cmd.layer.crs]) {
        return true;
    }

    return !cmd.requester.material.visible;
}

function buildCommand(view, layer, extentsSource, extentsDestination, requester) {
    return {
        view,
        layer,
        extentsSource,
        extentsDestination,
        requester,
        priority: materialCommandQueuePriorityFunction(requester.material),
        earlyDropFunction: refinementCommandCancellationFn,
        partialLoading: true,
    };
}

function computePitchs(textures, extentsDestination) {
    return extentsDestination
        .map((ext, i) => (ext.offsetToParent(textures[i].extent)));
}

export function updateLayeredMaterialNodeImagery(context, layer, node, parent) {
    const material = node.material;
    // material.outputNode = vec4(1.0, 0.0, 0.0, 1.0);

    if (!parent || !material) {
        return;
    }
    const extentsDestination = node.getExtentsByProjection(layer.crs);

    const zoom = extentsDestination[0].zoom;
    if (zoom > layer.zoom.max || zoom < layer.zoom.min) {
        return;
    }

    let nodeLayer = material.getTile(layer.id);

    // Initialisation
    if (node.layerUpdateState[layer.id] === undefined) {
        node.layerUpdateState[layer.id] = new LayerUpdateState();

        if (!layer.source.extentInsideLimit(node.extent, zoom)) {
            // we also need to check that tile's parent doesn't have a texture for this layer,
            // because even if this tile is outside of the layer, it could inherit it's
            // parent texture
            if (!layer.noTextureParentOutsideLimit &&
                parent.material &&
                parent.material.getTile &&
                parent.material.getTile(layer.id)) {
                // ok, we're going to inherit our parent's texture
            } else {
                node.layerUpdateState[layer.id].noMoreUpdatePossible();
                return;
            }
        }

        if (!nodeLayer) {
            // Create new raster node
            nodeLayer = layer.setupRasterNode(node);

            // Init the node by parent
            const parentLayer = parent.material?.getTile(layer.id);
            nodeLayer.initFromParent(parentLayer, extentsDestination);
        }

        // Proposed new process, two separate processes:
        //      * FIRST PASS: initNodeXXXFromParent and get out of the function
        //      * SECOND PASS: Fetch best texture

        // The two-step allows you to filter out unnecessary requests
        // Indeed in the second pass, their state (not visible or not displayed) can block them to fetch
        if (nodeLayer.level >= layer.source.zoom.min) {
            context.view.notifyChange(node, false);
            return;
        }
    }

    // Node is hidden, no need to update it
    if (!material.visible) {
        return;
    }

    // An update is pending / or impossible -> abort
    if (!layer.visible || !node.layerUpdateState[layer.id].canTryUpdate()) {
        return;
    }

    if (nodeLayer.level >= extentsDestination[0].zoom) {
        // default decision method
        node.layerUpdateState[layer.id].noMoreUpdatePossible();
        return;
    }

    // is fetching data from this layer disabled?
    if (layer.frozen) {
        return;
    }

    const failureParams = node.layerUpdateState[layer.id].failureParams;
    const destinationLevel = extentsDestination[0].zoom || node.level;
    const targetLevel = chooseNextLevelToFetch(layer.updateStrategy.type, node, destinationLevel, nodeLayer.level, layer, failureParams);

    if ((!layer.source.isVectorSource && targetLevel <= nodeLayer.level) || targetLevel > destinationLevel) {
        if (failureParams.lowestLevelError != Infinity) {
            // this is the highest level found in case of error.
            node.layerUpdateState[layer.id].noMoreUpdatePossible();
        }
        return;
    } else if (!layer.source.extentInsideLimit(node.extent, targetLevel)) {
        node.layerUpdateState[layer.id].noData({ targetLevel });
        context.view.notifyChange(node, false);
        return;
    }

    const extentsSource = extentsDestination.map(e => e.tiledExtentParent(targetLevel));
    node.layerUpdateState[layer.id].newTry();
    const command = buildCommand(context.view, layer, extentsSource, extentsDestination, node);

    return context.scheduler.execute(command).then(
        (results) => {
            // material.dynColor.value.set(0.0, 1.0, 0.0, 1.0);
            // console.log('material');
            // Does nothing if the layer has been removed while command was being or waiting to be executed
            if (!node.layerUpdateState[layer.id]) {
                return;
            }
            const textures = results.map((texture, index) => (texture != null ? texture :
                { isTexture: false, extent: extentsDestination[index] }));
            // TODO: Handle error : result is undefined in provider. throw error
            const pitchs = computePitchs(textures, extentsDestination);
            nodeLayer.setTextures(textures, pitchs);
            node.layerUpdateState[layer.id].success();


            if (textures[0]) {
                material.colors.values[0].node.value = textures[0];
                textures[0].needsUpdate = true;
            }

            if (textures[1]) {
                material.colors.values[1].node.value = textures[1];
                textures[1].needsUpdate = true;
            }

            if (textures[2]) {
                material.colors.values[2].node.value = textures[2];
                textures[2].needsUpdate = true;
            }
        },
        err => handlingError(err, node, layer, targetLevel, context.view));
}

export function updateLayeredMaterialNodeElevation(/* context, layer, node, parent */) {
}

export function removeLayeredMaterialNodeTile(tileId) {
    /**
     * @param {TileMesh} node - The node to udpate.
     */
    return function removeLayeredMaterialNodeTile(node) {
        if (node.material?.removeTile) {
            if (node.material.elevationTile !== undefined) {
                node.setBBoxZ({ min: 0, max: 0 });
            }
            node.material.removeTile(tileId);
        }
        if (node.layerUpdateState && node.layerUpdateState[tileId]) {
            delete node.layerUpdateState[tileId];
        }
    };
}
