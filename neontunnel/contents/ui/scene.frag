#version 440

// ---------------------------------------------------------------------------
//  NEON TUNNEL  —  an audio-reactive wallpaper for Plasma 6
//  Flying down an octagonal tunnel of violet neon ribs. Quiet passages show
//  a faint wireframe; bass lights the rib segments; every beat floods random
//  wall bays with white-hot slats and re-rolls which ones.
// ---------------------------------------------------------------------------

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// qt_Matrix and qt_Opacity must stay first (offsets 0 and 64) to match the
// built-in vertex shader's uniform block. The "// =x" comments are the
// defaults tools/render.py uses for offscreen previews.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float u_time;
    float u_aspect;
    float u_travel;   // =3.4   distance flown; main.qml integrates speed
    float u_bass;     // =0.65  0..1 levels from audiopulse
    float u_mid;      // =0.45
    float u_high;     // =0.35
    float u_beat;     // =0.85  jumps to 1 on a beat, then decays
    float u_beatn;    // =7     beat counter; re-seeds the patterns
    float u_live;     // =1     1 while the audio feed is connected
    float u_hue;      // =0     palette rotation, radians
    vec4 u_spec0;     // =0.75,0.8,0.7,0.55   16 spectrum bands, low to high
    vec4 u_spec1;     // =0.45,0.4,0.38,0.35
    vec4 u_spec2;     // =0.32,0.3,0.28,0.25
    vec4 u_spec3;     // =0.22,0.18,0.12,0.06
};

#define PI      3.14159265
#define TAU     6.28318531
#define SIDES   8.0
#define FOCAL   0.55     // depth = FOCAL / apothem; lower is wider
#define SPACING 1.0      // world distance between rings

// --- helpers --------------------------------------------------------------
float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Band i (a whole number 0..15). Float-only on purpose: Qt may pick the
// GLSL 1.20 variant, which has no integer bit ops or dynamic vec4 indexing.
float spec(float i) {
    vec4 v = i < 4.0 ? u_spec0 : (i < 8.0 ? u_spec1 : (i < 12.0 ? u_spec2 : u_spec3));
    float k = i - 4.0 * floor(i / 4.0);
    return dot(v, step(abs(vec4(0.0, 1.0, 2.0, 3.0) - k), vec4(0.5)));
}

// Spectrum sampled continuously, x = 0 (bass) .. 1 (treble).
float band(float x) {
    x = clamp(x, 0.0, 1.0) * 15.0;
    float i = floor(x);
    return mix(spec(i), spec(min(i + 1.0, 15.0)), x - i);
}

// Rotate a colour around the grey axis.
vec3 hueRotate(vec3 c, float h) {
    const vec3 k = vec3(0.57735);
    float ch = cos(h);
    return c * ch + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ch);
}

// A neon line: anti-aliased core of world width w plus a soft halo. d and fw
// (its screen derivative) are in the same units.
float neon(float d, float w, float fw) {
    float core = 1.0 - smoothstep(w, w + fw * 1.5, d);
    float halo = exp(-d / (w * 5.0 + fw * 4.0));
    return core + 0.32 * halo;
}

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// --------------------------------------------------------------------------
void main() {
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(u_aspect, 1.0);
    float t = u_time;
    float live = clamp(u_live, 0.0, 1.0);
    float idle = 1.0 - live;

    // Without a feed, breathe slowly so the wallpaper never looks dead.
    float idleRib = 0.30 + 0.20 * sin(t * 1.3);
    float idleFlash = pow(max(sin(t * 0.7), 0.0), 14.0);
    float seed = u_beatn + idle * floor(t * 0.7 / TAU + 0.25);

    float bass = u_bass * live;
    float beat = max(u_beat * live, idle * idleFlash * 0.7);

    // Wandering vanishing point; each beat snaps the octagon round by a
    // sixteenth turn or so, the hard cut in the reference loop.
    uv -= vec2(sin(t * 0.21) * 0.05, cos(t * 0.17) * 0.04);
    float snap = (floor(hash21(vec2(seed, 3.1)) * 3.0) - 1.0) * (PI / 8.0);
    uv = rot(t * 0.03 + 0.2 * sin(t * 0.11) + snap) * uv;

    // --- octagonal tunnel mapping ----------------------------------------
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    const float seg = TAU / SIDES;
    float sideF = floor(a / seg + 0.5);
    float sa = a - sideF * seg;               // angle from the side's centre
    float apo = max(r * cos(sa), 1e-4);       // distance to the side's line
    float s = tan(sa) / tan(seg * 0.5);       // -1..1 along the side
    float side = mod(sideF, SIDES);
    float depth = FOCAL / apo;
    float ring = (depth + u_travel) / SPACING;

    float rid = floor(ring + 0.5);
    float rd = abs(ring - rid);               // distance to the nearest ring
    float frw = fwidth(ring);
    float bay = floor(ring);
    float bf = fract(ring);
    float fws = fwidth(s);

    float fade = exp(-depth * 0.16);
    // Bass-heavy sides at the bottom, treble at the top.
    float lvl = 0.45 + 1.1 * band(0.5 + 0.5 * sin(sideF * seg)) * live + 0.4 * idle;

    vec3 base = vec3(0.30, 0.20, 1.00);
    vec3 hot = vec3(0.78, 0.72, 1.00);

    // --- 1. wireframe: every ring and the corner seams, always faint ------
    float cornerD = 1.0 - abs(s);
    float wire = neon(rd, 0.006, frw) + 0.6 * neon(cornerD, 0.004, fwidth(cornerD));
    vec3 col = base * wire * (0.10 + 0.22 * u_mid * live + 0.06 * idle) * fade;

    // --- 2. rib segments: rings broken into four pieces per side ---------
    float segi = floor((s + 1.0) * 2.0);
    float segf = fract((s + 1.0) * 2.0);
    float segOn = step(0.42, hash21(vec2(rid * 1.7 + segi, side * 5.3 + seed)));
    float segGap = smoothstep(0.03, 0.07, segf) * smoothstep(0.97, 0.93, segf);
    float rib = neon(rd, 0.016, frw) * segOn * segGap;
    float ribAmt = smoothstep(0.12, 0.75, bass) * 1.3 + 0.7 * beat + idle * idleRib;
    col += mix(base, hot, 0.35) * rib * ribAmt * lvl * fade;

    // --- 3. slat panels: whole bays flooded with dense parallel lines ----
    float half_ = step(0.0, s);
    float pick = hash21(vec2(bay * 3.1 + half_, side * 7.7 + seed * 1.37));
    float pLit = 0.12 + 0.6 * beat + 0.15 * smoothstep(0.5, 0.95, u_high * live);
    float inBay = smoothstep(0.04, 0.10, bf) * smoothstep(0.96, 0.90, bf)
                * smoothstep(0.02, 0.08, abs(s)) * smoothstep(0.99, 0.94, abs(s));
    float slatD = abs(fract(s * 7.0) - 0.5) / 7.0;
    float slat = neon(slatD, 0.008, fws) + 0.06;  // lines plus a faint backlit fill
    float slatAmt = pow(beat, 1.3) * 1.9 + 0.35 * smoothstep(0.55, 0.95, u_high * live);
    col += mix(base, hot, 0.45) * slat * inBay * step(pick, pLit) * slatAmt * lvl * fade;

    // --- 4. radial streaks: thin lines shooting out of the centre --------
    float rayA = a / TAU * 120.0;
    float rayId = floor(rayA);
    float rayOn = step(0.93, hash21(vec2(rayId, seed * 0.71)));
    float rayD = abs(fract(rayA) - 0.5);
    float rayLen = fract(hash21(vec2(rayId, 9.0)) + t * 0.6);
    float ray = (1.0 - smoothstep(0.0, fwidth(rayA) * 1.5, rayD))
              * smoothstep(rayLen - 0.25, rayLen, r) * smoothstep(rayLen + 0.05, rayLen, r);
    col += base * ray * rayOn * (0.25 * u_high * live + 0.5 * beat) * smoothstep(0.05, 0.3, r);

    // --- haze: the whole tube glows on big hits ---------------------------
    col += base * (0.20 * slatAmt + 0.04 * ribAmt) * smoothstep(0.0, 0.9, r) * 0.35;

    // --- grade ------------------------------------------------------------
    // Per-channel filmic curve: whites only where blue already saturates.
    col = 1.0 - exp(-col * vec3(1.1, 1.0, 1.6));
    col = max(hueRotate(col, u_hue), 0.0);
    col *= 1.0 - 0.45 * smoothstep(0.5, 1.4, length((qt_TexCoord0 - 0.5) * 2.0));
    col += (hash21(qt_TexCoord0 * 1024.0) - 0.5) * (1.0 / 255.0);

    fragColor = vec4(col, 1.0);
}
