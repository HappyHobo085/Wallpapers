/*
    Configuration panel for the Hyperlane wallpaper. Plasma embeds this in
    Desktop Settings -> Wallpaper while Hyperlane is the selected wallpaper.
*/

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

// The cfg_* properties are the Plasma wallpaper config plumbing: each maps
// to the entry of the same name in contents/config/main.xml. The
// cfg_*Default properties give the settings dialog its reset values.
Kirigami.FormLayout {
    id: root

    twinFormLayouts: parentLayout

    property var parentLayout
    // Declared so the KCM can set its initial properties without warnings;
    // the panel itself only uses the cfg_* bindings below.
    property var configDialog
    property var wallpaperConfiguration
    property alias cfg_ZSpeed: zspeedSlider.value
    property alias cfg_Focal: focalSlider.value
    property alias cfg_Rib: ribSlider.value
    property alias cfg_Ring: ringSlider.value
    property alias cfg_TMax: tmaxSlider.value
    property alias cfg_FPS: fpsSpin.value

    property real cfg_ZSpeedDefault: 6.0
    property real cfg_FocalDefault: 1.35
    property real cfg_RibDefault: 2.0
    property real cfg_RingDefault: 12.0
    property real cfg_TMaxDefault: 40.0
    property int cfg_FPSDefault: 60

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Flight speed")
        QQC2.Slider {
            id: zspeedSlider
            Layout.fillWidth: true
            from: 1.0
            to: 30.0
            stepSize: 0.5
        }
        QQC2.Label { text: zspeedSlider.value.toFixed(1) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Field of view (lower is wider)")
        QQC2.Slider {
            id: focalSlider
            Layout.fillWidth: true
            from: 0.8
            to: 2.5
            stepSize: 0.05
        }
        QQC2.Label { text: focalSlider.value.toFixed(2) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Rib spacing")
        QQC2.Slider {
            id: ribSlider
            Layout.fillWidth: true
            from: 0.5
            to: 8.0
            stepSize: 0.1
        }
        QQC2.Label { text: ribSlider.value.toFixed(1) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Ring spacing")
        QQC2.Slider {
            id: ringSlider
            Layout.fillWidth: true
            from: 4.0
            to: 40.0
            stepSize: 1.0
        }
        QQC2.Label { text: ringSlider.value.toFixed(0) }
    }

    RowLayout {
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "View distance")
        QQC2.Slider {
            id: tmaxSlider
            Layout.fillWidth: true
            from: 5.0
            to: 40.0
            stepSize: 5.0
        }
        QQC2.Label { text: tmaxSlider.value.toFixed(0) }
    }

    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.happyhobo.hyperlane", "Frame cap (FPS)")
        from: 15
        to: 144
        editable: true
    }
}
