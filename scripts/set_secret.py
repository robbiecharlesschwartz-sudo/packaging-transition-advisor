"""Prompt for a secret without echoing it, then store it.

  python scripts/set_secret.py GEMINI_API_KEY --worker   # uploads as a Cloudflare Worker secret
  python scripts/set_secret.py CENSUS_API_KEY            # writes to .env for the Python scripts
"""
import getpass
import subprocess
import sys

from common import ROOT


def write_env(name: str, value: str) -> None:
    env = ROOT / ".env"
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [ln for ln in lines if not ln.startswith(f"{name}=")] + [f"{name}={value}"]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    name, to_worker = sys.argv[1], "--worker" in sys.argv
    if "--visible" in sys.argv:  # some Windows terminals block paste into hidden prompts
        value = input(f"Paste {name}, then press Enter: ").strip()
    else:
        value = getpass.getpass(f"Paste {name} (input hidden), then press Enter: ").strip()
    if not value:
        print("Nothing entered; unchanged.")
        return 1
    if to_worker:
        npx = "npx.cmd" if sys.platform == "win32" else "npx"
        r = subprocess.run([npx, "wrangler", "secret", "put", name], input=value, text=True, cwd=ROOT / "worker")
        if r.returncode != 0:
            return r.returncode
    else:
        write_env(name, value)
    print(f"{name} saved {'to the Cloudflare Worker' if to_worker else 'to .env'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
