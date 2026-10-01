"""
THE FORMULA RECALC STEP (Oct 1) — runs INSIDE the locked room (the runner image, --network none),
as a second, short job after the model's script succeeded, only when an .xlsx output carries
formulas.

Why: openpyxl writes formulas with NO cached value and xlsxwriter caches 0 — so every viewer that
reads cached values (our preview, mail clients, mobile quick-look) showed blanks or zeros where the
totals should be. LibreOffice-headless (already in the runner for the render gate) opens the
workbook with "recalculate on load: always", and re-saves it as xlsx WITH the computed values;
formulas stay formulas.

Fidelity guard: a round-trip that loses a sheet, a chart or an image is REFUSED — the original
file is kept (live formulas without cached values beat a damaged workbook). Every outcome is
printed as one JSON line the service relays.

Usage (the service mounts this file read-only): python /job/recalc.py /job/out/a.xlsx [...]
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

PROFILE = os.environ.get("RECALC_LO_PROFILE", "/tmp/lo_recalc_profile")
# OOXMLRecalcMode / ODFRecalcMode: 0 = always recalculate on load, 1 = never, 2 = prompt.
XCU = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
"""


def shape(path: str) -> dict:
    """What a round-trip must keep: sheets, charts, images."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        wb = z.read("xl/workbook.xml").decode("utf-8", "replace")
    return {
        "sheets": len(re.findall(r"<(?:\w+:)?sheet\b", wb)),
        "charts": sum(1 for n in names if re.match(r"xl/charts/chart\d+\.xml$", n)),
        "images": sum(1 for n in names if n.startswith("xl/media/")),
    }


def main(paths: list[str]) -> None:
    user_dir = os.path.join(PROFILE, "user")
    os.makedirs(user_dir, exist_ok=True)
    with open(os.path.join(user_dir, "registrymodifications.xcu"), "w") as fh:
        fh.write(XCU)
    out_dir = tempfile.mkdtemp(prefix="recalc_")
    env = dict(os.environ, HOME="/tmp")
    res = subprocess.run(
        ["soffice", f"-env:UserInstallation=file://{PROFILE}", "--headless", "--norestore",
         "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out_dir, *paths],
        capture_output=True, timeout=90, env=env,
    )
    for p in paths:
        name = os.path.basename(p)
        fresh = os.path.join(out_dir, name)
        report = {"file": name}
        try:
            if not os.path.exists(fresh):
                report.update(ok=False, reason=f"soffice rc={res.returncode}: {res.stderr.decode(errors='replace')[:200]}")
            else:
                before, after = shape(p), shape(fresh)
                lost = [k for k in before if after[k] < before[k]]
                if lost:
                    report.update(ok=False, reason=f"round-trip lost {', '.join(lost)} {before} -> {after}")
                else:
                    shutil.copyfile(fresh, p)
                    report.update(ok=True, shape=after)
        except Exception as exc:  # a bad file never fails the job — the original stays
            report.update(ok=False, reason=str(exc)[:200])
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
