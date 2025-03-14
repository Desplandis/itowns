import { Color } from 'three';
import { LRUCache } from 'lru-cache';
import { deltaE } from 'Renderer/Color';
import { loadImage, cropImage } from 'Core/Style/Icon';

const canvas = document.createElement('canvas');
const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGMatrix();

const cachedImg: LRUCache<string, ImageData> = new LRUCache({ max: 500 });

const textAnchorPosition = {
    left: [0, -0.5],
    right: [-1, -0.5],
    top: [-0.5, 0],
    bottom: [-0.5, -1],
    'top-right': [-1, 0],
    'bottom-left': [0, -1],
    'bottom-right': [-1, -1],
    center: [-0.5, -0.5],
    'top-left': [0, 0],
};

export function cropImage2(
    img: HTMLImageElement,
    cropValues: { x: number, y: number, width: number, height: number },
): ImageData {
    const x = cropValues.x || 0;
    const y = cropValues.y || 0;
    const width = cropValues.width || img.naturalWidth;
    const height = cropValues.height || img.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(img,
        x, y, width, height,
        0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
}

/**
 * Applies the style.fill to a polygon of the texture canvas.
 * @param {CanvasRenderingContext2D} txtrCtx The Context 2D of the texture canvas.
 * @param {Style} style The current style
 * @param {Path2D} polygon The current texture canvas polygon.
 * @param {Number} invCtxScale The ratio to scale line width and radius circle.
 * @param {Boolean} canBeFilled - true if feature.type == FEATURE_TYPES.POLYGON.
 */
export function applyToCanvasPolygon(txtrCtx, style, polygon, invCtxScale, canBeFilled) {
    // draw line or edge of polygon
    if (style.stroke.width > 0) {
        // TO DO add possibility of using a pattern (https://github.com/iTowns/itowns/issues/2210)
        _applyStrokeToPolygon(txtrCtx, style, invCtxScale, polygon);
    }

    // fill inside of polygon
    if (canBeFilled && (style.fill.pattern || style.fill.color)) {
        // canBeFilled can be move to StyleContext in the later PR
        _applyFillToPolygon(txtrCtx, style, invCtxScale, polygon);
    }
}

function _applyStrokeToPolygon(txtrCtx, style, invCtxScale, polygon) {
    if (txtrCtx.strokeStyle !== style.stroke.color) {
        txtrCtx.strokeStyle = style.stroke.color;
    }
    const width = style.stroke.width * invCtxScale;
    if (txtrCtx.lineWidth !== width) {
        txtrCtx.lineWidth = width;
    }
    const alpha = style.stroke.opacity;
    if (alpha !== txtrCtx.globalAlpha && typeof alpha == 'number') {
        txtrCtx.globalAlpha = alpha;
    }
    if (txtrCtx.lineCap !== style.stroke.lineCap) {
        txtrCtx.lineCap = style.stroke.lineCap;
    }
    txtrCtx.setLineDash(style.stroke.dasharray.map(a => a * invCtxScale * 2));
    txtrCtx.stroke(polygon);
}

async function _applyFillToPolygon(
    txtrCtx: CanvasRenderingContext2D,
    style: any,
    invCtxScale: number,
    polygon: Path2D,
) {
    // if (this.fill.pattern && txtrCtx.fillStyle.src !== this.fill.pattern.src) {
    // need doc for the txtrCtx.fillStyle.src that seems to always be undefined
    if (style.fill.pattern) {
        let img: HTMLImageElement = style.fill.pattern;
        const cropValues = { ...style.fill.pattern.cropValues };
        if (style.fill.pattern.source) {
            img = await loadImage(style.fill.pattern.source);
        }
        // TODO[QB]: Do not crop image if not need, add condition
        // TODO[QB]: Cache the pattern?
        const pattern = txtrCtx.createPattern(
            cropValues ? cropImage(img, cropValues) : img,
            'repeat'
        ) as CanvasPattern;

        // At this point, we can guarantee that the image is fully loaded,
        // we can then assume that createPattern cannot return a null value
        txtrCtx.fillStyle = pattern;
        if (txtrCtx.fillStyle.setTransform) {
            txtrCtx.fillStyle.setTransform(matrix.scale(invCtxScale));
        } else {
            console.warn('Raster pattern isn\'t completely supported on Ie and edge', txtrCtx.fillStyle);
        }
    } else if (txtrCtx.fillStyle !== style.fill.color) {
        txtrCtx.fillStyle = style.fill.color;
    }
    if (style.fill.opacity !== txtrCtx.globalAlpha) {
        txtrCtx.globalAlpha = style.fill.opacity;
    }
    txtrCtx.fill(polygon);
}

// Function for apply SDF as a true image
function replaceWhitePxl(imgd: ImageData, color?: Color, id?: string) {
    if (!color) {
        return imgd;
    }
    const imgdColored = cachedImg.get(`${id}_${color}`);
    if (!imgdColored) {
        const pix = imgd.data;
        const newColor = new Color(color);
        const colorToChange = new Color('white');
        for (let i = 0, n = pix.length; i < n; i += 4) {
            const d = deltaE(pix.slice(i, i + 3), colorToChange) / 100;
            pix[i] = (pix[i] * d +  newColor.r * 255 * (1 - d));
            pix[i + 1] = (pix[i + 1] * d +  newColor.g * 255 * (1 - d));
            pix[i + 2] = (pix[i + 2] * d +  newColor.b * 255 * (1 - d));
        }
        cachedImg.set(`${id}_${color}`, imgd);
        return imgd;
    }
    return imgdColored;
}

function _addIcon(icon, domElement, opt) {
    const cIcon = icon.cloneNode();

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

    cIcon.style['z-index'] = -1;
    domElement.appendChild(cIcon);
    return cIcon;
}

/**
 * Applies this style to a DOM element. Limited to the `text` and `icon`
 * properties of this style.
 *
 * @param {Style} style - style to apply
 * @param {Element} domElement - The element to set the style to.
 *
 * @returns {undefined|Promise<HTMLImageElement>}
 *          for a text label: undefined.
 *          for an icon: a Promise resolving with the HTMLImageElement containing the image.
 */
export async function applyToHTML(style, domElement) {
    domElement.style.padding = `${style.text.padding}px`;
    domElement.style.maxWidth = `${style.text.wrap}em`;

    domElement.style.color = style.text.color;
    if (style.text.size > 0) {
        domElement.style.fontSize = `${style.text.size}px`;
    }
    domElement.style.fontFamily = style.text.font.join(',');
    domElement.style.textTransform = style.text.transform;
    domElement.style.letterSpacing = `${style.text.spacing}em`;
    domElement.style.textAlign = style.text.justify;
    domElement.style['white-space'] = 'pre-line';

    if (style.text.haloWidth > 0) {
        domElement.style.setProperty('--text_stroke_display', 'block');
        domElement.style.setProperty('--text_stroke_width', `${style.text.haloWidth}px`);
        domElement.style.setProperty('--text_stroke_color', style.text.haloColor);
        domElement.setAttribute('data-before', domElement.textContent);
    }

    if (!style.icon.source) {
        return;
    }

    const icon = document.createElement('img');

    const iconPromise = new Promise((resolve, reject) => {
        const opt = {
            size: style.icon.size,
            color: style.icon.color,
            opacity: style.icon.opacity,
            anchor: style.icon.anchor,
        };
        icon.onload = () => resolve(_addIcon(icon, domElement, opt));
        icon.onerror = err => reject(err);
    });

    if (!style.icon.cropValues && !style.icon.color) {
        icon.src = style.icon.source;
    } else {
        const cropValues = { ...style.icon.cropValues };
        const color = style.icon.color;
        const id = style.icon.id || style.icon.source;
        const img = await loadImage(style.icon.source);
        const canvas = cropImage(img, cropValues);
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
        console.log(color);
        const imgdColored = replaceWhitePxl(imgd, color, id);
        ctx.putImageData(imgdColored, 0, 0);
        icon.src = canvas.toDataURL('image/png');
    }
    return iconPromise;
}

/**
 * Gets the values corresponding to the anchor of the text. It is
 * proportions, to use with a `translate()` and a `transform` property.
 *
 * @param {Style} style - style to apply
 * @return {Number[]} Two percentage values, for x and y respectively.
 */
export function getTextAnchorPosition(style) {
    if (typeof style.text.anchor === 'string') {
        if (Object.keys(textAnchorPosition).includes(style.text.anchor)) {
            return textAnchorPosition[style.text.anchor];
        } else {
            console.error(`${style.text.anchor} is not a valid input for Style.text.anchor parameter.`);
            return textAnchorPosition.center;
        }
    } else {
        return style.text.anchor;
    }
}
