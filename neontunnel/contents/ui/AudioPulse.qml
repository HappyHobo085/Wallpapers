/*
    Client for the audiopulse helper (../../../audiopulse in the source tree):
    a WebSocket on 127.0.0.1:47800 that systemd starts on first connection
    and that pushes ~60 JSON frames a second. Exposes the latest levels as
    plain properties. When the feed is down everything reads 0, live is
    false, and it retries every few seconds.
*/
import QtQuick
import QtWebSockets

Item {
    id: pulse

    property url url: "ws://127.0.0.1:47800"
    // Multiplies the band levels, from the wallpaper's Reactivity setting.
    property real gain: 1.0
    // False closes the connection (the helper then exits once idle) and
    // zeroes the levels; true reconnects.
    property bool listening: true

    readonly property bool live: socket.status === WebSocket.Open
    property real bass: 0
    property real mid: 0
    property real high: 0
    property real beat: 0          // 1 on a beat, decays to 0
    property real beatCount: 0
    property vector4d spec0: Qt.vector4d(0, 0, 0, 0)
    property vector4d spec1: Qt.vector4d(0, 0, 0, 0)
    property vector4d spec2: Qt.vector4d(0, 0, 0, 0)
    property vector4d spec3: Qt.vector4d(0, 0, 0, 0)

    function reset() {
        bass = 0; mid = 0; high = 0; beat = 0;
        spec0 = spec1 = spec2 = spec3 = Qt.vector4d(0, 0, 0, 0);
    }

    function lvl(x) {
        return Math.min(1, Math.max(0, x * pulse.gain));
    }

    WebSocket {
        id: socket
        url: pulse.url
        active: pulse.listening

        onTextMessageReceived: message => {
            let d;
            try {
                d = JSON.parse(message);
            } catch (e) {
                return;
            }
            const s = d.s;
            if (!s || s.length < 16)
                return;
            pulse.bass = pulse.lvl(d.b);
            pulse.mid = pulse.lvl(d.m);
            pulse.high = pulse.lvl(d.h);
            pulse.beat = d.e;
            pulse.beatCount = d.n;
            pulse.spec0 = Qt.vector4d(pulse.lvl(s[0]), pulse.lvl(s[1]), pulse.lvl(s[2]), pulse.lvl(s[3]));
            pulse.spec1 = Qt.vector4d(pulse.lvl(s[4]), pulse.lvl(s[5]), pulse.lvl(s[6]), pulse.lvl(s[7]));
            pulse.spec2 = Qt.vector4d(pulse.lvl(s[8]), pulse.lvl(s[9]), pulse.lvl(s[10]), pulse.lvl(s[11]));
            pulse.spec3 = Qt.vector4d(pulse.lvl(s[12]), pulse.lvl(s[13]), pulse.lvl(s[14]), pulse.lvl(s[15]));
        }

        onStatusChanged: status => {
            if (status === WebSocket.Error || status === WebSocket.Closed) {
                pulse.reset();
                if (pulse.listening)
                    retry.restart();
            }
        }
    }

    Timer {
        id: retry
        interval: 3000
        onTriggered: {
            if (!pulse.listening)
                return;
            socket.active = false;
            socket.active = pulse.listening;
        }
    }
}
