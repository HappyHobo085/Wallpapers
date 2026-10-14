#version 440

// ---------------------------------------------------------------------------
//  HYPERLANE  —  a live sci-fi wallpaper for Plasma 6
//  Flying down a neon service corridor
// ---------------------------------------------------------------------------

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// qt_Matrix and qt_Opacity must stay first (offsets 0 and 64) to match the
// built-in vertex shader's uniform block.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float u_time;
    float u_aspect;
    // Look controls. main.qml drives them from the wallpaper configuration
    // panel; tools/render.py bakes the same defaults for offscreen previews.
    float u_zspeed;   // forward speed, units per second
    float u_focal;    // lower = wider field of view
    float u_rib;      // spacing of the cross ribs
    float u_ring;     // spacing of the light rings
    float u_tmax;     // how far we see before the fog takes over
    float u_zwrap;    // world period along z. Derived as 40 * Rib * Ring by
                      // main.qml and render.py so it stays a multiple of
                      // u_rib and u_ring; otherwise wrapping the camera
                      // would visibly shift them.
};

#define R       1.0      // corridor half-width

// --- hashes ---------------------------------------------------------------
float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
}

// --- palette --------------------------------------------------------------
// Four hand-picked stops: cyan -> blue -> violet -> magenta.
vec3 palette(float x) {
    const vec3 c0 = vec3(0.05, 0.85, 1.00);
    const vec3 c1 = vec3(0.12, 0.38, 1.00);
    const vec3 c2 = vec3(0.62, 0.20, 1.00);
    const vec3 c3 = vec3(1.00, 0.28, 0.72);
    x = clamp(x, 0.0, 0.9999) * 3.0;
    if (x < 1.0) return mix(c0, c1, x);
    if (x < 2.0) return mix(c1, c2, x - 1.0);
    return mix(c2, c3, x - 2.0);
}

// --- geometry -------------------------------------------------------------
vec3 faceNormal(float face) {
    if (face < 0.5) return vec3( 1.0,  0.0, 0.0);
    if (face < 1.5) return vec3(-1.0,  0.0, 0.0);
    if (face < 2.5) return vec3( 0.0,  1.0, 0.0);
    return vec3(0.0, -1.0, 0.0);
}

// Distance along the ray to the corridor wall. Writes the face id and the
// coordinate along that face.
float corridorHit(vec3 ro, vec3 rd, out float face, out float u) {
    float sx = rd.x >= 0.0 ? 1.0 : -1.0;
    float sy = rd.y >= 0.0 ? 1.0 : -1.0;
    float tx = (sx * R - ro.x) / (abs(rd.x) < 1e-4 ? 1e-4 : rd.x);
    float ty = (sy * R - ro.y) / (abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
    if (abs(rd.x) >= abs(rd.y)) {
        face = rd.x >= 0.0 ? 0.0 : 1.0;
        u = ro.y + tx * rd.y;
        return tx;
    }
    face = rd.y >= 0.0 ? 2.0 : 3.0;
    u = ro.x + ty * rd.x;
    return ty;
}

// Thin bright line at every multiple of period, with a soft halo.
float stripe(float x, float period, float width, float halo) {
    float k = mod(x, period);
    float d = min(k, period - k);
    return (1.0 - smoothstep(0.0, width, d)) + 0.28 * (1.0 - smoothstep(0.0, halo, d));
}

// --- wall surface ---------------------------------------------------------
// uv.x runs along the face, uv.y down the corridor. Returns emissive colour.
vec3 wallGlow(vec2 uv, float face, float dist) {
    // Fade fine detail with distance so it does not shimmer.
    float lod = 1.0 - smoothstep(6.0, 26.0, dist);
    float u = uv.x;
    float z = uv.y;

    // Dark composite panels with a faint sheen.
    vec3 col = vec3(0.013, 0.017, 0.032) * (0.85 + 0.3 * hash21(floor(uv * vec2(9.0, 3.0))));

    // --- lit panels: one cell per rib bay, a few of them switched on ------
    vec2 cell = vec2(u * 2.0, z / u_rib);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float rnd = hash21(id + face * 13.7);
    float inset = step(0.12, f.x) * step(f.x, 0.88) * step(0.18, f.y) * step(f.y, 0.82);
    if (rnd > 0.58) {
        // A cluster of lit slots, like a control panel, not a flat slab.
        vec2 slot = floor(f * vec2(3.0, 2.0));
        vec2 sf = fract(f * vec2(3.0, 2.0));
        float lit = step(0.45, hash21(id * 3.1 + slot + face * 7.0));
        float shape = step(0.15, sf.x) * step(sf.x, 0.85) * step(0.2, sf.y) * step(sf.y, 0.8);
        float glow = 0.6 + 0.4 * sin(u_time * (0.8 + rnd * 3.0) + rnd * 40.0);
        vec3 tint = palette(0.12 + 0.75 * hash21(id * 1.7 + face));
        col += tint * inset * shape * lit * glow * 0.26 * lod;
        // Faint backlight for the whole panel.
        col += tint * inset * 0.045 * lod;
    }

    // --- cross ribs: the strongest depth cue, they fly past ---------------
    float rib = stripe(z, u_rib, 0.045, 0.22);
    col += mix(palette(clamp(0.15 + z * 0.05, 0.0, 1.0)), vec3(0.8, 0.95, 1.0), 0.3)
         * rib * (0.30 + 0.25 * lod);

    // --- longitudinal rails: perspective lines running to the core --------
    float rail = stripe(abs(u) * 2.0, 1.0, 0.035, 0.16);
    col += palette(0.25 + 0.5 * hash11(floor(abs(u) * 2.0))) * rail * (0.30 + 0.2 * lod);

    // --- hot edges where the walls meet ----------------------------------
    float edge = 1.0 - smoothstep(0.0, 0.022, R - abs(u));
    col += vec3(0.55, 0.85, 1.0) * edge * 0.28;

    // --- light rings sweeping toward us ----------------------------------
    float zk = mod(z, u_ring);
    float ring = exp(-min(zk, u_ring - zk) * min(zk, u_ring - zk) * 0.55);
    col += vec3(0.45, 0.75, 1.0) * ring * 0.30;

    return col * (0.35 + 0.65 * lod);
}

// Emissive light arriving from one wall hit.
vec3 shadeHit(vec3 ro, vec3 rd, float t, float face, float u) {
    if (t > u_tmax) {
        return vec3(0.0);
    }
    vec3 p = ro + rd * t;
    vec3 col = wallGlow(vec2(u, mod(p.z, u_zwrap)), face, t);

    // Grazing angles catch a bit more light: cheap fresnel sheen.
    col *= 0.7 + 0.7 * (1.0 - abs(dot(rd, faceNormal(face))));

    // The floor is polished: bounce one ray off it.
    if (face == 3.0 && rd.y < 0.0) {
        vec3 rr = vec3(rd.x, -rd.y, rd.z);
        float rf, ru;
        float t2 = corridorHit(p + rr * 0.002, rr, rf, ru);
        if (t2 < u_tmax) {
            vec3 p2 = p + rr * (t2 + 0.002);
            col += wallGlow(vec2(ru, mod(p2.z, u_zwrap)), rf, t2)
                 * 0.35 * (1.0 - smoothstep(0.0, 24.0, t2));
        }
    }
    return col;
}

// Radial light streaks streaming out of the core: the hyperspace cue.
vec3 warpStreaks(vec2 uv, float t) {
    float a = atan(uv.y, uv.x);
    float r = length(uv);
    float sector = floor(a * 38.0 / 3.14159265);
    float h = hash11(sector * 1.37);
    float len = fract(h + t * 0.9);
    float body = smoothstep(len, len - 0.55, r) * step(0.55, h);
    return mix(vec3(0.4, 0.7, 1.0), vec3(0.8, 0.5, 1.0), h)
         * body * (1.0 - smoothstep(0.05, 0.5, r)) * 0.5;
}

// --- hyperdrive core --------------------------------------------------
vec3 hyperdriveCore(vec2 uv, float t) {
    float r = length(uv);
    // The core breathes at its own slow rate.
    float pulse = 0.84 + 0.08 * sin(t * 2.1);
    pulse *= 0.7 + 0.3 * sin(pulse * 3.14159);
    vec3 coreCol = vec3(0.85, 0.94, 1.0) * exp(-r * 11.0) * 1.1 * pulse;
    coreCol += vec3(0.40, 0.60, 1.0) * exp(-r * 3.0) * 0.16 * pulse;
    // Anamorphic flare bar across the core - also reacts to band
    coreCol += vec3(0.45, 0.70, 1.0) * exp(-abs(uv.y) * 90.0) * exp(-abs(uv.x) * 1.6) * 0.25 * pulse;
    return coreCol;
}

// --- grade ------------------------------------------------------------
void main() {
    // Screen uv, centred.
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(u_aspect, 1.0);

    float t = u_time;
    float camZ = mod(t * u_zspeed, u_zwrap);

    // Slow lateral drift so the flight never feels mechanical.
    vec3 ro = vec3(sin(t * 0.13) * 0.18, cos(t * 0.11) * 0.14, camZ);
    // Gentle roll.
    float roll = sin(t * 0.07) * 0.04;
    mat2 rot = mat2(cos(roll), -sin(roll), sin(roll), cos(roll));
    uv = rot * uv;

    vec3 rd = normalize(vec3(uv, u_focal));

    // --- walls ------------------------------------------------------------
    float face, u;
    float hit = corridorHit(ro, rd, face, u);
    vec3 col = shadeHit(ro, rd, hit, face, u);

    // --- dust motes drifting past ----------------------------------------
    for (int i = 0; i < 8; i++) {
        float s = hit * (0.08 + 0.115 * float(i));
        vec3 sp = (ro + rd * s) * vec3(2.6, 2.6, 1.3);
        vec3 cellId = floor(sp);
        float rnd = hash21(cellId.xy + cellId.z * 7.31);
        if (rnd > 0.94) {
            vec2 jitter = vec2(hash21(cellId.yz + cellId.x), hash21(cellId.zx + cellId.y));
            float d = length(fract(sp.xy) - jitter);
            float mote = exp(-d * d * 30.0) / (1.0 + s * 0.3);
            col += mix(vec3(0.6, 0.9, 1.0), palette(rnd * 3.0), 0.35) * mote * 1.0;
        }
    }

    // --- distance fog -----------------------------------------------------
    float fog = 1.0 - exp(-max(hit, 0.0) * 0.085);
    vec3 fogCol = vec3(0.016, 0.022, 0.058);
    col = mix(col, fogCol, fog);

    // --- hyperspace streaks ----------------------------------------------
    col += warpStreaks(uv, t) * 0.5;

    // --- hyperdrive core -------------------------------------------------
    col += hyperdriveCore(uv, t);

    // --- grade ------------------------------------------------------------
    col *= 1.0 - 0.62 * smoothstep(0.42, 1.35, length((qt_TexCoord0 - 0.5) * 2.0));
    col += (hash21(qt_TexCoord0 * 1024.0) - 0.5) * (1.0 / 255.0);

    fragColor = vec4(col, 1.0);
}