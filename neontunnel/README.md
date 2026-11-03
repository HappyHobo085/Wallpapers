# Neon Tunnel — an audio-reactive wallpaper for KDE Plasma 6

A flight down an octagonal tunnel of violet neon, driven by whatever your
speakers are playing:

* **Quiet passages**: a faint wireframe of rings and corner seams.
* **Bass**: lights broken rib segments around each ring and pushes the
  flight speed. Each side of the octagon follows its own part of the
  spectrum, with bass at the bottom and treble at the top.
* **Beats**: flood random wall bays with white-hot slats, snap the tunnel's
  rotation, and re-roll which bays and segments are lit.
* **Highs**: fire thin streaks out of the vanishing point.

With no audio feed it breathes slowly on its own.

## Needs

[`../audiopulse`](../audiopulse) installed (`./install.sh` there). The
wallpaper connects to it on `127.0.0.1:47800`, and systemd starts it on
demand.

## Using it

* **Wallpaper grid**: Desktop Settings → Wallpaper → *Neon Tunnel*.
* **Or from the command line** (screen 0):

  ```sh
  gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
      --method org.kde.PlasmaShell.setWallpaper "org.happyhobo.neontunnel" "{}" 0
  ```

| Control | Key | Effect |
| --- | --- | --- |
| Flight speed | `Speed` | base speed in rings per second |
| Reactivity | `Reactivity` | multiplier on the audio levels |
| Hue shift | `Hue` | rotates the palette, in degrees |
| Frame cap | `FPS` | redraw rate |


It pauses while its screen is completely hidden behind app windows (on the
current virtual desktop and activity), so it costs nothing behind a
maximized, fullscreen or tiled set of windows, and it disconnects from
audiopulse so the helper can exit. Translucent windows count as covering.

## Editing

Edit `contents/ui/scene.frag`, then run `./build.sh`. It bakes the shader,
renders `contents/preview.png` and upgrades the installed package.
If the wallpaper is on a desktop it then restarts plasmashell, which keeps
the old shader loaded otherwise; `NO_RELOAD=1 ./build.sh` skips that.

Preview any audio state without installing. Any uniform can be overridden:

```sh
python3 tools/render.py contents/ui/scene.frag /tmp/look.png 12 1920 1080 u_beat=1 u_bass=0.9
```

Keep the shader free of integer maths. Qt may pick the GLSL 1.20 variant,
which rejects integer bit operations and dynamic vec4 indexing, while
`tools/render.py` compiles as GLSL 4.5 and will not catch them.

## Uninstall

```sh
kpackagetool6 --type Plasma/Wallpaper --remove org.happyhobo.neontunnel
```
