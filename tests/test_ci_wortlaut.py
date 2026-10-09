"""German UI copy by the AImighty CI rules (CI ABGLEICH WG-R3, WG-R4; Etappe 2a).

kern/wording.md: Sie-Form without exception, "AI" never "KI". WG-R4: the app is
"Wings", the agent is described, not named; "Hermes" stays only where someone
finds the thing under that name (CLI, config, dashboard, gateway, plugins).
The German block is complete: every English key has a German text, and a text
may equal the English one only where German uses the same word.

The locales are loaded by running static/i18n.js in Node, so functions
(plurals, the activity line) are checked by what they return.

Run:
    ./scripts/test.sh tests/test_ci_wortlaut.py -v
"""

import json
import pathlib
import re
import shutil
import subprocess

import pytest

REPO = pathlib.Path(__file__).parent.parent
I18N = REPO / "static" / "i18n.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(not NODE, reason="node not installed")

# Same word in German and English — names, loanwords, the agent's own terms.
GLEICH_ERLAUBT = {
    "mcp_field_url", "terminal_title", "settings_aux_task_mcp", "tab_chat", "tab_skills",
    "tab_workspaces", "tab_kanban", "kanban_board", "kanban_status_triage", "kanban_status_todo",
    "kanban_status_ready", "kanban_status_running", "kanban_status_blocked", "kanban_status_done",
    "kanban_status", "kanban_workspace_scratch", "kanban_workspace_worktree", "kanban_skills",
    "kanban_board_name", "tab_todos", "export_session_json", "export_session_html",
    "providers_status_oauth", "empty_title", "skill_name", "cron_name_label",
    "cron_name_placeholder", "cron_schedule_minute_label", "workspace_name_label",
    "profile_name_label", "settings_dropdown_system", "tool_target_skill_suffix",
    "composer_control_yolo", "composer_control_status", "settings_section_system_title",
    "settings_tab_plugins", "ext_gallery_version", "settings_plugins_title", "settings_tab_system",
    "status_tokens", "yolo_pill_label", "session_worktree_badge", "session_toolsets_placeholder",
    "cron_mode_agent", "media_audio_label", "media_video_label", "insights_model_tokens",
    "insights_model_cache", "insights_skill_usage_col_skill", "insights_skill_usage_col_patches",
    "insights_tokens", "slash_skill_badge",
}

# Where "Hermes" names a thing the user finds under that name (WG-R4, group 3).
HERMES_ERLAUBT = {
    "settings_label_dashboard_mode", "settings_desc_dashboard_mode", "tab_dashboard",
    "settings_desc_gateway_status", "settings_plugins_meta", "settings_plugins_empty",
    "status_hermes_home", "onboarding_notice_system_unavailable",
}

DU = re.compile(r"\b(?:du|dein(?:e[mnrs]?)?|dir|dich)\b", re.I)
IMPERATIV = re.compile(
    r"(?:^|[.!?:—–]\s+|\(\s*)(?:Wähle|Gib|Öffne|Lass|Verwende|Installiere|Klicke|Füge|Starte|Nutze|"
    r"Schau|Versuche|Gehe|Lies|Schreibe|Trage|Aktiviere|Deaktiviere|Lege|Speichere|Lösche|Bearbeite|"
    r"Ändere|Melde|Wechsle|Tippe|Ziehe|Bestätige|Erstelle|Benenne|Kopiere|Behalte|Sende|Hinterlege|"
    r"Konfiguriere|Richte|Beschreibe|Halte|Drücke|Prüfe|Lade)\b"
)

_LADEN = r"""
const fs = require('fs'), vm = require('vm');
const ctx = {window: {}, document: {documentElement: {}, addEventListener() {}, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'de'}, console};
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8') + ';globalThis.__L = LOCALES;', ctx);
const L = ctx.__L, out = {};
for (const lang of ['en', 'de']) {
  out[lang] = {};
  for (const [k, v] of Object.entries(L[lang])) out[lang][k] = typeof v === 'function' ? {fn: v.toString()} : v;
}
const de = L.de;
out.probe = {
  processed: de.processed_elapsed('12s'),
  action_running: de.tool_action_label('read', 'running', 'notes.md'),
  action_done: de.tool_action_label('shell', 'done', '', ''),
  action_failed: de.tool_action_label('write', 'done', 'app.py', '', true),
  summary_one: de.tool_worklog_summary('read', 'done', 1),
  summary_many: de.tool_worklog_summary('search', 'running', 3),
  join: de.tool_summary_join(['a', 'b', 'c']),
};
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def locales():
    out = subprocess.run([NODE, "-e", _LADEN, str(I18N)], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _texte(block):
    return {k: v for k, v in block.items() if isinstance(v, str)}


def test_every_english_text_has_a_german_one(locales):
    fehlt = sorted(set(locales["en"]) - set(locales["de"]))
    assert fehlt == [], f"{len(fehlt)} keys fall back to English: {fehlt[:10]}"


def test_no_english_left_in_the_german_block(locales):
    en, de = locales["en"], _texte(locales["de"])
    gleich = {k for k, v in de.items() if en.get(k) == v and re.search(r"[A-Za-z]{3,}", v)}
    assert gleich - GLEICH_ERLAUBT == set(), sorted(gleich - GLEICH_ERLAUBT)


def test_sie_form_without_exception(locales):
    du = {k: v for k, v in _texte(locales["de"]).items() if DU.search(v) or IMPERATIV.search(v)}
    assert du == {}


def test_ai_never_ki(locales):
    for lang in ("en", "de"):
        ki = {k: v for k, v in _texte(locales[lang]).items() if re.search(r"\bKI\b", v)}
        assert ki == {}, lang


def test_hermes_only_where_it_is_found_under_that_name(locales):
    hermes = {k for k, v in _texte(locales["de"]).items() if re.search(r"\bHermes\b", v)}
    assert hermes <= HERMES_ERLAUBT, sorted(hermes - HERMES_ERLAUBT)


def test_activity_line_speaks_german(locales):
    p = locales["probe"]
    assert p == {
        "processed": "Fertig nach 12s",
        "action_running": "Liest notes.md",
        "action_done": "Ausgeführt: Befehl",
        "action_failed": "Ändern fehlgeschlagen: app.py",
        "summary_one": "Eine Datei gelesen",
        "summary_many": "Durchsucht den Arbeitsbereich 3-mal",
        "join": "a, b und c",
    }
