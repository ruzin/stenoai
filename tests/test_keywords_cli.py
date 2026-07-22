import os
import tempfile
import unittest
from click.testing import CliRunner
from simple_recorder import cli


class KeywordsCliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        os.environ["STENOAI_USER_DATA_DIR"] = self._tmp

    def tearDown(self):
        os.environ.pop("STENOAI_USER_DATA_DIR", None)

    def test_set_then_get_roundtrip(self):
        runner = CliRunner()
        r1 = runner.invoke(cli, ["set-custom-keywords", "NexGen Suite: NexGan Suite"])
        self.assertEqual(r1.exit_code, 0, r1.output)
        self.assertIn('"success": true', r1.output)
        r2 = runner.invoke(cli, ["get-custom-keywords"])
        self.assertEqual(r2.exit_code, 0, r2.output)
        self.assertIn("NexGen Suite: NexGan Suite", r2.output)
