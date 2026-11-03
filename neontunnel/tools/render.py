#!/usr/bin/env python3
"""Render a GLSL fragment shader offscreen (EGL + OpenGL) to a PNG.

Used to preview and iterate on a wallpaper shader without disturbing the
running Plasma session, and to bake the package's preview.png.

    python3 render.py scene.frag out.png [time_seconds] [width] [height]
                           [u_name=value ...]

The uniform block layout is read from the shader itself: every float or vec4
member after qt_Opacity is packed with std140 rules. A member's default comes
from a trailing "// =value" comment on its declaration (vec4: "// =a,b,c,d"),
else 0. u_time and u_aspect are set from the arguments. Trailing
u_name=value pairs override any member, e.g. u_bass=0.8 u_beat=1 to preview
the scene on a beat.

The fragment shader is expected to use the Qt Quick ShaderEffect conventions:
a std140 uniform block at binding 0 that starts with mat4 qt_Matrix and
float qt_Opacity, a vec2 qt_TexCoord0 input at location 0 and a vec4
fragColor output at location 0.
"""
import ctypes

egl = ctypes.CDLL("libEGL.so.1")

# --- EGL constants
EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_SURFACE_TYPE, EGL_PBUFFER_BIT = 0x3033, 0x0001
EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT = 0x3040, 0x0008
EGL_OPENGL_API = 0x30A2
EGL_RED_SIZE, EGL_GREEN_SIZE, EGL_BLUE_SIZE, EGL_ALPHA_SIZE = 0x3024, 0x3023, 0x3022, 0x3021
EGL_DEPTH_SIZE, EGL_NONE = 0x3025, 0x3038
EGL_WIDTH, EGL_HEIGHT = 0x3057, 0x3056
EGL_CONTEXT_MAJOR_VERSION, EGL_CONTEXT_MINOR_VERSION = 0x3098, 0x30FB
EGL_CONTEXT_OPENGL_PROFILE_MASK = 0x30FD
EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT = 0x00000001

# --- GL constants
GL_FRAGMENT_SHADER, GL_VERTEX_SHADER = 0x8B30, 0x8B31
GL_COMPILE_STATUS, GL_LINK_STATUS, GL_INFO_LOG_LENGTH = 0x8B81, 0x8B82, 0x8B84
GL_COLOR_BUFFER_BIT, GL_TRIANGLES = 0x00004000, 0x0004
GL_RGBA, GL_RGBA8, GL_UNSIGNED_BYTE = 0x1908, 0x8058, 0x1401
GL_TEXTURE_2D = 0x0DE1
GL_TEXTURE_MIN_FILTER, GL_TEXTURE_MAG_FILTER = 0x2801, 0x2800
GL_TEXTURE_WRAP_S, GL_TEXTURE_WRAP_T = 0x2802, 0x2803
GL_LINEAR, GL_CLAMP_TO_EDGE = 0x2601, 0x812F
GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 = 0x8D40, 0x8CE0
GL_FRAMEBUFFER_COMPLETE = 0x8CD5
GL_VERSION, GL_RENDERER = 0x1F02, 0x1F01
GL_UNIFORM_BUFFER, GL_UNIFORM_BUFFER_BINDING, GL_STATIC_DRAW = 0x8A11, 0x8A28, 0x88E4
c_void_p, c_uint, c_int, c_float, c_char_p = (
    ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_float, ctypes.c_char_p)

# Pointer returns must be declared: ctypes defaults restype to a 32-bit int
# and would truncate 64-bit handles.
egl.eglGetProcAddress.restype = c_void_p
egl.eglGetProcAddress.argtypes = [c_char_p]
egl.eglGetPlatformDisplay.restype = c_void_p
egl.eglGetPlatformDisplay.argtypes = [c_uint, c_void_p, c_void_p]
egl.eglChooseConfig.argtypes = [c_void_p, ctypes.POINTER(c_int), ctypes.POINTER(c_void_p),
                                c_int, ctypes.POINTER(c_int)]
egl.eglCreateContext.restype = c_void_p
egl.eglCreateContext.argtypes = [c_void_p, c_void_p, c_void_p, ctypes.POINTER(c_int)]
egl.eglCreatePbufferSurface.restype = c_void_p
egl.eglCreatePbufferSurface.argtypes = [c_void_p, c_void_p, ctypes.POINTER(c_int)]
egl.eglMakeCurrent.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p]


def _addr(name):
    return egl.eglGetProcAddress(name.encode())


class GL:
    """GL entry points, bound lazily once a context is current.

    They are resolved through eglGetProcAddress rather than libGL.so: this
    libglvnd build does not dispatch for contexts created through EGL here.
    """

    def bind(self, name, restype, argtypes):
        setattr(self, name, ctypes.CFUNCTYPE(restype, *argtypes)(_addr(name)))


gl = GL()

VERTEX_SRC = """
#version 450 core
layout(location = 0) out vec2 qt_TexCoord0;
void main() {
    // Oversized triangle covering the viewport; texcoords span 0..1. Qt
    // Quick puts texcoord y = 0 at the top of the item, so flip y to match;
    // the read-back image is flipped again below, top row first.
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    qt_TexCoord0 = vec2(p.x, 1.0 - p.y);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"""


def _check(cond, msg):
    if not cond:
        raise RuntimeError(msg + " (egl err 0x%x)" % egl.eglGetError())


def make_context():
    dpy = ctypes.c_void_p(egl.eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, 0, None))
    _check(dpy, "eglGetPlatformDisplay failed")
    major, minor = c_int(), c_int()
    _check(egl.eglInitialize(dpy, ctypes.byref(major), ctypes.byref(minor)), "eglInitialize failed")

    cfg = c_void_p()
    count = c_int()
    cfg_attrs = [EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
                 EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
                 EGL_DEPTH_SIZE, 0, EGL_NONE]
    arr = (c_int * len(cfg_attrs))(*cfg_attrs)
    _check(egl.eglChooseConfig(dpy, arr, ctypes.byref(cfg), 1, ctypes.byref(count))
          and count.value >= 1, "eglChooseConfig failed")

    ctx_attrs = [EGL_CONTEXT_MAJOR_VERSION, 4, EGL_CONTEXT_MINOR_VERSION, 5,
                 EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE]
    carr = (c_int * len(ctx_attrs))(*ctx_attrs)
    egl.eglBindAPI(EGL_OPENGL_API)
    ctx = ctypes.c_void_p(egl.eglCreateContext(dpy, cfg, None, carr))
    _check(ctx, "eglCreateContext failed")

    pb_attrs = [EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE]
    parr = (c_int * len(pb_attrs))(*pb_attrs)
    surf = ctypes.c_void_p(egl.eglCreatePbufferSurface(dpy, cfg, parr))
    _check(surf, "eglCreatePbufferSurface failed")
    _check(egl.eglMakeCurrent(dpy, surf, surf, ctx), "eglMakeCurrent failed")

    gl.bind("glCreateShader", c_uint, [c_uint])
    gl.bind("glShaderSource", None, [c_uint, c_int, ctypes.POINTER(c_char_p), c_void_p])
    gl.bind("glCompileShader", None, [c_uint])
    gl.bind("glGetShaderiv", None, [c_uint, c_uint, ctypes.POINTER(c_int)])
    gl.bind("glGetShaderInfoLog", None, [c_uint, c_int, ctypes.POINTER(c_int), c_void_p])
    gl.bind("glCreateProgram", c_uint, [])
    gl.bind("glAttachShader", None, [c_uint, c_uint])
    gl.bind("glLinkProgram", None, [c_uint])
    gl.bind("glGetProgramiv", None, [c_uint, c_uint, ctypes.POINTER(c_int)])
    gl.bind("glGetProgramInfoLog", None, [c_uint, c_int, ctypes.POINTER(c_int), c_void_p])
    gl.bind("glUseProgram", None, [c_uint])
    gl.bind("glGetString", c_char_p, [c_uint])
    gl.bind("glGenBuffers", None, [c_int, ctypes.POINTER(c_uint)])
    gl.bind("glBindBuffer", None, [c_uint, c_uint])
    gl.bind("glBufferData", None, [c_uint, ctypes.c_ssize_t, c_void_p, c_uint])
    gl.bind("glBindBufferBase", None, [c_uint, c_uint, c_uint])
    gl.bind("glGenTextures", None, [c_int, ctypes.POINTER(c_uint)])
    gl.bind("glGenFramebuffers", None, [c_int, ctypes.POINTER(c_uint)])
    gl.bind("glGenVertexArrays", None, [c_int, ctypes.POINTER(c_uint)])
    gl.bind("glBindTexture", None, [c_uint, c_uint])
    gl.bind("glTexImage2D", None, [c_uint, c_int, c_int, c_int, c_int, c_int,
                                   c_uint, c_uint, c_void_p])
    gl.bind("glTexParameteri", None, [c_uint, c_uint, c_int])
    gl.bind("glBindFramebuffer", None, [c_uint, c_uint])
    gl.bind("glFramebufferTexture2D", None, [c_uint, c_uint, c_uint, c_uint, c_int])
    gl.bind("glCheckFramebufferStatus", c_uint, [c_uint])
    gl.bind("glBindVertexArray", None, [c_uint])
    gl.bind("glViewport", None, [c_int, c_int, c_int, c_int])
    gl.bind("glClearColor", None, [c_float, c_float, c_float, c_float])
    gl.bind("glClear", None, [c_uint])
    gl.bind("glDrawArrays", None, [c_uint, c_int, c_int])
    gl.bind("glFinish", None, [])
    gl.bind("glReadPixels", None, [c_int, c_int, c_int, c_int, c_uint, c_uint, c_void_p])
    return dpy


def compile_shader(kind, src):
    sid = gl.glCreateShader(kind)
    buf = c_char_p(src.encode())
    gl.glShaderSource(sid, 1, ctypes.byref(buf), None)
    gl.glCompileShader(sid)
    ok = c_int()
    gl.glGetShaderiv(sid, GL_COMPILE_STATUS, ctypes.byref(ok))
    if not ok.value:
        n = c_int()
        gl.glGetShaderiv(sid, GL_INFO_LOG_LENGTH, ctypes.byref(n))
        log = ctypes.create_string_buffer(n.value)
        gl.glGetShaderInfoLog(sid, n.value, None, log)
        raise RuntimeError("compile failed:\n" + log.value.decode())
    return sid


def build_program(frag_src):
    prog = gl.glCreateProgram()
    for kind, src in ((GL_VERTEX_SHADER, VERTEX_SRC), (GL_FRAGMENT_SHADER, frag_src)):
        gl.glAttachShader(prog, compile_shader(kind, src))
    gl.glLinkProgram(prog)
    ok = c_int()
    gl.glGetProgramiv(prog, GL_LINK_STATUS, ctypes.byref(ok))
    if not ok.value:
        n = c_int()
        gl.glGetProgramiv(prog, GL_INFO_LOG_LENGTH, ctypes.byref(n))
        log = ctypes.create_string_buffer(n.value)
        gl.glGetProgramInfoLog(prog, n.value, None, log)
        raise RuntimeError("link failed:\n" + log.value.decode())
    return prog


def parse_block(frag_src):
    """Return [(name, type, default_tuple)] for the members after qt_Opacity."""
    import re
    body = re.search(r"uniform\s+buf\s*\{(.*?)\};", frag_src, re.S).group(1)
    members, started = [], False
    for line in body.splitlines():
        m = re.match(r"\s*(float|vec4|mat4)\s+(\w+)\s*;(?:\s*//\s*=\s*(-?[\d.]+(?:\s*,\s*-?[\d.]+)*))?", line)
        if not m:
            continue
        typ, name, default = m.groups()
        if name == "qt_Opacity":
            started = True
            continue
        if not started:
            continue
        n = 1 if typ == "float" else 4
        vals = tuple(float(v) for v in default.split(",")) if default else (0.0,) * n
        if len(vals) != n:
            raise RuntimeError("bad default for %s" % name)
        members.append((name, typ, vals))
    return members


def pack_block(members, values):
    """std140: mat4 qt_Matrix at 0, qt_Opacity at 64, then the members."""
    offset = 68
    layout = []
    for name, typ, _ in members:
        align = 4 if typ == "float" else 16
        offset = (offset + align - 1) // align * align
        layout.append((name, offset))
        offset += 4 if typ == "float" else 16
    size = (offset + 15) // 16 * 16
    block = (c_float * (size // 4))()
    for i in (0, 5, 10, 15):
        block[i] = 1.0                       # identity qt_Matrix
    block[16] = 1.0                          # qt_Opacity
    for name, off in layout:
        for j, v in enumerate(values[name]):
            block[off // 4 + j] = v
    return block


def render(frag_src, out_path, t=0.0, width=1920, height=1080, overrides=()):
    make_context()
    version = gl.glGetString(GL_VERSION)
    if version is None:
        raise RuntimeError("no current GL context")
    prog = build_program(frag_src)
    gl.glUseProgram(prog)

    members = parse_block(frag_src)
    values = {name: default for name, _, default in members}
    values["u_time"] = (t,)
    values["u_aspect"] = (width / height,)
    for key, value in overrides:
        if key not in values:
            raise RuntimeError("unknown uniform %r; block has: %s" % (key, ", ".join(values)))
        if len(value) != len(values[key]):
            raise RuntimeError("%s takes %d value(s)" % (key, len(values[key])))
        values[key] = value

    # Qt Quick fills one uniform buffer and binds it to binding 0 for both
    # stages; do the same here. The block is nameless, so its members can
    # only be written through the UBO itself.
    block = pack_block(members, values)
    ubo = c_uint()
    gl.glGenBuffers(1, ctypes.byref(ubo))
    gl.glBindBuffer(GL_UNIFORM_BUFFER, ubo)
    gl.glBufferData(GL_UNIFORM_BUFFER, ctypes.sizeof(block), block, GL_STATIC_DRAW)
    gl.glBindBufferBase(GL_UNIFORM_BUFFER, 0, ubo)

    tex, fbo, vao = c_uint(), c_uint(), c_uint()
    gl.glGenTextures(1, ctypes.byref(tex))
    gl.glGenFramebuffers(1, ctypes.byref(fbo))
    gl.glGenVertexArrays(1, ctypes.byref(vao))
    gl.glBindTexture(GL_TEXTURE_2D, tex)
    gl.glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA,
                    GL_UNSIGNED_BYTE, None)
    for pname, val in ((GL_TEXTURE_MIN_FILTER, GL_LINEAR), (GL_TEXTURE_MAG_FILTER, GL_LINEAR),
                       (GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE), (GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)):
        gl.glTexParameteri(GL_TEXTURE_2D, pname, val)
    gl.glBindFramebuffer(GL_FRAMEBUFFER, fbo)
    gl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0)
    _check(gl.glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE,
           "incomplete framebuffer")

    gl.glBindVertexArray(vao)
    gl.glViewport(0, 0, width, height)
    gl.glClearColor(0, 0, 0, 1)
    gl.glClear(GL_COLOR_BUFFER_BIT)
    gl.glDrawArrays(GL_TRIANGLES, 0, 3)
    gl.glFinish()

    buf = ctypes.create_string_buffer(width * height * 4)
    gl.glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, buf)
    from PIL import Image
    img = Image.frombuffer("RGBA", (width, height), buf, "raw", "RGBA", 0, 1)
    img = img.transpose(Image.FLIP_TOP_BOTTOM)
    img.convert("RGB").save(out_path)
    return version, gl.glGetString(GL_RENDERER).decode()



if __name__ == "__main__":
    import sys
    frag = open(sys.argv[1]).read()
    out = sys.argv[2]
    t = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 1920
    h = int(sys.argv[5]) if len(sys.argv) > 5 else 1080
    extra = []
    for arg in sys.argv[6:]:
        k, v = arg.split("=")
        extra.append((k, tuple(float(x) for x in v.split(","))))
    ver, rend = render(frag, out, t, w, h, extra)
    print("wrote %s  %dx%d  t=%.2f" % (out, w, h, t))
    print(ver.decode(), "|", rend)
