#version 440

// ---------------------------------------------------------------------------
//  ECLIPSE  —  an audio-reactive wallpaper for Plasma 6
//  Low over a crater of jagged teal rubble and crystal shards, a red eclipse
//  hangs on the horizon with a ragged splash of red behind it. The spectrum
//  raises the rubble and the splash, bass swells and burns the ring, highs
//  light the crystals, and every beat blasts chunks out of the ring at the
//  camera with explosions round the rim and a red flood.
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
    float u_travel;   // =6.0   distance drifted; main.qml integrates speed
    float u_bass;     // =0.6   0..1 levels from audiopulse
    float u_mid;      // =0.45
    float u_high;     // =0.3
    float u_beat;     // =0.5   jumps to 1 on a beat, then decays
    float u_beatn;    // =5     beat counter; re-seeds the patterns
    float u_live;     // =1     1 while the audio feed is connected
    float u_hue;      // =0     palette rotation, radians
    float u_camdist;  // =1     camera distance multiplier, 1 = closest
    vec4 u_spec0;     // =0.75,0.8,0.7,0.55   16 spectrum bands, low to high
    vec4 u_spec1;     // =0.45,0.4,0.38,0.35
    vec4 u_spec2;     // =0.32,0.3,0.28,0.25
    vec4 u_spec3;     // =0.22,0.18,0.12,0.06
};

// Keep this shader free of integer maths apart from loop counters: Qt may
// pick its GLSL 1.20 variant, which has no integer bit ops, no implicit
// int/float casts and no dynamic vec4 indexing.

#define PI      3.14159265
#define TAU     6.28318531
#define CS      0.7      // rubble cell size
#define RING_D  12.0     // camera to ring distance, along the ground
#define RING_Y  1.2      // ring centre height
#define RING_R  1.05     // ring radius at rest
// 2.5D framing: a raised camera tilted down into the crater with a narrow
// field of view, so perspective flattens into a diorama.
#define CAM_H   5.0      // camera height above the crater floor
#define FOCAL   2.1      // higher is narrower
#define TMAX    34.0     // march range at the closest camera distance
#define STEPS   90
#define CHUNKS  5        // pieces blasted out on each beat

// --- helpers --------------------------------------------------------------
float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3);
}

// Spectrum sampled continuously, x = 0 (bass) .. 1 (treble): linear
// interpolation between the 16 bands, written as a tent weight per band so
// it needs no branches (map() calls it for every rubble piece it tests).
float band(float x) {
    x = clamp(x, 0.0, 1.0) * 15.0;
    const vec4 k = vec4(0.0, 1.0, 2.0, 3.0);
    return dot(u_spec0, max(1.0 - abs(k - x), 0.0))
         + dot(u_spec1, max(1.0 - abs(k + 4.0 - x), 0.0))
         + dot(u_spec2, max(1.0 - abs(k + 8.0 - x), 0.0))
         + dot(u_spec3, max(1.0 - abs(k + 12.0 - x), 0.0));
}

vec3 hueRotate(vec3 c, float h) {
    const vec3 k = vec3(0.57735);
    float ch = cos(h);
    return c * ch + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ch);
}

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// --- state shared by map() and shading ------------------------------------
float gBass, gBeat, gLive, gSeed, gAge, gCamZ;
float gCamK;  // camera distance multiplier, >= 1
vec3 gRing;   // ring centre, world space
// Blasted chunks. They are not part of map(): setupChunks() works them out
// once per pixel, keeps the (at most) two this ray passes near, and main()
// intersects those analytically. Keeping them out of map(), which is inlined
// for every march step, normal and AO probe, is what keeps this cheap.
vec3 gAPos, gBPos, gASize, gBSize;
mat3 gARot, gBRot;
float gAOn, gBOn;

// The crater floor: a shallow bowl that rises to the sides.
float groundY(float x) {
    return 0.03 * x * x - 0.35;
}

// One rubble piece in cell c. mat: 0 = rock, 2 = crystal shard.
float piece(vec3 p, vec2 c, out float mat) {
    float h0 = hash21(c);
    float h1 = hash21(c + 17.13);
    float h2 = hash21(c + 41.7);
    float h3 = hash21(c + 63.1);
    vec2 ctr = (c + 0.5 + (vec2(h0, h1) - 0.5) * 0.5) * CS;
    vec3 q = p - vec3(ctr.x, groundY(ctr.x), ctr.y);
    // Bass along the line under the ring, treble out to the sides.
    float lvl = gLive * band(clamp(abs(ctr.x) / 7.0, 0.0, 1.0));
    float pop = gBeat * step(0.8, hash21(c + gSeed * 3.7));
    // Keep a low lane down the middle so the camera never ends up inside
    // a rock that the music just raised.
    float lane = smoothstep(0.6, 2.2, abs(ctr.x));
    q.xz = rot(h0 * TAU) * q.xz;
    if (h2 > 0.88 && abs(ctr.x) > 1.6) {
        // Crystal: tall, thin, leaning a little.
        q.xy = rot((h1 - 0.5) * 0.3) * q.xy;
        float hgt = (0.4 + 0.8 * h1 + 1.0 * lvl + 0.4 * pop) * lane;
        // Taper toward the tip so it reads as a spike, not a post. The
        // squeeze stretches the distance field, hence the 0.6 safety factor.
        float taper = 1.0 - 0.85 * clamp(q.y / max(hgt, 1e-3), 0.0, 1.0);
        q.xz /= taper;
        mat = 2.0;
        return 0.6 * taper * sdBox(q - vec3(0.0, 0.5 * hgt, 0.0),
                                   vec3(0.05 + 0.04 * h0, 0.5 * hgt, 0.05 + 0.04 * h1));
    }
    // Rock: mostly pebbles, the odd boulder, tilted and half buried, then
    // cut by one or two random planes so it reads as a broken shard rather
    // than a block.
    float sz = mix(0.09, 0.34, h3);
    q.yz = rot((h1 - 0.5) * 1.0) * q.yz;
    q.xy = rot((h2 - 0.5) * 1.0) * q.xy;
    float hgt = sz * (0.6 + 0.8 * h1)
              + (0.6 * lvl * (0.4 + 0.6 * h2) + 0.35 * pop) * (0.3 + 0.7 * lane);
    vec3 b = vec3(sz * (0.8 + 0.6 * h2), hgt, sz * (0.7 + 0.6 * h0));
    vec3 qc = q - vec3(0.0, 0.4 * hgt, 0.0);
    float d = sdBox(qc, b);
    vec3 n1 = normalize(vec3(cos(h3 * TAU), 0.5 + h0, sin(h3 * TAU)));
    d = max(d, dot(qc, n1) - b.y * (0.2 + 0.6 * h1));
    if (h0 > 0.45) {
        vec3 n2 = normalize(vec3(-n1.x + 0.4 * (h2 - 0.5), 0.7 + h1, -n1.z));
        d = max(d, dot(qc, n2) - b.y * (0.3 + 0.5 * h2));
    }
    mat = 0.0;
    return d;
}

// Signed distance to the crater. mat: 0 rock, 2 crystal, 3 bare floor.
float map(vec3 p, out float mat) {
    float gy = groundY(p.x);
    float slope = 0.06 * p.x;
    float d = (p.y - gy) / sqrt(1.0 + slope * slope);
    mat = 3.0;

    // Rubble never rises more than ~3 above the floor; skip it above that.
    if (p.y - gy < 3.2) {
        // Pieces spill a little past their own cell, so test the 2x2 block
        // of cells nearest to p.
        vec2 base = floor(p.xz / CS - 0.5);
        float m;
        float r = piece(p, base, m);
        if (r < d) { d = r; mat = m; }
        r = piece(p, base + vec2(1.0, 0.0), m);
        if (r < d) { d = r; mat = m; }
        r = piece(p, base + vec2(0.0, 1.0), m);
        if (r < d) { d = r; mat = m; }
        r = piece(p, base + vec2(1.0, 1.0), m);
        if (r < d) { d = r; mat = m; }
    } else {
        d = min(d, p.y - gy - 3.0);
    }
    return d;
}

// gAge is the time since the latest beat, so the chunks fly from the ring
// toward the camera and tumble as it grows.
void setupChunks(vec3 ro, vec3 rd) {
    gAOn = 0.0;
    gBOn = 0.0;
    if (gBeat <= 0.01)
        return;
    for (int i = 0; i < CHUNKS; i++) {
        float fi = float(i);
        vec3 hs = vec3(hash21(vec2(gSeed, fi)), hash21(vec2(fi, gSeed + 3.1)),
                       hash21(vec2(gSeed + fi, 7.7)));
        // Always veer off to one side so nothing smashes into the lens.
        float side = hs.x < 0.5 ? -1.0 : 1.0;
        // Rising toward the raised camera; everything scales with the camera
        // distance so the chunks still reach it before the beat fades.
        vec3 vel = vec3(side * (3.5 + 6.0 * abs(hs.x - 0.5)) * gCamK,
                        (gCamK * CAM_H - RING_Y) * (1.0 + hs.y),
                        (-20.0 - 10.0 * hs.z) * gCamK);
        vec3 c = gRing + vec3((hs.x - 0.5) * 1.6, (hs.y - 0.6) * 1.2, -0.5)
               + vel * gAge - vec3(0.0, 4.0 * gAge * gAge, 0.0);
        float a1 = gAge * (4.0 + 6.0 * hs.z) + fi;
        float a2 = gAge * 3.0 * hs.x + fi;
        // Same as rotating q.xz by a1 and then q.xy by a2.
        mat3 r1 = mat3(cos(a1), 0.0, sin(a1), 0.0, 1.0, 0.0, -sin(a1), 0.0, cos(a1));
        mat3 r2 = mat3(cos(a2), sin(a2), 0.0, -sin(a2), cos(a2), 0.0, 0.0, 0.0, 1.0);
        // ...and shrink away over the last few metres.
        float s = (0.16 + 0.2 * hs.y) * smoothstep(1.0, 5.0, c.z - gCamZ);
        // Skip chunks whose bounding sphere this ray misses.
        float ahead = dot(c - ro, rd);
        float miss = length(c - ro - rd * ahead);
        if (ahead < 0.0 || miss > 1.8 * s)
            continue;
        if (gAOn < 0.5) {
            gAOn = 1.0; gAPos = c; gARot = r2 * r1; gASize = vec3(1.4 * s, 0.8 * s, s);
        } else if (gBOn < 0.5) {
            gBOn = 1.0; gBPos = c; gBRot = r2 * r1; gBSize = vec3(1.4 * s, 0.8 * s, s);
        }
    }
}

// Ray against a box of half-size b, centred at c, rotated by r (world to
// box). Returns the entry distance, or -1 on a miss, the world normal and
// the hit point in box space scaled to -1..1.
float boxHit(vec3 ro, vec3 rd, vec3 c, mat3 r, vec3 b, out vec3 n, out vec3 lp) {
    vec3 o = r * (ro - c);
    vec3 dv = r * rd;
    dv = vec3(abs(dv.x) < 1e-6 ? 1e-6 : dv.x,
              abs(dv.y) < 1e-6 ? 1e-6 : dv.y,
              abs(dv.z) < 1e-6 ? 1e-6 : dv.z);
    vec3 m = 1.0 / dv;
    vec3 k = abs(m) * b;
    vec3 t1 = -m * o - k;
    vec3 t2 = -m * o + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    n = vec3(0.0, 1.0, 0.0);
    lp = (o + dv * tN) / b;
    if (tN > tF || tF < 0.0)
        return -1.0;
    vec3 nb = -sign(dv) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    n = nb * r;    // r is orthonormal, so this is transpose(r) * nb
    return tN;
}

float map(vec3 p) {
    float m;
    return map(p, m);
}

vec3 normalAt(vec3 p) {
    const vec2 k = vec2(1.0, -1.0) * 0.0025;
    return normalize(k.xyy * map(p + k.xyy) + k.yyx * map(p + k.yyx)
                   + k.yxy * map(p + k.yxy) + k.xxx * map(p + k.xxx));
}

// One layer of the splash behind the ring: n soft streaks at jittered
// angles, like paint flung off the rim. ang is 0..TAU, r the distance from
// the ring centre, aa the anti-aliasing width in radians, wid the streak
// width as a fraction of its angular slot, gap how much of it breaks up
// into dashes and droplets. Returns coverage and, in .y, how far along the
// streak (0 base .. 1 tip) this point is.
vec2 streakLayer(float ang, float r, float re, float n, float seed, float aa,
                 float idle, float wid, float gap) {
    float w = TAU / n;
    float i = floor(ang / w);
    float hs = hash21(vec2(i, seed));
    float hw = hash21(vec2(i + 7.3, seed));
    float hd = hash21(vec2(i, seed + 2.9));
    float centre = (i + 0.5 + 0.5 * (hw - 0.5)) * w;
    // centre is measured from -x (ang = atan + PI), so up is sin(centre - PI).
    float upness = 0.5 - 0.5 * sin(centre);
    float xa = abs(centre - PI * 1.5) / PI;           // 0 at the top
    float lvl = band(min(xa, 1.0)) * gLive + 0.35 * idle;
    float reach = 0.1 + (0.5 + 1.8 * lvl) * (0.15 + 0.85 * upness * upness) + 1.0 * gBeat;
    float len = re * reach * (0.3 + 1.1 * hs);
    // Some streaks start clear of the rim, as fragments already in flight.
    float start = re * (0.97 + (hd > 0.75 ? 0.1 + 0.4 * hs : 0.0));
    float tn = (r - start) / max(len, 1e-3);
    // Bent a little so they read as flung matter rather than sun rays.
    float bend = (hd - 0.5) * 0.6 * w * tn * tn;
    float halfW = w * wid * (0.5 + hw) * (1.0 - 0.75 * clamp(tn, 0.0, 1.0)) * re / max(r, re);
    float da = abs(ang - centre - bend);
    float cov = 1.0 - smoothstep(0.35 * halfW, halfW + aa, da);
    // Fade in off the rim and out toward the tip, and break into dashes.
    cov *= smoothstep(0.0, 0.04, tn) * (1.0 - smoothstep(0.55, 1.0, tn));
    cov *= smoothstep(gap, gap + 0.18, vnoise(vec2(i * 7.31 + seed, r * 7.0 / re)));
    return vec2(step(0.25, hs) * cov, tn);
}

// --------------------------------------------------------------------------
void main() {
    vec2 uv = (qt_TexCoord0 - 0.5) * vec2(u_aspect, 1.0);
    uv.y = -uv.y;                       // texture y runs down; make +y up
    float t = u_time;

    // Pull the camera back from the ring, keeping the same viewing angle.
    gCamK = max(u_camdist, 1.0);
    gLive = clamp(u_live, 0.0, 1.0);
    float idle = 1.0 - gLive;
    gBass = u_bass * gLive + idle * (0.25 + 0.15 * sin(t * 0.8));
    gBeat = u_beat * gLive;
    gSeed = u_beatn + idle * floor(t * 0.25);
    // u_beat decays as exp(-age / 0.18 s), so the age can be read back.
    gAge = -0.18 * log(max(u_beat, 0.002));

    vec3 red = vec3(1.0, 0.10, 0.04);
    vec3 hot = vec3(1.0, 0.58, 0.25);
    vec3 teal = vec3(0.10, 0.50, 0.42);

    // --- camera: low over the rubble, looking a touch down at the ring ---
    vec2 shake = (vec2(hash21(vec2(gSeed, 1.0)), hash21(vec2(gSeed, 2.0))) - 0.5)
               * 0.12 * gBeat * gBeat;
    vec3 ro = vec3(sin(t * 0.11) * 0.6 + shake.x,
                   gCamK * CAM_H + 0.15 * sin(t * 0.17) + shake.y, u_travel);
    gRing = vec3(0.0, RING_Y, ro.z + gCamK * RING_D);
    gCamZ = ro.z;
    vec3 fwd = normalize(gRing - vec3(0.0, 0.35, 0.0) - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    uv = rot(sin(t * 0.07) * 0.06 + shake.x * 0.5) * uv;
    float focal = FOCAL - 0.3 * gBeat;   // the view punches wider on a hit
    vec3 rd = normalize(uv.x * right + uv.y * up + focal * fwd);
    setupChunks(ro, rd);

    // --- march ------------------------------------------------------------
    // Reach past the ring by the same margin however far back the camera is.
    float tmax = TMAX + (gCamK - 1.0) * length(vec2(CAM_H, RING_D));
    float tt = 0.05;
    float mat = 0.0;
    bool hit = false;
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * tt;
        float d = map(p, mat);
        if (d < 0.0015 * tt) {
            hit = true;
            break;
        }
        tt += d * 0.7;
        if (tt > tmax)
            break;
    }
    // Out of steps short of TMAX: grazing rays crawl along the rubble, so
    // shade where the ray stopped rather than punching a hole to the sky.
    if (!hit && tt < tmax)
        hit = true;

    // Blasted chunks in front of whatever the march found replace it.
    bool chunk = false;
    vec3 chunkN = vec3(0.0, 1.0, 0.0);
    vec3 chunkP = vec3(0.0);
    if (gAOn > 0.5) {
        vec3 n, lp;
        float tc = boxHit(ro, rd, gAPos, gARot, gASize, n, lp);
        if (tc > 0.0 && (!hit || tc < tt)) { tt = tc; hit = true; chunk = true; chunkN = n; chunkP = lp; }
    }
    if (gBOn > 0.5) {
        vec3 n, lp;
        float tc = boxHit(ro, rd, gBPos, gBRot, gBSize, n, lp);
        if (tc > 0.0 && (!hit || tc < tt)) { tt = tc; hit = true; chunk = true; chunkN = n; chunkP = lp; }
    }
    if (chunk)
        mat = 1.0;

    float lightAmt = 0.6 + 3.0 * gBass + 2.4 * gBeat;
    vec3 col;
    vec3 n = vec3(0.0, 1.0, 0.0);
    float fog = 1.0;
    if (hit) {
        vec3 p = ro + rd * tt;
        n = chunk ? chunkN : normalAt(p);
        vec3 lv = gRing - p;
        float ld = length(lv);
        vec3 l = lv / ld;
        // Cool sky light from high behind the ring: it catches the tops and
        // far faces, so the faces turned to the camera stay near black and
        // the rubble reads as silhouettes against the eclipse.
        vec3 sky = normalize(vec3(-0.25, 1.0, 0.7));

        // Neutral dark rock; the lights give it its teal and red.
        vec3 albedo = vec3(0.05, 0.06, 0.06) * (0.55 + 0.9 * vnoise(p.xz * 1.7));
        if (mat > 2.5)
            albedo = vec3(0.012, 0.016, 0.016);      // floor between the rubble
        else if (mat > 1.5)
            albedo = vec3(0.02, 0.10, 0.08);
        else if (mat > 0.5)
            albedo = vec3(0.04, 0.05, 0.05);

        float ao = clamp(0.45 + 2.5 * (map(p + n * 0.12) + 0.5 * map(p + n * 0.3)), 0.2, 1.0);
        float dif = max(dot(n, l), 0.0);
        // The ring's light falls off fast: the crater round it burns, the
        // foreground only catches it on edges.
        float fall = 1.0 / (1.0 + ld * ld * 0.25);
        float facing = max(dot(-rd, n), 0.0);
        float rim = pow(1.0 - facing, 3.0);
        col = albedo * teal * (0.6 * (0.5 + 0.5 * n.y) + 3.6 * max(dot(n, sky), 0.0)) * ao;
        col += albedo * red * dif * lightAmt * 14.0 * fall;
        col += red * rim * smoothstep(-0.1, 0.6, dot(n, l)) * lightAmt * 0.5 * fall * ao;
        col += teal * pow(max(dot(reflect(rd, n), sky), 0.0), 24.0) * 0.18 * ao;
        col += red * pow(max(dot(reflect(rd, n), l), 0.0), 24.0) * 0.6 * lightAmt * fall;
        if (mat > 1.5 && mat < 2.5) {
            // Crystals: glassy teal that lights up with the treble, brightest
            // through the thin edges.
            vec3 glass = vec3(0.12, 0.95, 0.72);
            col += glass * (0.12 + 0.6 * u_high * gLive) * (0.3 + 0.7 * rim) * ao;
            col += glass * pow(max(dot(reflect(rd, n), sky), 0.0), 40.0) * 0.5;
        }
        if (chunk) {
            // Blasted chunks: dark faces with bright bevelled edges, lit by
            // the ring they flew out of.
            vec3 ap = smoothstep(0.8, 0.97, abs(chunkP));
            float bevel = clamp(ap.x + ap.y + ap.z - 1.0, 0.0, 1.0);
            col += mix(teal * 1.4, vec3(0.8, 0.95, 0.9), 0.4) * bevel * 0.6;
            col += red * 0.15 * lightAmt * max(dot(n, l), 0.0);
        }

        // Fog starts short of the ring so the near crater stays crisp, and
        // glows red toward the ring so far rubble stands out against it.
        fog = 1.0 - exp(-max(tt - 0.6 * gCamK * RING_D, 0.0) * 0.08);
        float toward = pow(max(dot(rd, normalize(gRing - ro)), 0.0), 60.0);
        col = mix(col, vec3(0.003, 0.012, 0.011) + red * (0.02 + 0.12 * toward) * (0.4 + gBass), fog);
    } else {
        col = vec3(0.003, 0.012, 0.011) + teal * 0.03 * smoothstep(0.3, -0.05, rd.y);
    }

    // --- the eclipse, on a plane through the ring centre ------------------
    float re = RING_R * (1.0 + 0.14 * gBass + 0.1 * gBeat);
    float tE = (gRing.z - ro.z) / rd.z;
    vec2 e = ro.xy + rd.xy * tE - gRing.xy;
    float d = length(e);
    vec2 dir = e / max(d, 1e-4);
    float angE = atan(e.y, e.x) + PI;                 // 0..TAU from -x
    float aaE = 1.5 * fwidth(angE);
    aaE = aaE > 1.0 ? 0.002 : max(aaE, 1e-4);         // ignore the seam
    // 1 where the ring plane is nearer than whatever the ray hit.
    float front = (hit && tt < tE) ? 0.0 : 1.0;

    float ringCover = 0.0;     // 1 where the ring or its shards are what we see
    if (front > 0.5) {
        // Red splatter behind the ring, mostly flung upward: broad dark
        // smears under medium streaks under fine bright spatter that breaks
        // into droplets. Reach follows the bands round the rim (bass at the
        // top) and bursts on beats.
        vec2 s1 = streakLayer(angE, d, re, 19.0, 1.0, aaE, idle, 0.45, 0.12);
        vec2 s2 = streakLayer(angE, d, re, 41.0, 7.0, aaE, idle, 0.32, 0.3);
        vec2 s3 = streakLayer(angE, d, re, 83.0, 13.0, aaE, idle, 0.2, 0.4);
        float energy = 0.55 + 0.6 * gBass + 0.8 * gBeat;
        vec3 sc = vec3(0.32, 0.012, 0.008) * s1.x * (1.0 - 0.5 * s1.y);
        sc = mix(sc, vec3(0.45, 0.02, 0.012) * (1.0 - 0.5 * s2.y), s2.x);
        sc = mix(sc, vec3(0.85, 0.06, 0.025) * (1.0 - 0.6 * s3.y), s3.x);
        float a = max(s1.x, max(s2.x, s3.x)) * step(re, d);
        col = mix(col, sc * energy, 0.9 * a);
        ringCover = max(step(0.5, a), step(d, 1.1 * re));
        // A haze, densest at the rim and above it, ties the splatter to the
        // ring.
        float upE = 0.5 + 0.5 * dir.y;
        col += red * (0.04 + 0.1 * upE) * exp(-(d - re) * 2.2 / re) * step(re, d) * energy;

        // Dark core, then a rim that burns hottest on its upper right.
        if (d < re)
            col = vec3(0.012, 0.002, 0.002) + red * 0.14 * pow(d / re, 8.0)
                + red * 0.03 * fbm(e * 3.0);
        float lit = 0.35 + 0.9 * smoothstep(-0.2, 0.9, dot(dir, normalize(vec2(0.45, 1.0))));
        float rdist = abs(d - re);
        col += red * exp(-rdist * 30.0) * lit * (0.9 + 0.8 * gBass);
        col += hot * exp(-rdist * 120.0) * lit * (1.2 + 1.2 * gBeat);
        col += red * exp(-(d - re) * 1.8) * step(re, d) * 0.3 * (0.4 + gBass);
    }

    // Explosions round the lower rim on each beat, bright enough to show
    // through rubble in front of the ring.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float ang = PI * (1.15 + 0.7 * hash21(vec2(gSeed, fi + 11.0)));
        vec2 fp = vec2(cos(ang), sin(ang)) * re * (1.0 + 0.5 * hash21(vec2(fi, gSeed + 5.0)));
        float size = re * (0.12 + 0.3 * hash21(vec2(gSeed + fi, 2.2))) * gBeat;
        float fl = exp(-length(e - fp) / max(size, 1e-3));
        col += (hot + vec3(0.4) * fl) * fl * 1.4 * gBeat * (0.4 + 0.6 * front);
    }

    // Light scattered round the ring, visible past anything in front.
    vec3 toRing = normalize(gRing - ro);
    float angR = re / (gRing.z - ro.z);
    float ang = acos(clamp(dot(rd, toRing), -1.0, 1.0));
    col += red * exp(-abs(ang - angR) * 7.0) * smoothstep(0.75 * angR, angR, ang)
         * 0.12 * lightAmt;
    // Beats flood the whole frame red.
    col += red * gBeat * gBeat * 0.14;

    // --- grade ------------------------------------------------------------
    col = 1.0 - exp(-col * 1.8);
    col = max(hueRotate(col, u_hue), 0.0);

    // Alpha carries depth for post.frag's depth of field: 0.5 is in focus
    // at the ring, lower is nearer, higher is further.
    float ringDist = length(gRing - ro);
    float depth = ringCover > 0.5 ? tE : (hit ? tt : 4.0 * ringDist);
    fragColor = vec4(col, clamp(0.5 + 0.5 * (depth - ringDist) / ringDist, 0.0, 1.0));
}
