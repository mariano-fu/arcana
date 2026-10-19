import os
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent


def import_settings(**overrides: str) -> subprocess.CompletedProcess[str]:
    """Import the settings module in a clean process with the given environment."""
    env = {k: v for k, v in os.environ.items() if k not in {"SECRET_KEY", "DEBUG"}}
    env.update(overrides)
    return subprocess.run(
        [sys.executable, "-c", "import arcana.settings"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_missing_secret_key_fails_when_debug_off() -> None:
    result = import_settings(DEBUG="false", SECRET_KEY="")

    assert result.returncode != 0
    assert "SECRET_KEY must be set" in result.stderr


def test_secret_key_set_with_debug_off_loads() -> None:
    result = import_settings(DEBUG="false", SECRET_KEY="test-only-not-a-real-key")

    assert result.returncode == 0, result.stderr


def test_debug_on_allows_missing_secret_key() -> None:
    result = import_settings(DEBUG="true", SECRET_KEY="")

    assert result.returncode == 0, result.stderr
