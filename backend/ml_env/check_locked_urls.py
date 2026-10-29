"""Check that the files pinned in uv.lock are still downloadable.

A lockfile protects against resolution drift but not against an upstream index
removing a file (yanked or deleted wheels). This sends a HEAD request for every
pinned file that applies to the platforms Dipper supports (CPython 3.13 on Windows
x64, macOS arm64, Linux x86_64) and fails if any is gone.

Usage:  python check_locked_urls.py [path/to/uv.lock]
"""

import sys
import tomllib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

WORKERS = 16
RETRIES = 3
TIMEOUT_S = 60


def applies(filename):
    """Whether a pinned file is one a supported platform could install."""
    if not filename.endswith(".whl"):
        return True  # sdist
    py, abi, plat = filename[:-4].split("-")[-3:]
    python_ok = ("cp313" in py and ("cp313" in abi or abi in ("abi3", "none"))) or (
        "py3" in py and abi == "none"
    )
    if not python_ok:
        return False
    if "win_amd64" in plat or plat == "any":
        return True
    if "macosx" in plat:
        return "arm64" in plat or "universal2" in plat
    if "manylinux" in plat:
        return "x86_64" in plat
    return False


def pinned_files(lock_path):
    with open(lock_path, "rb") as f:
        lock = tomllib.load(f)
    files = []
    for package in lock["package"]:
        label = f"{package['name']} {package.get('version', '')}".strip()
        for wheel in package.get("wheels", []):
            if applies(wheel["url"].rsplit("/", 1)[-1]):
                files.append((label, wheel["url"]))
        if "sdist" in package and "url" in package["sdist"]:
            files.append((label, package["sdist"]["url"]))
    return files


def check(item):
    label, url = item
    error = None
    for _ in range(RETRIES):
        try:
            request = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(request, timeout=TIMEOUT_S):
                return label, url, None
        except urllib.error.HTTPError as e:
            error = f"HTTP {e.code}"
            if e.code in (404, 410):  # definitively gone; don't retry
                break
        except OSError as e:
            error = str(e)
    return label, url, error


def main(lock_path):
    files = pinned_files(lock_path)
    print(f"Checking {len(files)} pinned files from {lock_path}...", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(check, files))
    failures = [(label, url, error) for label, url, error in results if error]
    for label, url, error in failures:
        print(f"MISSING ({error}): {label}\n    {url}")
    print(f"{len(files) - len(failures)} ok, {len(failures)} unavailable")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "uv.lock"))
