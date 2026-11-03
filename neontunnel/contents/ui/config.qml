/*
    Configuration panel for the Neon Tunnel wallpaper. Plasma embeds this in
    Desktop Settings -> Wallpaper while Neon Tunnel is the selected wallpaper.
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
    property alias cfg_FPS: fpsSpin.value

    property real cfg_SpeedDefault: 1.5
    property real cfg_ReactivityDefault: 1.0
    property real cfg_HueDefault: 0.0
    property int cfg_FPSDefault: 60

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.neontunnel", "Flight speed")
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
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.neontunnel", "Reactivity")
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
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.neontunnel", "Hue shift")
        QQC2.Slider {
            id: hueSlider
            Layout.fillWidth: true
            from: -180
            to: 180
            stepSize: 5
        }
        QQC2.Label { text: hueSlider.value.toFixed(0) + "°" }
    }

    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.neontunnel", "Frame cap (FPS)")
        from: 15
        to: 144
        editable: true
    }
}
