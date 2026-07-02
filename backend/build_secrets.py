"""Generate _secrets.py from .env before running PyInstaller."""
from pathlib import Path
from dotenv import dotenv_values

env = dotenv_values(Path(__file__).parent / ".env")
out = Path(__file__).parent / "_secrets.py"

lines = ["# Auto-generated from .env — do not commit\n"]
for key, value in env.items():
    lines.append(f'{key} = "{value}"\n')

out.write_text("".join(lines))
print(f"Written {out} with {len(env)} keys: {', '.join(env)}")
