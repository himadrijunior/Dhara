#!/usr/bin/env python3
"""ECC-audit fix: convert projects/[id]/* routes from requireUserCtx to requireProjectAccess."""
import re, pathlib

FILES = [
    "src/app/api/projects/[id]/keys/route.ts",
    "src/app/api/projects/[id]/webhooks/route.ts",
    "src/app/api/projects/[id]/stats/route.ts",
    "src/app/api/projects/[id]/policies/route.ts",
    "src/app/api/projects/[id]/storage/route.ts",
    "src/app/api/projects/[id]/tables/route.ts",
    "src/app/api/projects/[id]/tables/[table]/route.ts",
    "src/app/api/projects/[id]/tables/[table]/rows/route.ts",
]

ROOT = pathlib.Path("/home/z/my-project")

for rel in FILES:
    p = ROOT / rel
    src = p.read_text()
    orig = src
    # import swap
    src = src.replace("requireUserCtx", "requireProjectAccess")
    # bare call: await requireProjectAccess(req);  -> with project id from params
    src = re.sub(
        r"await requireProjectAccess\(req\);",
        "await requireProjectAccess(req, (await params).id);",
        src,
    )
    # ctx call: const ctx = await requireProjectAccess(req);
    src = re.sub(
        r"const ctx = await requireProjectAccess\(req\);",
        "const ctx = await requireProjectAccess(req, (await params).id);",
        src,
    )
    if src != orig:
        p.write_text(src)
        print(f"PATCHED {rel}")
    else:
        print(f"NOCHANGE {rel}")
