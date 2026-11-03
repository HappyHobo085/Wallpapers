/*
    Tells the wallpaper when its screen is completely hidden behind app
    windows, so it can stop animating and stop listening to audio.

    Same approach as Plasma's own panel uses for "dodge windows": a task
    model of the non-minimized windows on the current virtual desktop and
    activity that overlap this screen. The screen counts as covered when a
    grid of sample points over its usable area (the part not taken by
    panels) all fall inside some window, which handles maximized, fullscreen
    and tiled layouts alike. Translucent windows count as covering.
*/
import QtQuick
import QtQuick.Window
import org.kde.plasma.plasmoid
import org.kde.taskmanager as TaskManager

Item {
    id: watch

    readonly property bool covered: coveredNow
    property bool coveredNow: false

    // Whole screen in global coordinates, which is what the task model
    // reports window geometry in.
    readonly property rect screenRect: Qt.rect(Screen.virtualX, Screen.virtualY, Screen.width, Screen.height)

    // The part of the screen not taken by panels; maximized windows stop at
    // its edge. Converted to global coordinates if the containment reports
    // it relative to the screen.
    readonly property rect usableRect: {
        const c = Plasmoid.containment;
        const a = c ? c.availableScreenRect : null;
        const s = watch.screenRect;
        if (!a || a.width <= 0 || a.height <= 0)
            return s;
        const inside = a.x >= s.x && a.y >= s.y
                    && a.x + a.width <= s.x + s.width && a.y + a.height <= s.y + s.height;
        return inside ? a : Qt.rect(a.x + s.x, a.y + s.y, a.width, a.height);
    }

    TaskManager.ActivityInfo {
        id: activityInfo
    }

    TaskManager.TasksModel {
        id: tasks
        filterByCurrentVirtualDesktop: true
        filterByActivity: true
        activity: activityInfo.currentActivity
        filterByScreen: false
        filterByRegion: TaskManager.RegionFilterMode.Intersect
        regionGeometry: watch.screenRect
        screenGeometry: watch.screenRect
        filterHidden: true
        filterMinimized: true
        groupMode: TaskManager.TasksModel.GroupDisabled

        onCountChanged: recheck.restart()
        onDataChanged: recheck.restart()
        onModelReset: recheck.restart()
    }

    onUsableRectChanged: recheck.restart()

    // Window moves arrive as bursts of dataChanged; settle before checking.
    Timer {
        id: recheck
        interval: 150
        onTriggered: watch.coveredNow = watch.compute()
    }

    Component.onCompleted: recheck.restart()

    function compute() {
        const s = watch.usableRect;
        if (s.width <= 0 || s.height <= 0 || tasks.count === 0)
            return false;
        const rects = [];
        for (let i = 0; i < tasks.count; ++i) {
            const g = tasks.data(tasks.index(i, 0), TaskManager.AbstractTasksModel.Geometry);
            if (g && g.width > 0 && g.height > 0)
                rects.push(g);
        }
        const nx = 48, ny = 27;
        for (let y = 0; y < ny; ++y) {
            const py = s.y + (y + 0.5) * s.height / ny;
            for (let x = 0; x < nx; ++x) {
                const px = s.x + (x + 0.5) * s.width / nx;
                if (!rects.some(r => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height))
                    return false;
            }
        }
        return true;
    }
}
