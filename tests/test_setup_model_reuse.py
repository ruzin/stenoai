"""Tests for the installed-model picker used by `resolve-setup-model` (#123).

First-run setup should reuse a supported Ollama model that's already installed
instead of re-pulling the hardcoded default. `pick_installed_supported_model`
is the decision (which installed model to reuse, in what preference order);
these tests pin that behaviour without touching Ollama or the network.
"""

import json
import unittest
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from simple_recorder import pick_installed_supported_model

# A representative slice of config.SUPPORTED_MODELS order (ascending capability,
# default first) with the two deprecated entries at the tail.
SUPPORTED = [
    "llama3.2:3b",
    "gemma4:e2b-it-qat",
    "gemma4:e4b-it-qat",
    "qwen3.5:9b",
    "gemma4:12b-it-qat",
    "gpt-oss:20b",
    "gemma3:4b",        # deprecated
    "deepseek-r1:14b",  # deprecated
]
DEPRECATED = ["gemma3:4b", "deepseek-r1:14b"]
DEFAULT = "llama3.2:3b"


class PickInstalledSupportedModelTests(unittest.TestCase):
    def test_returns_none_when_nothing_supported_is_installed(self):
        # Only unsupported models present -> caller must pull the default.
        self.assertIsNone(
            pick_installed_supported_model(
                installed_names={"mistral:7b", "phi3:mini"},
                preferred=[DEFAULT, DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            )
        )

    def test_returns_none_when_no_models_installed(self):
        self.assertIsNone(
            pick_installed_supported_model(
                installed_names=set(),
                preferred=[DEFAULT, DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            )
        )

    def test_prefers_the_configured_model_when_installed(self):
        # Configured model differs from the default and both are installed:
        # the configured one wins.
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"llama3.2:3b", "qwen3.5:9b"},
                preferred=["qwen3.5:9b", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "qwen3.5:9b",
        )

    def test_falls_back_to_default_when_configured_absent(self):
        # Configured model not installed, default is -> default wins (the #123
        # headline: existing llama3.2:3b means no pull).
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"llama3.2:3b", "gemma4:12b-it-qat"},
                preferred=["gpt-oss:20b", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "llama3.2:3b",
        )

    def test_falls_through_registry_when_no_preferred_installed(self):
        # Neither configured nor default installed: take the first supported,
        # non-deprecated id in registry order.
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"gemma4:12b-it-qat", "qwen3.5:9b"},
                preferred=["gpt-oss:20b", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "qwen3.5:9b",
        )

    def test_deprecated_only_as_last_resort(self):
        # A deprecated-but-installed model is used only when nothing live is
        # installed -- a live model always beats a retired one.
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"gemma3:4b", "gemma4:12b-it-qat"},
                preferred=["gpt-oss:20b", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "gemma4:12b-it-qat",
        )
        # ...but a deprecated model is still better than pulling fresh.
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"deepseek-r1:14b"},
                preferred=["gpt-oss:20b", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "deepseek-r1:14b",
        )

    def test_ignores_blank_preferred_entries(self):
        # A falsy configured model (unset) must not match a blank installed id.
        self.assertEqual(
            pick_installed_supported_model(
                installed_names={"llama3.2:3b"},
                preferred=["", DEFAULT],
                supported_order=SUPPORTED,
                deprecated=DEPRECATED,
            ),
            "llama3.2:3b",
        )


class SetModelExitCodeTests(unittest.TestCase):
    """`set-model` must signal a config-write failure through its EXIT CODE, not
    just a JSON body. The reuse flow (setup-ollama-and-model) shells out to it to
    persist the reused model as active; if the write fails but the process exits
    0, setup reports success while the active model was never saved (#123)."""

    def _invoke(self, *, save_succeeds):
        # Installed fallback model differs from the configured + default model;
        # persisting it as active is what may fail.
        fake_config = mock.Mock()
        fake_config.SUPPORTED_MODELS = {"llama3.2:3b": {}, "qwen3.5:9b": {}}
        fake_config.set_model.return_value = save_succeeds
        with mock.patch("src.config.get_config", return_value=fake_config):
            return CliRunner().invoke(simple_recorder.set_model, ["qwen3.5:9b"])

    def _last_json(self, output):
        line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
        return json.loads(line)

    def test_config_write_failure_exits_nonzero(self):
        result = self._invoke(save_succeeds=False)
        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(
            self._last_json(result.output),
            {"success": False, "error": "Failed to save config"},
        )

    def test_success_exits_zero(self):
        result = self._invoke(save_succeeds=True)
        self.assertEqual(result.exit_code, 0)
        self.assertEqual(
            self._last_json(result.output),
            {"success": True, "model": "qwen3.5:9b"},
        )


if __name__ == "__main__":
    unittest.main()
