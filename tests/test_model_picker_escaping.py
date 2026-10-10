from pathlib import Path
from tests.wings_i18n import en  # Wings: UI text via t() (CI ABGLEICH WG-R3)


ROOT = Path(__file__).resolve().parents[1]


def test_model_picker_escapes_provider_supplied_model_labels():
    src = (ROOT / "static" / "ui.js").read_text()

    assert '<span class="model-opt-id">${esc(m.id)}</span>' in src
    assert '<span class="model-opt-name">${esc(m.name)}</span>' in src
    assert '<span class="model-opt-id">${m.id}</span>' not in src
    assert '<span class="model-opt-name">${m.name}</span>' not in src


def test_providers_panel_escapes_load_error_text():
    src = (ROOT / "static" / "panels.js").read_text()

    assert "t('wg_providers_load_failed')+esc(e.message||String(e))+'" in src and en("wg_providers_load_failed") == "Failed to load providers: "
    assert "Failed to load providers: '+e.message+'" not in src
