"""The measuring script behind docs/ci/BESTAND.md (CI hookup, stage 0).

Every number in that report comes from scripts/ci/bestand.py, so the script's
counting rules are pinned here: comments are no colours, issue references are
no colours, and a CI clone is only measured at a stand, never at main.

Run:
    ./scripts/test.sh tests/test_ci_bestand.py -v
"""

import importlib.util
import pathlib
import subprocess

import pytest

REPO = pathlib.Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location("bestand", REPO / "scripts" / "ci" / "bestand.py")
bestand = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bestand)


def test_issue_references_are_not_colours():
    assert bestand.hex_werte("see #1488 and #6040") == []
    assert bestand.hex_werte("color:#CAA960;border:#fff") == ["#caa960", "#ffffff"]


def test_comments_are_stripped_before_counting(tmp_path):
    js = tmp_path / "x.js"
    js.write_text(
        "// fix (#1499): was #ff0000\n"
        "/* #00ff00 */\n"
        "const url = 'https://example.org/#abc';\n"
        "el.style.color = '#002f56';\n",
        encoding="utf-8",
    )
    werte = bestand.hex_werte(bestand.code(js))
    assert "#002f56" in werte
    assert "#ff0000" not in werte and "#00ff00" not in werte


def test_ci_clone_is_measured_only_at_a_stand(tmp_path):
    ci = tmp_path / "aimighty-ci"
    (ci / "tokens").mkdir(parents=True)
    (ci / "tokens" / "app.css").write_text(":root { --am-gold-500: #caa960; }\n", encoding="utf-8")
    git = ["git", "-C", str(ci), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run(["git", "init", "-q", str(ci)], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "x"], check=True)
    with pytest.raises(SystemExit):
        bestand.ci_vergleich(ci, ["#caa960"], [])
    subprocess.run([*git, "tag", "ci-26.10.1"], check=True)
    erg = bestand.ci_vergleich(ci, ["#caa960"], [])
    assert erg["stand"]["stand"] == "ci-26.10.1"
    assert erg["gleich_ci"] == 1
