"""Upload the key pasted into PASTE_KEY_HERE.txt as a Worker secret, then delete the file. Never prints it."""
import subprocess
import sys

from common import ROOT

name = sys.argv[1] if len(sys.argv) > 1 else "GEMINI_API_KEY"
f = ROOT / "PASTE_KEY_HERE.txt"
value = f.read_text(encoding="utf-8").strip() if f.exists() else ""
if not value:
    print("PASTE_KEY_HERE.txt is empty: paste the key, save, and run again.")
    sys.exit(1)
if "--dev" in sys.argv:  # also keep it for `wrangler dev` in worker/.dev.vars (gitignored)
    dv = ROOT / "worker" / ".dev.vars"
    lines = [l for l in (dv.read_text(encoding="utf-8").splitlines() if dv.exists() else []) if not l.startswith(f"{name}=")]
    env = (ROOT / ".env").read_text(encoding="utf-8").splitlines() if (ROOT / ".env").exists() else []
    tok = next((l.split("=", 1)[1] for l in env if l.startswith("ADMIN_TOKEN=")), "")
    lines = [l for l in lines if not l.startswith("ADMIN_TOKEN=")] + [f"{name}={value}", f"ADMIN_TOKEN={tok}"]
    dv.write_text("\n".join(lines) + "\n", encoding="utf-8")
npx = "npx.cmd" if sys.platform == "win32" else "npx"
r = subprocess.run([npx, "wrangler", "secret", "put", name], input=value, text=True, cwd=ROOT / "worker",
                   capture_output=True)
f.write_text("", encoding="utf-8")
f.unlink()
print("uploaded" if r.returncode == 0 else f"wrangler failed: {r.stderr[-300:]}")
sys.exit(r.returncode)
