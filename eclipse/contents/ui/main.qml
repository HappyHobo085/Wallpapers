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
            // Slow drift; bass nudges it forward, beats give a short surge.
            const push = audio.live ? 0.7 + 0.8 * audio.bass + 1.5 * audio.beat : 0.7;
            root.travel += dt * root.configuration.Speed * push;
        }
    }

    // Pass 1: the raymarched scene. It is the expensive part, so it renders
    // into a texture at the Render scale; colour in RGB, depth in alpha.
    ShaderEffect {
        id: scene
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
        property real u_camdist: root.configuration.CameraDistance
        property vector4d u_spec0: audio.spec0
        property vector4d u_spec1: audio.spec1
        property vector4d u_spec2: audio.spec2
        property vector4d u_spec3: audio.spec3

        fragmentShader: "scene.frag.qsb"
    }

    ShaderEffectSource {
        id: sceneTexture
        sourceItem: scene
        hideSource: true
        visible: false
        smooth: true
        readonly property real renderScale: root.configuration.RenderScale
        textureSize: Qt.size(Math.max(1, Math.round(root.width * renderScale)),
                             Math.max(1, Math.round(root.height * renderScale)))
    }

    // The same scene again at 1/8 size, for the bloom: a few bilinear taps
    // of it glow smoothly where taps of the full-size texture would speckle.
    // Rendering it costs about 1/64 of the main pass.
    ShaderEffectSource {
        id: bloomTexture
        sourceItem: scene
        hideSource: true
        visible: false
        smooth: true
        textureSize: Qt.size(Math.max(1, Math.round(root.width / 8)),
                             Math.max(1, Math.round(root.height / 8)))
    }

    // Pass 2: depth of field, anti-aliasing, bloom, aberration and vignette, at full
    // resolution. Cheap next to the raymarch.
    ShaderEffect {
        anchors.fill: parent
        blending: false

        property variant source: sceneTexture
        property variant bloomSource: bloomTexture
        property real u_time: root.clock
        property real u_aspect: width > 0 && height > 0 ? width / height : 16 / 9
        property real u_texw: 1 / Math.max(1, sceneTexture.textureSize.width)
        property real u_texh: 1 / Math.max(1, sceneTexture.textureSize.height)
        property real u_dof: root.configuration.DepthOfField

        fragmentShader: "post.frag.qsb"
    }
}
