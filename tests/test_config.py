import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config


class ConfigStoragePathTests(unittest.TestCase):
    def test_set_storage_path_handles_permission_errors(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_storage_path(), "")

            with patch("pathlib.Path.mkdir", side_effect=PermissionError("no access")):
                success = config.set_storage_path("/System/Library")

            self.assertFalse(success)
            self.assertEqual(config.get_storage_path(), "")

    def test_set_storage_path_accepts_none_as_reset(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_storage_path(None)
            self.assertTrue(success)
            self.assertEqual(config.get_storage_path(), "")


class ConfigLanguageTests(unittest.TestCase):
    def test_default_language_is_auto_detect(self):
        # A fresh config (no explicit language ever set) must default to
        # "auto" so _resolve_output_language() picks up the transcript's
        # detected language, not silently produce English-only summaries
        # for every user who never visits Settings.
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_language(), "auto")

    def test_legacy_config_missing_language_key_reads_as_auto(self):
        # A config file saved before the "language" field existed (or a
        # hand-edited one missing just that key) must still auto-detect, not
        # fall back to English. Regression guard for the get_language() read
        # path agreeing with the "auto" default (#281).
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.json"
            config_path.write_text(json.dumps({"ai_provider": "local"}))
            config = Config(config_path=config_path)
            self.assertEqual(config.get_language(), "auto")

    def test_set_language_accepts_supported_dutch_code(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_language("nl")
            self.assertTrue(success)
            self.assertEqual(config.get_language(), "nl")
            self.assertEqual(config.get_language_name("nl"), "Dutch")

    def test_set_language_accepts_auto_detection_mode(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            success = config.set_language("auto")
            self.assertTrue(success)
            self.assertEqual(config.get_language(), "auto")
            self.assertEqual(config.get_language_name("auto"), "Auto (detect)")


class ConfigWhisperModelTests(unittest.TestCase):
    def test_default_whisper_model_is_large_v3_turbo(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")

    def test_set_whisper_model_persists_supported_size(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_whisper_model("large-v3-turbo"))
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")
            # Round-trip via a fresh Config instance
            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_whisper_model(), "large-v3-turbo")

    def test_set_whisper_model_rejects_unknown_size(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.set_whisper_model("ultra-mega"))
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")

    def test_get_whisper_model_falls_back_when_stored_value_invalid(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            # Simulate a hand-edited config with a stale model name
            config._config["whisper_model"] = "obsolete-model"
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")


class ConfigSummaryModelTests(unittest.TestCase):
    def test_default_model_is_gemma4_e2b(self):
        self.assertEqual(Config.DEFAULT_MODEL, "gemma4:e2b-it-qat")

    def test_get_model_returns_default_on_fresh_config(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_model(), "gemma4:e2b-it-qat")

    def test_default_model_is_first_active_entry_in_registry(self):
        # The Settings UI relies on active models being listed first, default
        # first. The default must be a registered model and the first key.
        self.assertIn(Config.DEFAULT_MODEL, Config.SUPPORTED_MODELS)
        first_key = next(iter(Config.SUPPORTED_MODELS))
        self.assertEqual(first_key, Config.DEFAULT_MODEL)
        self.assertNotEqual(
            Config.SUPPORTED_MODELS[Config.DEFAULT_MODEL].get("deprecated"), True
        )

    def test_llama32_deprecated_but_kept(self):
        # Deprecated (tucked into the dimmed Settings section) but NOT removed,
        # so a user already on it keeps a recognised selection.
        self.assertIn("llama3.2:3b", Config.SUPPORTED_MODELS)
        self.assertEqual(
            Config.SUPPORTED_MODELS["llama3.2:3b"].get("deprecated"), True
        )

    def test_existing_user_choice_survives_default_swap(self):
        # Migration safety: a user on a still-supported (even deprecated) model
        # keeps it; only a fresh config (no stored "model") gets the default.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_model("llama3.2:3b"))
            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_model(), "llama3.2:3b")

    def test_removed_model_migrates_to_default(self):
        # A user pinned to a model retired from SUPPORTED_MODELS (e.g. the
        # removed gemma3:4b) is migrated to the default on load, not left stuck.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"model": "gemma3:4b"}))
            config = Config(config_path=path)
            self.assertEqual(config.get_model(), "gemma4:e2b-it-qat")
            # Persisted so the migration doesn't re-run forever.
            self.assertEqual(json.loads(path.read_text())["model"], "gemma4:e2b-it-qat")

    def test_renamed_model_migrates_to_qat_build(self):
        # A user pinned to a renamed tag (gemma4:12b / gemma4:4b) is moved to
        # the equivalent quantization-aware build, preserving their model choice
        # rather than dropping them to the default.
        for old, new in (("gemma4:12b", "gemma4:12b-it-qat"),
                         ("gemma4:4b", "gemma4:e4b-it-qat")):
            with self.subTest(old=old):
                with tempfile.TemporaryDirectory() as tmp_dir:
                    path = Path(tmp_dir) / "config.json"
                    path.write_text(json.dumps({"model": old}))
                    config = Config(config_path=path)
                    self.assertEqual(config.get_model(), new)
                    # Persisted so the migration doesn't re-run forever.
                    self.assertEqual(json.loads(path.read_text())["model"], new)

    def test_custom_pulled_model_is_not_migrated(self):
        # set_model intentionally allows arbitrary user-pulled Ollama models
        # (not in SUPPORTED_MODELS). The migration must only touch the specific
        # retired ids — a custom model must survive a reload untouched.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"model": "llama3.2:1b"}))
            config = Config(config_path=path)
            self.assertEqual(config.get_model(), "llama3.2:1b")


class ConfigWhisperModelMigrationTests(unittest.TestCase):
    """_migrate_whisper_model runs at load time to rescue configs that hold
    values outside the current SUPPORTED_WHISPER_MODELS list. Bare 'large'
    is the critical case — pywhispercpp.AVAILABLE_MODELS doesn't include it
    and the native loader segfaults if we let the value through to Model()."""

    def _write_config(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload))

    def test_migrates_bare_large_to_turbo(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "large"})
            config = Config(config_path=path)
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")
            # Persisted to disk so the migration doesn't re-run forever.
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "large-v3-turbo"
            )

    def test_migrates_retired_tier_to_turbo(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "medium"})
            config = Config(config_path=path)
            self.assertEqual(config.get_whisper_model(), "large-v3-turbo")
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "large-v3-turbo"
            )

    def test_leaves_supported_value_untouched(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            self._write_config(path, {"whisper_model": "large-v3-turbo"})
            Config(config_path=path)
            # No rewrite happened — value identical, no migration thrash.
            self.assertEqual(
                json.loads(path.read_text())["whisper_model"], "large-v3-turbo"
            )


class ConfigAutoDetectMeetingsTests(unittest.TestCase):
    def test_default_auto_detect_meetings_is_true(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.get_auto_detect_meetings_enabled())

    def test_auto_detect_meetings_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_auto_detect_meetings_enabled(False))
            self.assertFalse(config.get_auto_detect_meetings_enabled())
            reloaded = Config(config_path=path)
            self.assertFalse(reloaded.get_auto_detect_meetings_enabled())
            self.assertTrue(reloaded.set_auto_detect_meetings_enabled(True))
            self.assertTrue(reloaded.get_auto_detect_meetings_enabled())


class ConfigLaunchOnLoginTests(unittest.TestCase):
    def test_default_launch_on_login_is_false(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.get_launch_on_login())

    def test_legacy_config_without_key_defaults_false(self):
        # Existing installs whose config predates this key must remain opt-in.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"model": "gemma3:4b"}))
            config = Config(config_path=path)
            self.assertFalse(config.get_launch_on_login())

    def test_launch_on_login_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_launch_on_login(True))
            self.assertTrue(config.get_launch_on_login())
            reloaded = Config(config_path=path)
            self.assertTrue(reloaded.get_launch_on_login())
            self.assertTrue(reloaded.set_launch_on_login(False))
            self.assertFalse(reloaded.get_launch_on_login())


class ConfigOrgAutoBackupTests(unittest.TestCase):
    def test_default_auto_backup_is_true(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.get_org_auto_backup_enabled())

    def test_seed_applies_default_when_no_preference(self):
        """First sign-in seeds the org's auto_share_default into config."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertFalse(config.seed_org_auto_backup_default(False))
            self.assertFalse(config.get_org_auto_backup_enabled())
            reloaded = Config(config_path=path)
            self.assertFalse(reloaded.get_org_auto_backup_enabled())

    def test_seed_does_not_clobber_explicit_user_choice(self):
        """Once the user sets the toggle, a later seed must not overwrite it —
        the enterprise sets the default only, the user's choice wins."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.set_org_auto_backup_enabled(True))
            # Org default is False, but the user already chose True.
            self.assertTrue(config.seed_org_auto_backup_default(False))
            self.assertTrue(config.get_org_auto_backup_enabled())


class ConfigKeepRecordingsTests(unittest.TestCase):
    def test_default_keep_recordings_is_false(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertFalse(config.get_keep_recordings())

    def test_keep_recordings_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_keep_recordings(True))
            self.assertTrue(config.get_keep_recordings())
            reloaded = Config(config_path=path)
            self.assertTrue(reloaded.get_keep_recordings())
            self.assertTrue(reloaded.set_keep_recordings(False))
            self.assertFalse(reloaded.get_keep_recordings())


class ConfigAutoSummarizeTests(unittest.TestCase):
    def test_default_auto_summarize_is_true(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.get_auto_summarize_enabled())

    def test_auto_summarize_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_auto_summarize_enabled(False))
            self.assertFalse(config.get_auto_summarize_enabled())
            reloaded = Config(config_path=path)
            self.assertFalse(reloaded.get_auto_summarize_enabled())
            self.assertTrue(reloaded.set_auto_summarize_enabled(True))
            self.assertTrue(reloaded.get_auto_summarize_enabled())


class ConfigBedrockSettingsTests(unittest.TestCase):
    def test_default_bedrock_region_is_us_east_1(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_bedrock_region(), "us-east-1")

    def test_set_bedrock_region_persists_and_trims(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            self.assertTrue(config.set_bedrock_region("  eu-west-1  "))
            self.assertEqual(config.get_bedrock_region(), "eu-west-1")
            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_bedrock_region(), "eu-west-1")

    def test_set_bedrock_region_rejects_empty(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            # Seed a known good value so we can assert it isn't clobbered.
            config.set_bedrock_region("ap-southeast-2")
            self.assertFalse(config.set_bedrock_region(""))
            self.assertFalse(config.set_bedrock_region("   "))
            self.assertEqual(config.get_bedrock_region(), "ap-southeast-2")

    def test_set_bedrock_region_rejects_malformed_values(self):
        # A region string shaped to redirect the request to a different host
        # via the `user@host` URL syntax once it's interpolated into
        # bedrock_converse_url() — see issue #299. Must never persist.
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            config.set_bedrock_region("ap-southeast-2")
            self.assertFalse(config.set_bedrock_region("x@127.0.0.1:8443/"))
            self.assertFalse(config.set_bedrock_region("us-east-1/../evil"))
            self.assertFalse(config.set_bedrock_region("not a region"))
            self.assertFalse(config.set_bedrock_region("us-east-١"))  # Arabic-Indic 1
            self.assertEqual(config.get_bedrock_region(), "ap-southeast-2")

    def test_set_bedrock_region_strips_trailing_whitespace_before_validating(self):
        # set_bedrock_region() strips before validating (unlike
        # bedrock_converse_url(), the sink, which must reject a trailing
        # "\n" defensively since it can't assume every caller stripped).
        # A trailing newline here is just whitespace, not a bypass.
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertTrue(config.set_bedrock_region("us-east-1\n"))
            self.assertEqual(config.get_bedrock_region(), "us-east-1")

    def test_set_bedrock_region_accepts_real_aws_shapes(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            for region in ("us-east-1", "eu-west-2", "us-gov-west-1", "cn-northwest-1", "ca-central-1"):
                self.assertTrue(config.set_bedrock_region(region), region)
                self.assertEqual(config.get_bedrock_region(), region)

    def test_default_inference_profile_is_empty_string(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertEqual(config.get_bedrock_inference_profile(), "")

    def test_set_inference_profile_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            config = Config(config_path=path)
            profile = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
            self.assertTrue(config.set_bedrock_inference_profile(profile))
            self.assertEqual(config.get_bedrock_inference_profile(), profile)
            reloaded = Config(config_path=path)
            self.assertEqual(reloaded.get_bedrock_inference_profile(), profile)

    def test_empty_inference_profile_clears_value(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            config.set_bedrock_inference_profile("us.anthropic.claude-x-v1:0")
            self.assertTrue(config.set_bedrock_inference_profile(""))
            self.assertEqual(config.get_bedrock_inference_profile(), "")

    def test_whitespace_inference_profile_stored_in_config_is_normalised(self):
        # A hand-edited config.json with a whitespace-only inference profile
        # would otherwise survive `target = profile or model_id` in
        # _bedrock_chat (truthy string) and produce a URL with %20 in place
        # of the model id. Belt-and-braces strip on read.
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"bedrock_inference_profile": "   "}))
            config = Config(config_path=path)
            self.assertEqual(config.get_bedrock_inference_profile(), "")

    def test_bedrock_is_a_valid_cloud_provider(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            self.assertIn("bedrock", config.VALID_CLOUD_PROVIDERS)
            self.assertTrue(config.set_cloud_provider("bedrock"))
            self.assertEqual(config.get_cloud_provider(), "bedrock")

    def test_bedrock_has_default_cloud_model(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config = Config(config_path=Path(tmp_dir) / "config.json")
            config.set_cloud_provider("bedrock")
            # CLOUD_MODEL_DEFAULTS entry surfaces as the get_cloud_model
            # fallback when no model has been remembered for this provider yet.
            self.assertEqual(
                config.get_cloud_model(),
                "anthropic.claude-haiku-4-5-20251001-v1:0",
            )


class ConfigTemplateSeedingResilienceTests(unittest.TestCase):
    def _config_with(self, custom_templates):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "config.json"
        path.write_text(
            json.dumps({"custom_templates": custom_templates}), encoding="utf-8"
        )
        # Construction runs _seed_sample_template(); must not raise on bad data.
        return Config(config_path=path)

    def test_seeding_survives_non_list_custom_templates(self):
        config = self._config_with({"oops": "not a list"})
        self.assertIsInstance(config._config["custom_templates"], list)

    def test_seeding_drops_non_dict_entries(self):
        config = self._config_with(["nope", 42, None, {"id": "keep", "name": "K"}])
        ids = [t.get("id") for t in config._config["custom_templates"]]
        self.assertIn("keep", ids)
        self.assertNotIn("nope", ids)


class MlxTagResolutionTests(unittest.TestCase):
    def test_is_apple_silicon_true_on_darwin_arm64(self):
        with patch("src.config.sys.platform", "darwin"), \
             patch("src.config.platform.machine", return_value="arm64"):
            from src.config import is_apple_silicon
            self.assertTrue(is_apple_silicon())

    def test_is_apple_silicon_false_on_darwin_x86_64(self):
        with patch("src.config.sys.platform", "darwin"), \
             patch("src.config.platform.machine", return_value="x86_64"):
            from src.config import is_apple_silicon
            self.assertFalse(is_apple_silicon())

    def test_is_apple_silicon_false_on_windows(self):
        with patch("src.config.sys.platform", "win32"), \
             patch("src.config.platform.machine", return_value="ARM64"):
            from src.config import is_apple_silicon
            self.assertFalse(is_apple_silicon())

    def test_resolve_runtime_tag_maps_gguf_to_nvfp4_on_apple_silicon(self):
        from src.config import resolve_runtime_tag
        with patch("src.config.is_apple_silicon", return_value=True):
            self.assertEqual(resolve_runtime_tag("gemma4:e2b-it-qat"), "gemma4:e2b-nvfp4")
            self.assertEqual(resolve_runtime_tag("gemma4:e4b-it-qat"), "gemma4:e4b-nvfp4")
            self.assertEqual(resolve_runtime_tag("gemma4:12b-it-qat"), "gemma4:12b-nvfp4")

    def test_resolve_runtime_tag_is_noop_off_apple_silicon(self):
        from src.config import resolve_runtime_tag
        with patch("src.config.is_apple_silicon", return_value=False):
            self.assertEqual(resolve_runtime_tag("gemma4:e2b-it-qat"), "gemma4:e2b-it-qat")

    def test_resolve_runtime_tag_is_noop_for_non_gemma_models(self):
        from src.config import resolve_runtime_tag
        with patch("src.config.is_apple_silicon", return_value=True):
            self.assertEqual(resolve_runtime_tag("llama3.2:3b"), "llama3.2:3b")
            self.assertEqual(resolve_runtime_tag("qwen3.5:9b"), "qwen3.5:9b")
            self.assertEqual(resolve_runtime_tag("gpt-oss:20b"), "gpt-oss:20b")

    def test_mlx_to_gguf_is_exact_reverse_of_mlx_equivalents(self):
        from src.config import Config
        for gguf_id, mlx_tag in Config._MLX_EQUIVALENTS.items():
            self.assertEqual(Config._MLX_TO_GGUF[mlx_tag], gguf_id)
        self.assertEqual(len(Config._MLX_TO_GGUF), len(Config._MLX_EQUIVALENTS))


if __name__ == "__main__":
    unittest.main()
