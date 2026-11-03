#!/usr/bin/env bash
# Bake the shader, refresh the preview, and (re)install the package.
#
#   ./build.sh          bake + preview + install, then restart plasmashell
#                       if this wallpaper is in use (NO_RELOAD=1 skips that)
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
        "${1:-12}" 1600 900
}

install_pkg() {
    echo "installing"
    if kpackagetool6 --type Plasma/Wallpaper --show org.happyhobo.neontunnel >/dev/null 2>&1; then
        kpackagetool6 --type Plasma/Wallpaper --upgrade "$here"
    else
        kpackagetool6 --type Plasma/Wallpaper --install "$here"
    fi
}

# A running plasmashell keeps the old shader and QML loaded, so restart it,
# but only when this wallpaper is on a desktop; otherwise nothing would change
# and the desktop would blink for no reason. NO_RELOAD=1 skips it.
reload() {
    local rc="${XDG_CONFIG_HOME:-$HOME/.config}/plasma-org.kde.plasma.desktop-appletsrc"
    if [ -n "${NO_RELOAD:-}" ]; then
        echo "NO_RELOAD set; restart plasmashell yourself to see the change"
    elif grep -qx 'wallpaperplugin=org.happyhobo.neontunnel' "$rc" 2>/dev/null; then
        echo "org.happyhobo.neontunnel is in use; restarting plasmashell"
        systemctl --user restart plasma-plasmashell
    else
        echo "org.happyhobo.neontunnel is not in use; no restart needed"
    fi
}

case "${1:-all}" in
    bake)    bake ;;
    preview) bake; preview "${2:-12}" ;;
    *)       bake; preview "${2:-12}"; install_pkg; reload ;;
esac

echo "done"
