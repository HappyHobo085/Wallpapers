#!/usr/bin/env bash
# Build audiopulse and install it as a socket-activated systemd user service.
#
#   ./install.sh            build + install + enable the socket
#   ./install.sh uninstall  stop, disable and remove everything it installed
#
# Requires: cmake, g++, qt6-qtbase-devel, qt6-qtwebsockets-devel (also ships
# the QtWebSockets QML module the wallpapers use), pipewire-devel,
# systemd-devel.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin/audiopulse"
units="$HOME/.config/systemd/user"

if [ "${1:-}" = uninstall ]; then
    systemctl --user disable --now audiopulse.socket 2>/dev/null || true
    systemctl --user stop audiopulse.service 2>/dev/null || true
    rm -f "$bin" "$units/audiopulse.socket" "$units/audiopulse.service"
    systemctl --user daemon-reload
    echo "uninstalled"
    exit 0
fi

cmake -S "$here" -B "$here/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$here/build" -j

install -Dm755 "$here/build/audiopulse" "$bin"
install -Dm644 "$here/audiopulse.socket" "$units/audiopulse.socket"
install -Dm644 "$here/audiopulse.service" "$units/audiopulse.service"
systemctl --user daemon-reload
# Restart a running instance so it picks up a rebuilt binary.
systemctl --user stop audiopulse.service 2>/dev/null || true
systemctl --user enable --now audiopulse.socket
echo "installed; listening on 127.0.0.1:47800 (started on demand)"
