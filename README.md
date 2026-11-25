# Strata3d

Strata explores real places in a browser. Earth provides the globe, flight and geospatial layers. The photographic Plaza Mayor courtyard opens without an account. A separate reconstruction pipeline converts a video take into textured geometry and camera poses for free exploration.

See [public release readiness](docs/public-release.md) for the code license and asset permissions that must be resolved before redistribution.

## Run on your Mac

From this folder run `python3 -m http.server 8001 --bind 127.0.0.1`. Open [Earth](http://127.0.0.1:8001/) and choose **Photographic courtyard** or open [the courtyard directly](http://127.0.0.1:8001/panaderia.html?present=1&mode=run). Use WASD to move and drag to turn. The **Time and weather** panel records the hour, rain and cloud fraction in the URL. Current Madrid weather requires internet access. The existing Earth flight and other online layers require their respective services.

### Keyboard and mouse controls

Click inside the 3D view before using the keyboard. If you just used a search field or a weather control, click the scene again.

| View | Move | Look | Other controls |
| --- | --- | --- | --- |
| Earth · Fly low | W/A/S/D; Q rises, E descends | Drag; Left/Right turn, Up/Down tilt | Hold Shift to move faster; Esc exits low flight |
| Earth · Run | W/A/S/D | Drag or use Left/Right to turn | Hold Shift to sprint; Space jumps; use **Take off** to return to flight |
| Photographic courtyard | W/A/S/D | Drag or use Left/Right to turn | Hold Shift to move faster in the square; Space jumps in courtyard Run mode |
| Explore captures | W/A/S/D; Q descends, E rises | Drag or use Left/Right to turn | **Return to camera start** restores the opening camera |

## Reconstruct a new take

Requires a Mac supporting RealityKit Object Capture, macOS 14 or newer, Xcode Command Line Tools, Python 3.11 or newer, and FFmpeg. Run `xcrun swiftc --version` and `python3 --version` to check the tools. On a fresh Mac with Homebrew, run `brew install ffmpeg`. This Mac also has a local executable under .tools. Set FFMPEG to select an exact executable. SDKROOT can select a compatible SDK.

Start with one shopfront, arch or paving section. Film one continuous pass at native resolution. Walk sideways as well as forwards, return along a different path, and keep the same stonework in consecutive frames. Include both sides of columns, corners and recesses. Capture the façade and ground from several distances under consistent light. Moving crowds, edits, zoom changes and rotation from one fixed spot reduce usable coverage. Reserve a few separately captured viewpoints for checking the result.

```sh
python3 tools/capture/build.py "/path/to/your-take.mov" arcade-v1 \
  --fps 2 --detail medium --source "Creator, location, date, and footage rights"
```

Open [the capture viewer](http://127.0.0.1:8001/capture.html?scene=arcade-v1). Drag to turn, use WASD to translate and Q/E to change height. Return to camera start restores the estimated opening camera. Coordinates and movement speed are relative to the reconstruction. Survey scale, alignment with Earth and collision surfaces need independent measurements before treating the result as a mapped walk.

The builder extracts sequential full-resolution JPEGs, asks RealityKit for camera poses and a textured OBJ, validates the material and texture references, and writes the finished package to `captures/arcade-v1/`. It records each input SHA-256, sampling rate, frame count, detail level and toolchain versions in scene.json. A failed build leaves no selectable partial scene. Use a new scene identifier to compare revisions. The source clip is not copied. Reconstruction can vary with hardware and framework version.

Use preview detail to diagnose coverage and medium for browser review. Full increases texture and memory requirements. The builder checks for a colour texture and rejects runs with fewer than 75% of input camera poses registered. That threshold is a screening heuristic. Inspect the actual mesh from the opening camera, while strafing, facing the opposite direction, and near ground level. Compare these views against the held-out photographs. Record holes, floating objects, blurry sections and scale error before promoting a capture.

## Build and deploy

```sh
python3 tools/build_site.py _site
python3 -m http.server 8010 --bind 127.0.0.1 --directory _site
```

The output directory must be new. The builder stages the app pages, runtime modules, vendor libraries and site data. Reviewed reconstructions are opt-in through `captures/release.json`, a JSON array of scene identifiers. Include each selected scene's assets in the repository. Raw footage, developer tooling and local browser storage are outside the static artifact. Keep capture credits with each release and verify redistribution rights for its imagery and dependencies.

Use a private GitHub repository with `main` as the default branch. The workflow builds and runs the courtyard browser smoke test on pull requests and pushes to main. Deployment requires enabling **Settings → Pages → GitHub Actions** and manually running **Validate and deploy Strata** from main. Only the deployment job receives Pages write and OIDC permissions. Review site visibility and account eligibility before publishing. GitHub Pages may expose a site publicly even when its source repository is private.

For a local visual smoke test, run the site and start an isolated Chrome instance:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9296 --user-data-dir="$(mktemp -d)" about:blank &
STRATA_URL=http://127.0.0.1:8001/ node tools/check-courtyard.mjs
```

Requires Node 22 or newer. Captures are written to output/courtyard-conditions/. The automated test covers opening, time, rain and turning. Review the images before a presentation.

### Comparing a new capture with the source

The builder saves the first, middle and last registered source frames and their corresponding camera poses. In **Explore captures**, use **Next camera** and **Show source frame** to compare the texture and geometry with the original take. These are training views; an independent held-out walk is a stronger quality test. The viewer uses an approximate field of view, so this comparison is qualitative.

For an arcade with depth and hidden sides, supply overlapping takes together. For example, add `--also arcade-left.mov --also arcade-return.mov` to the build command. Every take must show common static features. The builder hashes each file, records its frame range, switches reconstruction to unordered matching, and checks pose registration per take. Each take contributes reference images for the viewer.
