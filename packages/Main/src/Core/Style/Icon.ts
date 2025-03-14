import { LRUCache } from 'lru-cache';
import type { Texture } from 'three';
import Fetcher from 'Provider/Fetcher';

// TODO: we should share the canvas context across all iTowns
const canvas = document.createElement('canvas');

// export const DefaultImageCache =
const cachedImg: LRUCache<string, Texture> = new LRUCache({
    max: 500,
});

export async function loadImage(url: string): Promise<HTMLImageElement> {
    const imgUrl = url.split('?')[0];
    let tex = cachedImg.get(imgUrl);
    if (!tex) {
        tex = await Fetcher.texture(url, { crossOrigin: 'anonymous' });
        cachedImg.set(imgUrl, tex);
    }
    return tex.image;
}

export function cropImage(
    img: HTMLImageElement,
    cropValues: { x: number, y: number, width: number, height: number },
): HTMLCanvasElement {
    const x = cropValues.x || 0;
    const y = cropValues.y || 0;
    const width = cropValues.width || img.naturalWidth;
    const height = cropValues.height || img.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    ctx.drawImage(img,
        x, y, width, height,
        0, 0, width, height);
    return canvas;
}