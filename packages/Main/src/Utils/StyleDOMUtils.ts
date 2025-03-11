import { LRUCache } from 'lru-cache';
import type * as THREE from 'three';

import Fetcher from 'Provider/Fetcher';
import { TextStyle, Style } from 'Core/StyleOptions';

const _texturesCache = new LRUCache({ max: 500 });

function _addIcon(icon: HTMLImageElement, domElement: HTMLElement, opt) {
    const cIcon = icon.cloneNode() as HTMLImageElement;

    cIcon.setAttribute('class', 'itowns-icon');

    cIcon.width = icon.width * opt.size;
    cIcon.height = icon.height * opt.size;
    cIcon.style.color = opt.color;
    cIcon.style.opacity = opt.opacity;
    cIcon.style.position = 'absolute';
    cIcon.style.top = '0';
    cIcon.style.left = '0';

    switch (opt.anchor) { // center by default
        case 'left':
            cIcon.style.top = `${-0.5 * cIcon.height}px`;
            break;
        case 'right':
            cIcon.style.top = `${-0.5 * cIcon.height}px`;
            cIcon.style.left = `${-cIcon.width}px`;
            break;
        case 'top':
            cIcon.style.left = `${-0.5 * cIcon.width}px`;
            break;
        case 'bottom':
            cIcon.style.top = `${-cIcon.height}px`;
            cIcon.style.left = `${-0.5 * cIcon.width}px`;
            break;
        case 'bottom-left':
            cIcon.style.top = `${-cIcon.height}px`;
            break;
        case 'bottom-right':
            cIcon.style.top = `${-cIcon.height}px`;
            cIcon.style.left = `${-cIcon.width}px`;
            break;
        case 'top-left':
            break;
        case 'top-right':
            cIcon.style.left = `${-cIcon.width}px`;
            break;
        case 'center':
        default:
            cIcon.style.top = `${-0.5 * cIcon.height}px`;
            cIcon.style.left = `${-0.5 * cIcon.width}px`;
            break;
    }

    // TODO[QB]: Is this valid?
    cIcon.style['z-index'] = -1;
    domElement.appendChild(cIcon);
    return cIcon;
}

export async function loadImage(url: string): Promise<THREE.Texture> {
    const imgUrl = url.split('?')[0];
    let img = _texturesCache.get(imgUrl);
    if (!img) {
        img = await Fetcher.texture(url, { crossOrigin: 'anonymous' });
        _texturesCache.set(imgUrl, img);
    }
    return img;
}

/**
  * Applies this style to a DOM element. Limited to the `text` and `icon`
  * properties of this style.
  *
  * @param {Element} domElement - The element to set the style to.
  *
  * @returns {undefined|Promise<HTMLImageElement>}
  *          for a text label: undefined.
  *          for an icon: a Promise resolving with the HTMLImageElement containing the image.
  */
async function applyToHTML(style: Style, domElement: HTMLElement) {
    const { text, icon } = style as Required<Style>;

    if (arguments.length > 1) {
        console.warn('Deprecated argument sprites. Sprites must be configured in style.');
    }
    domElement.style.padding = `${text.padding}px`;
    domElement.style.maxWidth = `${text.wrap}em`;

    domElement.style.color = text.color;
    if (text.size > 0) {
        domElement.style.fontSize = `${text.size}px`;
    }
    domElement.style.fontFamily = text.font.join(',');
    domElement.style.textTransform = text.transform;
    domElement.style.letterSpacing = `${text.spacing}em`;
    domElement.style.textAlign = text.justify;
    domElement.style['white-space'] = 'pre-line';

    if (this.text.haloWidth > 0) {
        domElement.style.setProperty('--text_stroke_display', 'block');
        domElement.style.setProperty('--text_stroke_width', `${text.haloWidth}px`);
        domElement.style.setProperty('--text_stroke_color', text.haloColor);
        domElement.setAttribute('data-before', domElement.textContent);
    }

    if (!icon.source) {
        return;
    }

    const img = document.createElement('img');

    const iconPromise = new Promise((resolve, reject) => {
        const opt = {
            size: icon.size,
            color: icon.color,
            opacity: icon.opacity,
            anchor: icon.anchor,
        };
        img.onload = () => resolve(_addIcon(img, domElement, opt));
        img.onerror = err => reject(err);
    });

    if (!this.icon.cropValues && !this.icon.color) {
        icon.src = this.icon.source;
    } else {
        const cropValues = { ...this.icon.cropValues };
        const color = this.icon.color;
        const id = this.icon.id || this.icon.source;
        const img = await loadImage(this.icon.source);
        const imgd = cropImage(img, cropValues);
        const imgdColored = replaceWhitePxl(imgd, color, id);
        canvas.getContext('2d').putImageData(imgdColored, 0, 0);
        icon.src = canvas.toDataURL('image/png');
    }
    return iconPromise;
}