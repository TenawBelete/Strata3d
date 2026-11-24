"""Recover camera poses and a textured mesh from one continuous camera take."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def run(*args):
    subprocess.run(list(map(str, args)), check=True)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def package(model, cameras, frames, target, metadata):
    meshes = list(model.rglob("*.obj"))
    if len(meshes) != 1:
        raise ValueError("Expected one OBJ model from Object Capture")
    mesh = meshes[0]
    def relative_asset(parent, name):
        path = (parent / name).resolve()
        if not path.is_relative_to(model.resolve()) or not path.is_file():
            raise ValueError(f"Missing or invalid model asset: {name}")
        return path
    with mesh.open() as stream:
        libraries = [line[7:].strip() for line in stream if line.startswith("mtllib ")]
    if len(libraries) != 1:
        raise ValueError("Expected one texture material library")
    material = relative_asset(mesh.parent, libraries[0])
    textures = [line.split(maxsplit=1)[1].strip() for line in material.read_text().splitlines()
                if line.strip().lower().startswith("map_kd ")]
    if not textures:
        raise ValueError("Reconstruction is missing its colour texture")
    poses = json.loads(cameras.read_text())
    if len(poses) < 3 or len(poses) < .75 * metadata["frames"]:
        raise ValueError(f'Only {len(poses)}/{metadata["frames"]} camera poses recovered')
    assets = {mesh, material}
    for line in material.read_text().splitlines():
        parts = line.strip().split(maxsplit=1)
        if len(parts) == 2 and (parts[0].lower().startswith("map_") or parts[0].lower() in {"bump","norm"}):
            assets.add(relative_asset(material.parent, parts[1]))
    for asset in assets:
        dest = target / asset.relative_to(model)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(asset, dest)
    references = []
    selected = set()
    for take in metadata["takes"]:
        indices = [i for i, pose in enumerate(poses)
                   if pose["frame"].endswith(".jpg") and take["first"] <= int(pose["frame"][:-4]) <= take["last"]]
        if len(indices) < .75 * (1+take["last"]-take["first"]):
            raise ValueError("Insufficient camera coverage in take "+take["name"])
        selected.update([indices[0], indices[len(indices)//2], indices[-1]])
    for index in sorted(selected):
        name = poses[index]["frame"]
        if not re.fullmatch(r"[0-9]{6}\.jpg", name):
            raise ValueError("Camera reference could not be matched to an extracted frame")
        frame = frames/name
        name = f"reference-{index}.jpg"
        shutil.copyfile(frame, target/name)
        references.append({"camera":index, "image":name})
    metadata["references"] = references
    metadata.update(mesh=mesh.relative_to(model).as_posix(), material=material.relative_to(model).as_posix(),
                    cameras=poses, formatVersion=1)
    (target / "scene.json").write_text(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("scene", help="Lowercase scene identifier")
    parser.add_argument("--also", action="append", default=[], type=Path, help="Additional overlapping take of the same location")
    parser.add_argument("--fps", type=int, default=2, choices=range(1, 11))
    parser.add_argument("--detail", choices=["preview", "medium", "full"], default="medium")
    parser.add_argument("--source", required=True, help="Footage credit and source")
    args = parser.parse_args()
    if not re.fullmatch("[a-z0-9][a-z0-9-]{0,63}", args.scene):
        parser.error("Invalid scene name")
    out = ROOT / "captures" / args.scene
    if out.exists():
        parser.error("Scene exists. Use a new scene identifier for this revision.")
    if not all(video.is_file() for video in [args.video,*args.also]):
        parser.error("Video file missing")
    local_ffmpeg = ROOT / ".tools" / "ffmpeg"
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or str(local_ffmpeg)
    if not shutil.which(ffmpeg):
        parser.error("Install FFmpeg or set FFMPEG to its executable path")
    sdk = os.environ.get("SDKROOT")
    if not sdk:
        default_sdk = Path(output("xcrun", "--show-sdk-path"))
        os_major = platform.mac_ver()[0].split(".")[0]
        host_sdk = default_sdk.parent / f"MacOSX{os_major}.sdk"
        sdk = str(host_sdk.resolve() if host_sdk.exists() else default_sdk)
    out.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent, prefix=".build-") as tmp:
        work = Path(tmp)
        frames, model, ready = (work / name for name in ["frames","model","ready"])
        for folder in (frames, model, ready):
            folder.mkdir()
        count = 0
        takes = []
        for video in [args.video,*args.also]:
            first = count+1
            run(ffmpeg,"-nostdin","-v","error","-i",video,"-map","0:v:0","-vf",f"fps={args.fps}",
                "-start_number",first,"-q:v","2",frames / "%06d.jpg")
            count = len(list(frames.glob("*.jpg")))
            if count == first-1:
                parser.error("No frames extracted from "+video.name)
            with video.open("rb") as stream:
                digest = hashlib.file_digest(stream,"sha256").hexdigest()
            takes.append(dict(name=video.name, sha256=digest, first=first, last=count))
        if count < 12:
            parser.error(f"Only {count} frames. Supply a longer overlapping take.")
        run("xcrun","swiftc","-sdk",sdk,"-parse-as-library",Path(__file__).with_name("reconstruct.swift"),
            "-o",work/"reconstruct")
        run(work/"reconstruct",frames,model,work/"poses.json",args.detail, "multi" if args.also else "single")
        package(model,work/"poses.json",frames,ready,dict(source=args.source, takes=takes,
                frames=count, fps=args.fps, detail=args.detail, macOS=platform.mac_ver()[0],
                sdk=Path(sdk).name, swift=output("xcrun","swiftc","--version"),
                extractor=output(ffmpeg,"-version").splitlines()[0]))
        ready.rename(out)
    print(f"Open capture.html?scene={args.scene}")


if __name__ == "__main__":
    main()
