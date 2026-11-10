"""Run the local ComfyUI service with durable logs, independently of the chat."""
import argparse
from pathlib import Path
import os
import runpy
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-root", required=True)
    parser.add_argument("--log-file", required=True)
    args, comfy_args = parser.parse_known_args()
    root = Path(args.comfy_root).resolve()
    if not (root / "main.py").is_file():
        raise SystemExit("ComfyUI main.py not found")
    log_path = Path(args.log_file).resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log:
        sys.stdout = sys.stderr = log
        os.chdir(root)
        sys.path.insert(0, str(root))
        sys.argv = [str(root / "main.py"), *comfy_args]
        runpy.run_path(str(root / "main.py"), run_name="__main__")


if __name__ == "__main__":
    main()
