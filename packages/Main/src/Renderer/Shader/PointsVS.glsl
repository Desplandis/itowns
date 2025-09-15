#include <common>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vColor; // color_pars_vertex

#ifdef USE_POINTS_UV
    varying vec2 vUv;
    uniform mat3 uvTransform;
#endif

#define SOURCE_ID_GROUP 8.

uniform float size;
uniform float scale;

uniform bool picking;
uniform int mode;

uniform vec2 range;

uniform bool sizeAttenuation;
uniform float minAttenuatedSize;
uniform float maxAttenuatedSize;

attribute vec4 unique_id;
attribute float intensity;
attribute float classification;
attribute float pointSourceID;

attribute float returnNumber;
attribute float numberOfReturns;
attribute float scanAngle;

varying vec2 vUv;
out vec2 vUv1;

void main() {
    vColor = vec3(1.0);
    if (picking) {
        vColor = unique_id.xyz;
    } else {
        if (mode == PNTS_MODE_CLASSIFICATION) {
            vUv = vec2(classification/255., 0.5);
        } else if (mode == PNTS_MODE_NORMAL) {
            vColor.rgb = abs(normal);
        } else if (mode == PNTS_MODE_COLOR) {
#include <color_vertex>
        } else if (mode == PNTS_MODE_RETURN_NUMBER) {
            vUv = vec2(returnNumber/255., 0.5);
        } else if (mode == PNTS_MODE_RETURN_TYPE) {
            float returnType;
            if (returnNumber > numberOfReturns) {
                returnType = 4.;
            } else if (returnNumber == 1.) {
                if (numberOfReturns == 1.) {
                    // single
                    returnType = 0.;
                } else {
                    // first
                    returnType = 1.;
                }
            } else {
                if (returnNumber == numberOfReturns) {
                    // last
                    returnType = 3.;
                } else {
                    // intermediate
                    returnType = 2.;
                }
            }
            vUv = vec2(returnType/255., 0.5);
        } else if (mode == PNTS_MODE_RETURN_COUNT) {
            vUv = vec2(numberOfReturns/255., 0.5);
        } else if (mode == PNTS_MODE_POINT_SOURCE_ID) {
            vUv = vec2(mod(pointSourceID, SOURCE_ID_GROUP)/255., 0.5);
        } else if (mode == PNTS_MODE_SCAN_ANGLE) {
            float i = (scanAngle - range.x) / (range.y - range.x);
            vUv = vec2(i, (1. - i));
        } else if (mode == PNTS_MODE_INTENSITY) {
            float i = (intensity - range.x) / (range.y - range.x);
            vUv = vec2(i, (1. - i));
        } else if (mode == PNTS_MODE_ELEVATION) {
            float z = (modelMatrix * vec4(position, 1.0)).z;
            float i = (z - range.x) / (range.y - range.x);
            vUv = vec2(i, (1. - i));
        }
    }
#include <morphinstance_vertex>
#include <morphcolor_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <project_vertex>

    gl_PointSize = size;

    if (sizeAttenuation) {
        bool isPerspective = isPerspectiveMatrix(projectionMatrix);

        if (isPerspective) {
            gl_PointSize *= scale / -mvPosition.z;
            gl_PointSize = clamp(gl_PointSize, minAttenuatedSize, maxAttenuatedSize);
        }
    }

#include <logdepthbuf_vertex>
#include <clipping_planes_vertex>
#include <worldpos_vertex>
#include <fog_vertex>
}
