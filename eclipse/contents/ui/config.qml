/*
    Configuration panel for the Eclipse wallpaper. Plasma embeds this in
    Desktop Settings -> Wallpaper while Eclipse is the selected wallpaper.
*/

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

// Each cfg_* property maps to the entry of the same name in
// contents/config/main.xml; cfg_*Default gives the dialog its reset values.
Kirigami.FormLayout {
    id: root

    twinFormLayouts: parentLayout

    property var parentLayout
    property var configDialog
    property var wallpaperConfiguration
    property alias cfg_Speed: speedSlider.value
    property alias cfg_Reactivity: reactSlider.value
    property alias cfg_Hue: hueSlider.value
    property alias cfg_CameraDistance: distSlider.value
    property alias cfg_DepthOfField: dofSlider.value
    property alias cfg_RenderScale: scaleSlider.value
    property alias cfg_FPS: fpsSpin.value

    property real cfg_SpeedDefault: 0.8
    property real cfg_ReactivityDefault: 1.0
    property real cfg_HueDefault: 0.0
    property real cfg_CameraDistanceDefault: 1.0
    property real cfg_DepthOfFieldDefault: 1.0
    property real cfg_RenderScaleDefault: 1.0
    property int cfg_FPSDefault: 60

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Flight speed")
        QQC2.Slider {
            id: speedSlider
            Layout.fillWidth: true
            from: 0.2
            to: 5.0
            stepSize: 0.1
        }
        QQC2.Label { text: speedSlider.value.toFixed(1) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Reactivity")
        QQC2.Slider {
            id: reactSlider
            Layout.fillWidth: true
            from: 0.25
            to: 3.0
            stepSize: 0.05
        }
        QQC2.Label { text: reactSlider.value.toFixed(2) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Hue shift")
        QQC2.Slider {
            id: hueSlider
            Layout.fillWidth: true
            from: -180
            to: 180
            stepSize: 5
        }
        QQC2.Label { text: hueSlider.value.toFixed(0) + "°" }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Camera distance")
        QQC2.Slider {
            id: distSlider
            Layout.fillWidth: true
            from: 1.0
            to: 3.0
            stepSize: 0.05
        }
        QQC2.Label { text: distSlider.value.toFixed(2) + "×" }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Depth of field")
        QQC2.Slider {
            id: dofSlider
            Layout.fillWidth: true
            from: 0.0
            to: 2.0
            stepSize: 0.1
        }
        QQC2.Label { text: dofSlider.value.toFixed(1) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Render scale")
        QQC2.Slider {
            id: scaleSlider
            Layout.fillWidth: true
            from: 0.4
            to: 1.0
            stepSize: 0.05
        }
        QQC2.Label { text: Math.round(scaleSlider.value * 100) + "%" }
    }

    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.eclipse", "Frame cap (FPS)")
        from: 15
        to: 144
        editable: true
    }
}
