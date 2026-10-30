"""Test that the ML environment installs via app.py's install_environment.

Calls the same functions the backend uses (detect_torch_variant,
install_environment, check_environment), so launch-time problems in how uv or the
environment's Python are invoked are caught here rather than only on user machines.

Interpreter variables (PYTHONHOME/PYTHONPATH) pointing at a nonexistent directory
are set for the whole test. Packaged apps such as the Linux AppImage set these, and
they must not leak into uv or the environment's own Python.

Run from the backend/ directory:
    TORCH_VARIANT=cpu python -m unittest tests.test_env_install -v
Installs the full environment (several GB) into a temporary directory.
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

# Modules imported in the order the app uses (scripts/load_model.py); TensorFlow
# last because it clashes with numba's LLVM on Linux if imported before opensoundscape.
IMPORT_CHECK = (
    "import bioacoustics_model_zoo, opensoundscape, torch, tensorflow, pandas, numpy; "
    "print(torch.__version__, torch.version.cuda)"
)


class TestEnvInstall(unittest.TestCase):
    def test_detect_torch_variant(self):
        variant, reason = app.detect_torch_variant()
        self.assertIn(variant, app.TORCH_VARIANTS)
        self.assertTrue(reason)

    def test_install_and_check(self):
        variant = os.environ["TORCH_VARIANT"]
        self.assertIn(variant, app.TORCH_VARIANTS)

        with tempfile.TemporaryDirectory() as tmp:
            bogus = os.path.join(tmp, "nonexistent-python-home")
            poisoned = {"PYTHONHOME": bogus, "PYTHONPATH": bogus}
            env_dir = os.path.join(tmp, "env")
            with mock.patch.dict(os.environ, poisoned):
                install = app.install_environment(env_dir, variant)
                self.assertEqual(install["status"], "success", install)

                check = app.check_environment(env_dir)
                self.assertEqual(check["status"], "ready", check)

                result = subprocess.run(
                    [check["python_path"], "-c", IMPORT_CHECK],
                    capture_output=True,
                    text=True,
                    env=app.env_python_subprocess_env(),
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                print(f"torch / CUDA: {result.stdout.strip()}")


if __name__ == "__main__":
    unittest.main()
