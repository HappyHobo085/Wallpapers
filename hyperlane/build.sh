#!/usr/bin/env bash
# Bake the shader, refresh the preview, and (re)install the package.
#
#   ./build.sh          bake + preview + install
#   ./build.sh bake     just recompile scene.frag -> scene.frag.qsb
#
# Requires: qsb (Qt Shader Baker, package qt6-qtshadertools) and, for the
# preview, the offscreen renderer in tools/render.py (Pillow).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ui="$here/contents/ui"
qsb="${QSB:-/usr/lib64/qt6/bin/qsb}"
[ -x "$qsb" ] || qsb="$(command -v qsb)"

# Qt 6 ShaderEffect takes pre-baked shader packages, not GLSL source. Bake for
# every GL flavour Qt might pick, plus SPIR-V for Vulkan.
bake() {
    echo "baking $ui/scene.frag"
    "$qsb" --glsl "100 es,120,150,330,450" -o "$ui/scene.frag.qsb" "$ui/scene.frag"
}

preview() {
    echo "rendering preview"
    python3 "$here/tools/render.py" "$ui/scene.frag" "$here/contents/preview.png" \
        "${1:-45}" 1600 900
}

install_pkg() {
    echo "installing"
    if kpackagetool6 --type Plasma/Wallpaper --show org.happyhobo.hyperlane >/dev/null 2>&1; then
        kpackagetool6 --type Plasma/Wallpaper --upgrade "$here"
    else
        kpackagetool6 --type Plasma/Wallpaper --install "$here"
    fi
}

case "${1:-all}" in
    bake)    bake ;;
    preview) bake; preview "${2:-45}" ;;
    *)       bake; preview "${2:-45}"; install_pkg ;;
esac

echo "done"
