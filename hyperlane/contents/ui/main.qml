import QtQuick
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    // Elapsed animation time, in seconds. Everything visible is derived from
    // this, so the wallpaper is deterministic and can be restarted freely.
    property real clock: 0

    // Warp speed multiplier: 1.0 is a steady cruise, 2.5 is a hard burn.
    property real speed: 1.0

    // Redraw cap, set by the "Frame cap" control in the wallpaper settings
    // panel. The scene costs ~0.3 ms per frame at 1080p, so 60 is
    // comfortable; drop it to 30 (or 15) to leave more headroom on a laptop.
    property int fps: root.configuration.FPS
    readonly property int frameInterval: Math.max(1, Math.round(1000 / Math.max(1, fps)))

    contextualActions: [
        PlasmaCore.Action {
            text: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Toggle Warp Speed")
            icon.name: "media-playback-start"
            onTriggered: {
                root.speed = root.speed > 1.5 ? 1.0 : 2.5;
                root.clock = 0;
            }
        }
    ]

    // Fully hidden behind app windows: stop animating.
    // Nothing then changes, so nothing is redrawn.
    CoverWatch {
        id: cover
    }
    readonly property bool paused: cover.covered

    // Advancing a shader-effect property marks the item dirty, so a plain
    // timer is all that is needed to drive the animation at a fixed rate.
    Timer {
        interval: root.frameInterval
        repeat: true
        running: !root.paused
        triggeredOnStart: true
        onTriggered: root.clock += (interval / 1000) * root.speed
    }

    ShaderEffect {
        anchors.fill: parent
        // The shader is opaque, so skip the blend stage.
        blending: false

        // Custom uniforms. They live in the nameless std140 block after
        // qt_Matrix and qt_Opacity, and Qt matches them by member name.
        property real u_time: root.clock
        property real u_aspect: width > 0 && height > 0 ? width / height : 16 / 9

        // Look controls, straight from the wallpaper configuration panel.
        property real u_zspeed: root.configuration.ZSpeed
        property real u_focal: root.configuration.Focal
        property real u_rib: root.configuration.Rib
        property real u_ring: root.configuration.Ring
        property real u_tmax: root.configuration.TMax
        // World period, derived so it stays a multiple of the rib and ring
        // spacings; scene.frag explains why it must.
        property real u_zwrap: 40 * root.configuration.Rib * root.configuration.Ring

        fragmentShader: "scene.frag.qsb"
    }
}
