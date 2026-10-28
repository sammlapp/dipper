"""Test that the ML environment downloads, extracts, and unpacks via app.py.

Calls the same functions the backend uses (download_environment,
extract_environment, check_environment), so launch-time problems in how
conda-unpack is invoked are caught here rather than only on user machines.

Interpreter variables (PYTHONHOME/PYTHONPATH) pointing at a nonexistent
directory are set for the whole test. Packaged apps such as the Linux AppImage
set these, and they must not leak into the env's own Python.

Run from the backend/ directory:  python -m unittest tests.test_env_install -v
Downloads the full archive for the current platform (several GB).
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: E402

IMPORT_CHECK = "import torch, opensoundscape, pandas, numpy"


class TestEnvInstall(unittest.TestCase):
    def test_download_extract_unpack(self):
        with tempfile.TemporaryDirectory() as tmp:
            bogus = os.path.join(tmp, "nonexistent-python-home")
            poisoned = {"PYTHONHOME": bogus, "PYTHONPATH": bogus}
            with mock.patch.dict(os.environ, poisoned):
                download = app.download_environment()
                self.assertEqual(download["status"], "success", download)

                env_dir = os.path.join(tmp, "env")
                extract = app.extract_environment(download["archive_path"], env_dir)
                self.assertEqual(extract["status"], "success", extract)

                check = app.check_environment(env_dir)
                self.assertEqual(check["status"], "ready", check)

                result = subprocess.run(
                    [check["python_path"], "-c", IMPORT_CHECK],
                    capture_output=True,
                    text=True,
                    env=app.env_python_subprocess_env(),
                )
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
