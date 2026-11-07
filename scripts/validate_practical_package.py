#!/usr/bin/env python3
"""Run the ZIP's standard-library validator without committing private keys."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import subprocess
import sys

zip_path = Path(__file__).resolve().parents[1] / "security_plus_sy0_701_practical_site_upgrade.zip"
with TemporaryDirectory(prefix="secplus-package-check-") as temp:
    base = Path(temp).resolve()
    with ZipFile(zip_path) as archive:
        for name in archive.namelist():
            target = (base / name).resolve()
            if not target.is_relative_to(base):
                raise SystemExit(f"Unsafe ZIP member: {name}")
        archive.extractall(base)
    validator = base / "security_plus_practical_expansion" / "tools" / "validate_package.py"
    result = subprocess.run([sys.executable, str(validator)], check=False)
    raise SystemExit(result.returncode)
