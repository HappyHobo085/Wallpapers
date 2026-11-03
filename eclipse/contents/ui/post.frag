#version 440

// ---------------------------------------------------------------------------
//  ECLIPSE  —  finishing pass
//  Reads the raymarched scene (scene.frag, rendered into a texture at the
//  Render scale) and adds the cinematic finish: depth of field focused on
//  the ring, edge anti-aliasing, bloom, a touch of chromatic aberration
//  toward the edges and a vignette. scene.frag stores depth in alpha,
//  0.5 = in focus. bloomSource is the same scene rendered at 1/8 size, so
//  a few bilinear taps of it give a smooth glow without speckle.
// ---------------------------------------------------------------------------

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float u_time;
    float u_aspect;
    float u_texw;     // =0.00052  1 / scene texture width
    float u_texh;     // =0.00093  1 / scene texture height
    float u_dof;      // =1     depth-of-field strength, 0 = off
};

layout(binding = 1) uniform sampler2D source;
layout(binding = 2) uniform sampler2D bloomSource;

// No integer maths or textureSize(): Qt may pick the GLSL 1.20 variant.

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Edge anti-aliasing (FXAA-style). The raymarch takes one sample per pixel,
// so silhouettes stair-step, and more so once the Render scale texture is
// stretched to the screen. Works in scene-texture pixels: finds the local
// edge direction from the four diagonal neighbours and blends along it.
// Luma leans on red, since most edges here are red against black.
vec3 fxaa(vec2 uv, vec2 texel, vec3 cM) {
    const vec3 L = vec3(0.55, 0.38, 0.07);
    float lM = dot(cM, L);
    float lNW = dot(texture(source, uv + vec2(-1.0, -1.0) * texel).rgb, L);
    float lNE = dot(texture(source, uv + vec2( 1.0, -1.0) * texel).rgb, L);
    float lSW = dot(texture(source, uv + vec2(-1.0,  1.0) * texel).rgb, L);
    float lSE = dot(texture(source, uv + vec2( 1.0,  1.0) * texel).rgb, L);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin < max(0.02, lMax * 0.1))
        return cM;
    // Perpendicular to the luma gradient, i.e. along the edge.
    vec2 dir = vec2((lSW + lSE) - (lNW + lNE), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcp, -8.0, 8.0) * texel;
    vec3 a = 0.5 * (texture(source, uv - dir * 0.1667).rgb
                  + texture(source, uv + dir * 0.1667).rgb);
    vec3 b = 0.5 * a + 0.25 * (texture(source, uv - dir * 0.5).rgb
                             + texture(source, uv + dir * 0.5).rgb);
    float lb = dot(b, L);
    return (lb < lMin || lb > lMax) ? a : b;
}

// 0 in focus .. 1 fully defocused, from the depth stored in alpha.
float blurAmount(float a) {
    return smoothstep(0.06, 0.6, abs(a - 0.5) * 2.0);
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 texel = vec2(u_texw, u_texh);
    vec4 c0 = texture(source, uv);

    // --- depth of field and bloom from one golden-angle spiral -----------
    // Taps further from focus than the centre get full weight; nearer, sharper
    // taps are down-weighted so in-focus edges do not smear into the blur.
    float coc = blurAmount(c0.a) * 6.0 * u_dof;      // radius in texels
    vec3 acc = c0.rgb;
    float wsum = 1.0;
    vec3 bloom = vec3(0.0);
    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 16.0);
        float th = fi * 2.39996;
        vec2 o = vec2(cos(th), sin(th)) * r;

        vec4 s = texture(source, uv + o * coc * texel);
        float w = max(blurAmount(s.a), 0.2);
        acc += s.rgb * w;
        wsum += w;

        // Wide, soft taps for bloom: only what is already bright spills.
        vec3 b = texture(bloomSource, uv + o * 22.0 * texel).rgb;
        bloom += max(b - 0.4, 0.0);
    }
    // Sharp areas get the anti-aliased colour; blurred ones the blur, which
    // has no stair-steps left to fix.
    vec3 col = mix(fxaa(uv, texel, c0.rgb), acc / wsum, smoothstep(0.5, 2.0, coc));
    col += bloom * (0.9 / 16.0);

    // --- chromatic aberration, growing toward the corners ----------------
    vec2 fromC = uv - 0.5;
    vec2 ca = fromC * dot(fromC, fromC) * 0.012;
    // Applied as an offset so the centre keeps its anti-aliased edges.
    col.r += 0.6 * (texture(source, uv + ca).r - c0.r);
    col.b += 0.6 * (texture(source, uv - ca).b - c0.b);

    // --- vignette and grain ----------------------------------------------
    float v = length(fromC * 2.0);
    col *= 1.0 - 0.35 * smoothstep(0.55, 1.4, v);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float grain = hash21(uv * vec2(1931.0, 1087.0) + fract(u_time * 7.13) * 113.0) - 0.5;
    // Just enough to break up banding in the dark gradients.
    col += grain * 0.008 * (1.0 - 0.6 * lum);

    fragColor = vec4(max(col, 0.0), 1.0);
}
