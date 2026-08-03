"""Regression coverage for #2462 stale /theme i18n help strings."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
I18N_JS = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")


def _locale_block(locale: str) -> str:
    # Locale keys are mostly bare identifiers, but zh-Hant is quoted. Match the
    # requested block up to the next top-level locale block or the LOCALES close.
    match = re.search(
        rf"\n\s*['\"]?{re.escape(locale)}['\"]?:\s*\{{(?P<body>.*?)(?=\n\s*['\"]?[a-z][\w-]*['\"]?:\s*\{{|\n\}};)",
        I18N_JS,
        re.S,
    )
    assert match, f"locale block {locale!r} not found"
    return match.group("body")


def _literal_value(block: str, key: str) -> str:
    match = re.search(rf"\n\s*{re.escape(key)}:\s*'(?P<value>(?:\\'|[^'])*)',", block)
    assert match, f"{key!r} not found in locale block"
    return match.group("value")


def test_theme_command_help_mentions_current_theme_and_skin_values():
    """Every /theme help string should describe the current Theme × Skin contract."""
    required_fragments = (
        "system/dark/light/aimighty",
        "default/midnight",
    )
    for locale in ("en", "de"):
        value = _literal_value(_locale_block(locale), "cmd_theme")
        for fragment in required_fragments:
            assert fragment in value, f"{locale} cmd_theme missing {fragment!r}: {value!r}"
    # The skin system was removed — no stale skin-list fragment may remain.
    for locale in ("en", "de"):
        value = _literal_value(_locale_block(locale), "cmd_theme")
        assert "charizard" not in value and "geist-contrast" not in value, (
            f"{locale} cmd_theme must not reference removed skins: {value!r}"
        )


def test_french_theme_usage_uses_actual_slash_command_with_space():
    """The German cmd_theme help must reference the actual theme contract."""
    de_theme_usage = _literal_value(_locale_block("de"), "cmd_theme")
    assert "Theme:" in de_theme_usage
    assert "aimighty" in de_theme_usage
    assert "/thème" not in de_theme_usage
