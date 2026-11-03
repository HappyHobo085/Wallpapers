# Eclipse — an audio-reactive wallpaper for KDE Plasma 6

A raised, 2.5D view over a crater of broken teal rubble and crystal spikes,
drifting toward a red eclipse with a splatter of red shards flung up behind
it. It is raymarched, so the rubble is real geometry, lit by the ring, then
finished in a second pass with depth of field focused on the ring, bloom,
slight chromatic aberration, film grain and a vignette:

* **Spectrum**: raises the rubble, with bass along the line under the ring
  and treble out to the sides. It also sets how far the red shards behind
  the ring reach, with bass at the top.
* **Bass**: swells the ring, burns its rim hotter and throws its red light
  across the rubble.
* **Beats**: blast chunks out of the ring at the camera, set off explosions
  round its lower rim, pop random rocks up, kick the view wider and flood
  the frame red.
* **Highs**: make the crystal spikes glow.

With no audio feed the ring breathes slowly on its own.

## Needs

[`../audiopulse`](../audiopulse) installed (`./install.sh` there). The
wallpaper connects to it on `127.0.0.1:47800`, and systemd starts it on
demand.

## Using it

* **Wallpaper grid**: Desktop Settings → Wallpaper → *Eclipse*.
* **Or from the command line** (screen 0):

  ```sh
  gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
      --method org.kde.PlasmaShell.setWallpaper "org.happyhobo.eclipse" "{}" 0
  ```

| Control | Key | Effect |
| --- | --- | --- |
| Flight speed | `Speed` | base drift, units per second |
| Reactivity | `Reactivity` | multiplier on the audio levels |
| Hue shift | `Hue` | rotates the palette, in degrees |
| Camera distance | `CameraDistance` | 1 = closest; up to 3x further back, same viewing angle |
| Depth of field | `DepthOfField` | blur strength away from the ring; 0 = off |
| Render scale | `RenderScale` | fraction of screen resolution to raymarch at |
| Frame cap | `FPS` | redraw rate |

Cost: on this machine's RTX 3060 Ti at 1080p, one frame takes about 11 ms
of GPU time at Render scale 1.0 (10.6 ms raymarch, 0.5 ms bloom copy, 0.6 ms
finishing pass), so 60 fps keeps the GPU roughly two-thirds busy. Almost all
of it is the raymarch, which scales with pixel count: Render scale 0.85 costs
about 9 ms a frame and 0.75 about 7.4 ms. Halving the Frame cap halves the
cost. Plasma renders each screen separately, so the cost adds up per monitor.

## Editing

The look lives in two shaders: `contents/ui/scene.frag` raymarches the
scene into a texture (colour in RGB, depth in alpha, 0.5 = in focus) and
`contents/ui/post.frag` finishes it. Edit either, then run `./build.sh`.
It bakes both shaders, renders `contents/preview.png` and upgrades the installed package.
If the wallpaper is on a desktop it then restarts plasmashell, which keeps
the old shader loaded otherwise; `NO_RELOAD=1 ./build.sh` skips that.

```sh
python3 tools/render.py contents/ui/scene.frag /tmp/look.png 30 1920 1080 u_beat=1 u_bass=0.9 \
    --post contents/ui/post.frag
```

Keep the shader free of integer maths, apart from loop counters. Qt may pick
the GLSL 1.20 variant, and `tools/render.py` compiles as GLSL 4.5, so it will
not catch integer errors.

## Uninstall

```sh
kpackagetool6 --type Plasma/Wallpaper --remove org.happyhobo.eclipse
```
