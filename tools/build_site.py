"""Assemble the static Pages artifact from the app and explicitly released captures."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import re

ROOT = Path(__file__).resolve().parents[1]
APP = """index.html strata8.html strata8-xr.html plaza-survey.html panaderia.html
panaderia-exterior.html panaderia-exterior.js panaderia.js plaza-courtyard.js
plaza-frontage-walls.js plaza-interior.js plaza-run-visuals.js courtyard-weather.js
plaza-entrance.js plaza-road.js strata-perf.js strata8-street.js strata8-water.js
calle-mayor.js market-route.js capture.html capture.js""".split()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="New output directory")
    args = parser.parse_args()
    dest = args.destination.resolve()
    if dest.exists():
        parser.error("Destination must be new")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        site = Path(tmp) / "site"
        site.mkdir()
        def copy(path):
            if path.is_symlink() or not path.is_file() or path.resolve() != path:
                raise ValueError(f"Invalid release file: {path.name}")
            target = site / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        for name in APP:
            copy(ROOT/name)
        for folder, extensions in [
            ("data",{".bin",".f32",".glb",".jpg",".json",".png",".webp"}),
            ("vendor",{".js",".wasm"})]:
            for path in (ROOT/folder).rglob("*"):
                if path.is_file() and (path.suffix in extensions or path.name=="LICENSE"):
                    copy(path)
        for slug in json.loads((ROOT/"captures/release.json").read_text()):
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}",slug):
                raise ValueError("Invalid release identifier")
            folder=ROOT/"captures"/slug
            manifest=json.loads((folder/"scene.json").read_text())
            for key in ("mesh","material"):
                if not (folder/manifest[key]).resolve().is_relative_to(folder) or not (folder/manifest[key]).is_file():
                    raise ValueError("Missing capture model or material")
            for path in folder.rglob("*"):
                if path.is_file() and path.suffix.lower() in {".obj",".mtl",".png",".jpg",".jpeg",".json"}:
                    copy(path)
        copy(ROOT/"captures/release.json")
        (site/".nojekyll").touch()
        site.rename(dest)
    print(f"Built {sum(p.is_file() for p in dest.rglob('*'))} files in {dest}")


if __name__ == "__main__":
    main()
