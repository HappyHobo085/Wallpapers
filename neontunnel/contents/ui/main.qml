import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    // Elapsed time and distance flown. The shader is a pure function of
    // these plus the audio levels, so the wallpaper restarts cleanly.
    property real clock: 0
    property real travel: 0

    property int fps: root.configuration.FPS
    readonly property int frameInterval: Math.max(1, Math.round(1000 / Math.max(1, fps)))

    // Fully hidden behind app windows: stop animating and stop listening.
    // Nothing then changes, so nothing is redrawn.
    CoverWatch {
        id: cover
    }
    readonly property bool paused: cover.covered

    AudioPulse {
        id: audio
        gain: root.configuration.Reactivity
        listening: !root.paused
    }

    // Advancing a shader-effect property marks the item dirty, so a plain
    // timer is all that is needed to drive the animation at a fixed rate.
    Timer {
        interval: root.frameInterval
        repeat: true
        running: !root.paused
        triggeredOnStart: true
        onTriggered: {
            const dt = interval / 1000;
            root.clock += dt;
            // Cruise when idle; bass pushes the throttle, beats kick it.
            const push = audio.live ? 0.6 + 1.6 * audio.bass + 1.2 * audio.beat : 0.6;
            root.travel += dt * root.configuration.Speed * push;
        }
    }

    ShaderEffect {
        anchors.fill: parent
        blending: false

        // Matched to scene.frag's uniform block by member name.
        property real u_time: root.clock
        property real u_aspect: width > 0 && height > 0 ? width / height : 16 / 9
        property real u_travel: root.travel
        property real u_bass: audio.bass
        property real u_mid: audio.mid
        property real u_high: audio.high
        property real u_beat: audio.beat
        property real u_beatn: audio.beatCount
        property real u_live: audio.live ? 1 : 0
        property real u_hue: root.configuration.Hue * Math.PI / 180
        property vector4d u_spec0: audio.spec0
        property vector4d u_spec1: audio.spec1
        property vector4d u_spec2: audio.spec2
        property vector4d u_spec3: audio.spec3

        fragmentShader: "scene.frag.qsb"
    }
}
