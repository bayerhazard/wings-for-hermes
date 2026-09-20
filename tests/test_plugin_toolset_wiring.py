"""Regression coverage: enabled plugins must be wired into platform_toolsets.

A plugin listed in ``plugins.enabled`` can load while its toolset key is absent
from ``platform_toolsets`` — sessions then never see the plugin's tools. Wings
reconciles this at startup, mirroring ``hermes tools enable <plugin>``.
"""
import sys
import types
from unittest import mock

import api.startup as startup


def _fake_hermes(config, key_map, saved):
    cfg_mod = types.ModuleType("hermes_cli.config")
    cfg_mod.load_config = lambda: config
    cfg_mod.save_config = lambda c: saved.append(c)
    cmd_mod = types.ModuleType("hermes_cli.plugins_cmd")
    cmd_mod._get_plugin_toolset_key = lambda name: key_map.get(name)
    pkg = types.ModuleType("hermes_cli")
    pkg.__path__ = []
    return {
        "hermes_cli": pkg,
        "hermes_cli.config": cfg_mod,
        "hermes_cli.plugins_cmd": cmd_mod,
    }


def test_reconcile_wires_enabled_plugin_toolset():
    config = {
        "plugins": {"enabled": ["demo"], "disabled": []},
        "platform_toolsets": {"cli": ["file", "web"]},
    }
    saved = []
    mods = _fake_hermes(config, {"demo": "demo-toolset"}, saved)
    with mock.patch.dict(sys.modules, mods), mock.patch.dict("os.environ", {}, clear=True):
        added = startup.reconcile_plugin_toolsets()

    assert added > 0
    assert "demo-toolset" in config["platform_toolsets"]["cli"]
    assert "demo-toolset" in config["known_plugin_toolsets"]["cli"]
    assert saved, "config must be persisted after wiring"


def test_reconcile_is_idempotent():
    config = {
        "plugins": {"enabled": ["demo"]},
        "platform_toolsets": {"cli": ["demo-toolset"]},
        "known_plugin_toolsets": {"cli": ["demo-toolset"]},
    }
    saved = []
    mods = _fake_hermes(config, {"demo": "demo-toolset"}, saved)
    with mock.patch.dict(sys.modules, mods), mock.patch.dict("os.environ", {}, clear=True):
        assert startup.reconcile_plugin_toolsets() == 0
    assert saved == [], "no write when nothing changed"


def test_reconcile_skips_disabled_and_unresolvable_plugins():
    config = {
        "plugins": {"enabled": ["off", "unknown", "demo"], "disabled": ["off"]},
        "platform_toolsets": {"cli": []},
    }
    saved = []
    mods = _fake_hermes(config, {"off": "off-toolset", "demo": "demo-toolset"}, saved)
    with mock.patch.dict(sys.modules, mods), mock.patch.dict("os.environ", {}, clear=True):
        startup.reconcile_plugin_toolsets()

    assert "off-toolset" not in config["platform_toolsets"]["cli"]
    assert "demo-toolset" in config["platform_toolsets"]["cli"]


def test_reconcile_honors_skip_flag():
    config = {"plugins": {"enabled": ["demo"]}, "platform_toolsets": {"cli": []}}
    saved = []
    mods = _fake_hermes(config, {"demo": "demo-toolset"}, saved)
    env = {"HERMES_WEBUI_SKIP_TOOLSET_WIRING": "1"}
    with mock.patch.dict(sys.modules, mods), mock.patch.dict("os.environ", env, clear=True):
        assert startup.reconcile_plugin_toolsets() == 0
    assert config["platform_toolsets"]["cli"] == []


def test_reconcile_noop_without_enabled_plugins():
    config = {"plugins": {"enabled": []}, "platform_toolsets": {"cli": ["file"]}}
    saved = []
    mods = _fake_hermes(config, {}, saved)
    with mock.patch.dict(sys.modules, mods), mock.patch.dict("os.environ", {}, clear=True):
        assert startup.reconcile_plugin_toolsets() == 0
