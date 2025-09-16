#define USE_POINTS_UV // TODO: fix

#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

uniform vec3 diffuse;
uniform float opacity;
uniform float gamma;
uniform float ambientBoost;

uniform bool picking;
uniform int shape;

in vec2 vUv1;

void main() {

    // Early discard (clipping planes and shape)
#include <clipping_planes_fragment>
    if (shape == PNTS_SHAPE_CIRCLE) {
        //circular rendering in glsl
        if ((length(gl_PointCoord - 0.5) > 0.5)) {
            discard;
        }
    }

    // Assign diffuseColor
    vec4 diffuseColor = vec4(diffuse, opacity);
#if defined(USE_MAP) || defined(USE_ALPHAMAP)
    #if defined(USE_POINTS_UV)
	vec2 uv = vUv;
    #else
	vec2 uv = (uvTransform * vec3(gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1)).xy;
    #endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D(map, uv);
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D(alphaMap, vUv1).r;
#endif
#include <color_fragment>

    // Alpha discards (alpha test, alpha to coverage and alpha hash)
#include <alphatest_fragment>
#include <alphahash_fragment>

    // Assign gl_FragDepth
#include <logdepthbuf_fragment>

    // Assign gl_FragColor
    vec3 outgoingLight = diffuseColor.rgb;

    outgoingLight = max(outgoingLight, vec3(ambientBoost));

    outgoingLight = pow(outgoingLight, vec3(1.0 / gamma));

#include <opaque_fragment> // alpha component
#include <tonemapping_fragment>
#include <fog_fragment>
#include <premultiplied_alpha_fragment>

}
