"""Tests for the list_models() CLI command's platform-conditional MLX enrichment."""

import json
import unittest
from unittest import mock

from click.testing import CliRunner


class ListModelsMlxEnrichmentTests(unittest.TestCase):
    def test_apple_silicon_gemma_entries_gain_mlx_fields(self):
        # Exercises the real Config.SUPPORTED_MODELS + list_supported_models(),
        # only mocking the Ollama HTTP call and the platform gate.
        from simple_recorder import cli
        from src.config import Config

        runner = CliRunner()
        fake_models = [mock.Mock(model="gemma4:e2b-nvfp4")]
        fake_response = mock.Mock(models=fake_models)

        with mock.patch("src.config.is_apple_silicon", return_value=True), \
             mock.patch("ollama.list", return_value=fake_response):
            result = runner.invoke(cli, ["list-models"])

        self.assertEqual(result.exit_code, 0, result.output)
        data = json.loads(result.output)
        e2b_entry = data["supported_models"]["gemma4:e2b-it-qat"]
        self.assertEqual(e2b_entry["mlx_tag"], "gemma4:e2b-nvfp4")
        self.assertTrue(e2b_entry["mlx_installed"])

        # A model with no MLX equivalent gets neither field.
        llama_entry = data["supported_models"]["llama3.2:3b"]
        self.assertNotIn("mlx_tag", llama_entry)
        self.assertNotIn("mlx_installed", llama_entry)

    def test_off_apple_silicon_payload_has_no_mlx_fields(self):
        from simple_recorder import cli

        runner = CliRunner()
        fake_response = mock.Mock(models=[])

        with mock.patch("src.config.is_apple_silicon", return_value=False), \
             mock.patch("ollama.list", return_value=fake_response):
            result = runner.invoke(cli, ["list-models"])

        self.assertEqual(result.exit_code, 0, result.output)
        data = json.loads(result.output)
        for entry in data["supported_models"].values():
            self.assertNotIn("mlx_tag", entry)
            self.assertNotIn("mlx_installed", entry)


if __name__ == "__main__":
    unittest.main()
