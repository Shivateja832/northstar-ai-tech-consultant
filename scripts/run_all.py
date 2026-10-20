from __future__ import annotations

import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
INBOX_DIR = ROOT / "services" / "inbox_agent"
FRONTEND_DIR = ROOT / "services" / "frontend"
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
PYTHON = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
PROCESSES: list[tuple[str, subprocess.Popen[bytes]]] = []


def _start(label: str, command: list[str], cwd: Path = ROOT) -> subprocess.Popen[bytes]:
    process = subprocess.Popen(command, cwd=cwd)
    PROCESSES.append((label, process))
    return process


def _wait_for(label: str, url: str, timeout: int = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for process_label, process in PROCESSES:
            if process.poll() is not None:
                raise RuntimeError(
                    f"{process_label} exited with code {process.returncode}. "
                    "Check its startup message above for the cause."
                )
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    print(f"READY {label}: {url}")
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    raise RuntimeError(f"{label} did not become healthy within {timeout} seconds: {url}")


def _stop_all() -> None:
    for _, process in reversed(PROCESSES):
        if process.poll() is None:
            process.terminate()
    for label, process in reversed(PROCESSES):
        if process.poll() is None:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                print(f"WARNING: {label} did not stop cleanly; PID={process.pid}")


def main() -> int:
    load_dotenv(ROOT / ".env")
    print(f"Using Python: {PYTHON}")
    print("Starting local AI Tech Consultant services. Keep this terminal open.")
    try:
        _start("Knowledge Brain", [PYTHON, "-m", "uvicorn", "services.knowledge_brain.main:app", "--host", "127.0.0.1", "--port", "8001"])
        _start("Meeting Agent", [PYTHON, "-m", "uvicorn", "services.meeting_agent.main:app", "--host", "127.0.0.1", "--port", "8002"])
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js was not found. Install Node.js LTS, reopen the terminal, and run npm install.")
        tsx_cli = INBOX_DIR / "node_modules" / "tsx" / "dist" / "cli.mjs"
        if not tsx_cli.exists():
            raise RuntimeError("Inbox dependencies are missing. Run: npm --prefix services/inbox_agent install")
        _start("Inbox Agent", [node, str(tsx_cli), "src/server.ts"], cwd=INBOX_DIR)
        _start("Frontend", [PYTHON, "-m", "http.server", "8080", "--bind", "127.0.0.1", "--directory", str(FRONTEND_DIR)])

        _wait_for("Knowledge Brain", "http://127.0.0.1:8001/health")
        _wait_for("Meeting Agent", "http://127.0.0.1:8002/health")
        _wait_for("Inbox Agent", "http://127.0.0.1:3001/health")
        _wait_for("Frontend", "http://127.0.0.1:8080/")
        print("\nLocal app is ready:")
        print("  Frontend:       http://localhost:8080")
        print("  Knowledge docs: http://localhost:8001/docs")
        print("  Meeting docs:   http://localhost:8002/docs")
        print("  Inbox health:   http://localhost:3001/health")
        print("Press Ctrl+C to stop the services.")
        while True:
            for label, process in PROCESSES:
                if process.poll() is not None:
                    raise RuntimeError(f"{label} stopped unexpectedly with exit code {process.returncode}.")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping services...")
        return 0
    except (RuntimeError, OSError) as exc:
        print(f"STARTUP ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        _stop_all()


if __name__ == "__main__":
    raise SystemExit(main())
