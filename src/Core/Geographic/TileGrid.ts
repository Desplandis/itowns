import * as THREE from 'three';

import CRS, { ProjectionLike } from './Crs';
import Coordinates from './Coordinates';
import Extent from './Extent';

const _dim2 = new THREE.Vector2();
const _countTiles = new THREE.Vector2();
const _tmsCoord = new THREE.Vector2();
const _dimensionTile = new THREE.Vector2();
const _extent = new Extent('EPSG:4326', [0, 0, 0, 0]);
const _extent2 = new Extent('EPSG:4326', [0, 0, 0, 0]);
const _c = new Coordinates('EPSG:4326', 0, 0);

export const globalExtentTMS = new Map<ProjectionLike, Extent>();
export const schemeTiles = new Map<ProjectionLike, THREE.Vector2>();

export function getInfoTms(crs: ProjectionLike) {
    const epsg = CRS.formatToEPSG(crs);
    const globalExtent = globalExtentTMS.get(epsg) as Extent;
    const globalDimension = globalExtent!.planarDimensions(_dim2);
    const tms = CRS.formatToTms(crs);
    const sTs = schemeTiles.get(tms) || schemeTiles.get('default') as THREE.Vector2;
    // The isInverted parameter is to be set to the correct value, true or false
    // (default being false) if the computation of the coordinates needs to be
    // inverted to match the same scheme as OSM, Google Maps or other system.
    // See link below for more information
    // https://alastaira.wordpress.com/2011/07/06/converting-tms-tile-coordinates-to-googlebingosm-tile-coordinates/
    // in crs includes ':NI' => tms isn't inverted (NOT INVERTED)
    const isInverted = !tms.includes(':NI');
    return { epsg, globalExtent, globalDimension, sTs, isInverted };
}

export function getCountTiles(crs: ProjectionLike, zoom: number): THREE.Vector2 {
    const sTs = schemeTiles.get(CRS.formatToTms(crs)) || schemeTiles.get('default') as THREE.Vector2;
    const count = 2 ** zoom;
    _countTiles.set(count, count).multiply(sTs);
    return _countTiles;
}

/**
 * get tiled extents convering this extent
 *
 * @param      {string}  crs WMTS, TMS crs
 * @return     {Array<Extent>}   array of extents covering
 */
export function tiledCovering(e: Extent, tms: string): any[] /* TODO[QB] */ {
    if (e.crs == 'EPSG:4326' && tms == CRS.tms_3857) {
        const extents_WMTS_PM: Extent[] = [];
        const extent = _extent.copy(e).as(CRS.formatToEPSG(tms), _extent2);
        const { globalExtent, globalDimension, sTs } = getInfoTms(CRS.formatToEPSG(tms));
        extent.clampByExtent(globalExtent);
        extent.planarDimensions(_dimensionTile);

        const zoom = (e.zoom + 1) || Math.floor(Math.log2(Math.round(globalDimension.x / (_dimensionTile.x * sTs.x))));
        const countTiles = getCountTiles(tms, zoom);
        const center = extent.center(_c);

        _tmsCoord.x = center.x - globalExtent.west!;
        _tmsCoord.y = globalExtent.north! - extent.north!;
        _tmsCoord.divide(globalDimension).multiply(countTiles).floor();

        // ]N; N+1] => N
        const maxRow = Math.ceil((globalExtent.north! - extent.south!) / globalDimension.x * countTiles.y) - 1;

        for (let r = maxRow; r >= _tmsCoord.y; r--) {
            extents_WMTS_PM.push(new Extent(tms, zoom, r, _tmsCoord.x));
        }

        return extents_WMTS_PM;
    } else {
        const target = new Extent(tms, 0, 0, 0);
        const { globalExtent, globalDimension, sTs, isInverted } = getInfoTms(e.crs);
        const center = e.center(_c);
        e.planarDimensions(_dimensionTile);
        // Each level has 2^n * 2^n tiles...
        // ... so we count how many tiles of the same width as tile we can fit in the layer
        // ... 2^zoom = tilecount => zoom = log2(tilecount)
        const zoom = Math.floor(Math.log2(Math.round(globalDimension.x / (_dimensionTile.x * sTs.x))));
        const countTiles = getCountTiles(tms, zoom);

        // Now that we have computed zoom, we can deduce x and y (or row / column)
        _tmsCoord.x = center.x - globalExtent.west!;
        _tmsCoord.y = isInverted ? globalExtent.north! - center.y : center.y - globalExtent.south!;
        _tmsCoord.divide(globalDimension).multiply(countTiles).floor();
        target.set(zoom, _tmsCoord.y, _tmsCoord.x);
        return [target];
    }
}

const extent4326 = new Extent('EPSG:4326', -180, 180, -90, 90);
globalExtentTMS.set('EPSG:4326', extent4326);

// Compute global extent of TMS in EPSG:3857
// It's square whose a side is between -180° to 180°.
// So, west extent, it's 180 convert in EPSG:3857
const extent3857 = extent4326.as('EPSG:3857');
extent3857.clampSouthNorth(extent3857.west, extent3857.east);
globalExtentTMS.set('EPSG:3857', extent3857);

const defaultScheme = new THREE.Vector2(1, 1);
schemeTiles.set('default', defaultScheme);
schemeTiles.set(CRS.tms_3857, defaultScheme);
schemeTiles.set(CRS.tms_4326, new THREE.Vector2(2, 1));