# audiopulse — audio feed for the audio-reactive wallpapers

A small C++ helper that listens to whatever your default PipeWire output is
playing and streams its spectrum to the Neon Tunnel and Eclipse wallpapers
over a WebSocket on `127.0.0.1:47800`.

Every 16 ms it sends one JSON frame:

```json
{"b":0.61,"m":0.32,"h":0.18,"e":0.84,"n":127,"s":[16 band levels]}
```

| Key | Meaning |
| --- | --- |
| `b` `m` `h` | bass (40–180 Hz), mid (180 Hz–2.5 kHz), high (2.5–16 kHz), 0..1 |
| `e` | beat envelope: 1 on a detected beat, decays over ~0.2 s |
| `n` | beat counter; the wallpapers use it to re-roll their patterns |
| `s` | 16 log-spaced bands, 40 Hz–16 kHz, 0..1 |

Levels go through automatic gain control, so quiet and loud tracks both use
the full range. Beats are bass-onset detection: positive spectral flux in
30–180 Hz over an adaptive threshold.

## Install

```sh
./install.sh
```

This builds with CMake and installs `~/.local/bin/audiopulse` plus the
`audiopulse.socket` and `audiopulse.service` user units, then enables the
socket. Nothing runs until a wallpaper connects: systemd starts the helper on
the first connection, and the helper exits once it has had no clients for
10 s.

Build dependencies: `cmake`, `g++`, `qt6-qtbase-devel`,
`qt6-qtwebsockets-devel` (it also ships the `QtWebSockets` QML module the
wallpapers need), `pipewire-devel`, `systemd-devel`.

## Privacy

* It binds to loopback only.
* It sends levels, never audio: 16 band values and a beat count.
* It refuses any client that sends an `Origin` header, which every browser
  does, so web pages cannot read the feed. The wallpapers' QML WebSocket
  sends no Origin.
* Any local process can still connect, as with any localhost port.

## Debugging

```sh
systemctl --user status audiopulse.socket audiopulse.service
journalctl --user -u audiopulse.service
```

Run by hand, the helper binds the port itself and never idles out. Stop the
socket first so the port is free:

```sh
systemctl --user stop audiopulse.socket
./build/audiopulse
```

## Uninstall

```sh
./install.sh uninstall
```
