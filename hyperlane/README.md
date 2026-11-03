# Hyperlane — a live sci-fi wallpaper for KDE Plasma 6

A GPU-rendered flight down a neon service corridor: glowing edge rails and
cross ribs flying past, lit panels flickering in the walls, dust in the air,
and a pulsing hyperdrive core at the vanishing point. Everything is drawn
per-pixel by a fragment shader, so it is resolution independent and costs
about 0.3 ms per frame at 1920x1080 on an RTX 3060 Ti.

## Using it

* **Wallpaper grid**: Desktop Settings → Wallpaper → *Hyperlane*.
* **Or from the command line** (applies to screen 0 immediately):

  ```sh
  gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
      --method org.kde.PlasmaShell.setWallpaper "org.happyhobo.hyperlane" "{}" 0
  ```

* **Right-click the wallpaper in the settings dialog** (or use the wallpaper
  context menu) for *Toggle Warp Speed*, which switches between a cruise and a
  hard burn.


It pauses while its screen is completely hidden behind app windows (on the
current virtual desktop and activity), so it costs nothing behind a
maximized, fullscreen or tiled set of windows. Translucent windows count as covering.

## Tuning it live

Select *Hyperlane* in Desktop Settings → Wallpaper and the panel beside the
grid exposes the controls:

| Control | Key | Effect |
| --- | --- | --- |
| Flight speed | `ZSpeed` | how fast the camera flies, units per second |
| Field of view | `Focal` | lower is wider |
| Rib spacing | `Rib` | spacing of the cross ribs |
| Ring spacing | `Ring` | spacing of the sweeping light rings |
| View distance | `TMax` | how far the corridor stays visible |
| Frame cap | `FPS` | redraw rate; drop it to 30 to save power |

Changes take effect on Apply, no rebuild needed. The world period is not
exposed: it is derived as `40 x Rib x Ring` so it always stays a multiple of
both spacings and the camera wrap stays invisible.

Deeper changes — palette, materials, the corridor itself — still mean
editing `contents/ui/scene.frag`, then:

```sh
./build.sh
```

`build.sh` bakes `scene.frag` into `scene.frag.qsb` (Qt 6 requires shader
packages rather than inline GLSL), renders `contents/preview.png` with the
offscreen renderer in `tools/render.py`, and installs or upgrades the package
into `~/.local/share/plasma/wallpapers/`. If Hyperlane is on a desktop it then restarts
plasmashell, which keeps the old shader loaded otherwise; `NO_RELOAD=1
./build.sh` skips that.

To try a look without installing it, render a single frame with the same
overrides the settings panel offers:

```sh
python3 tools/render.py contents/ui/scene.frag /tmp/look.png 45 1920 1080 ZSpeed=18 Rib=3
```

The third argument is the animation time in seconds — the scene is a pure
function of it, so any value gives a reproducible frame. The trailing
`Key=value` pairs override `ZSpeed`, `Focal`, `Rib`, `Ring` and `TMax`.

## Requirements

* Plasma 6 (developed and tested on 6.7, Fedora/Nobara based)
* `qsb` from `qt6-qtshadertools`, only to rebuild after editing the shader
* Pillow, only for the offscreen preview renderer

## Uninstall

```sh
kpackagetool6 --type Plasma/Wallpaper --remove org.happyhobo.hyperlane
```
