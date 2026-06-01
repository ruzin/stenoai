"""Regression test for the adapter SSL failure.

The customer-side bug was that `urllib.request.urlopen` against
`https://<org-adapter>/ai/chat` failed with
`unable to get local issuer certificate`, because the PyInstaller bundle
ships a `_ssl` module whose compiled-in `OPENSSLDIR` paths don't exist
on the customer's Mac. `src.tls_bootstrap` is supposed to point stdlib
SSL at certifi's bundle so the default `ssl.create_default_context()` —
which is what `urlopen()` uses when called without an explicit context —
trusts a real set of CAs.

The asserts exercise that contract directly: simulate the customer's
broken state by pointing the env at `/nonexistent`, run the bootstrap,
build a default SSL context the same way `urlopen` does, and verify it
ended up with certifi's authorities loaded.
"""

import importlib
import os
import subprocess
import sys
import unittest
from pathlib import Path

import certifi


REPO_ROOT = Path(__file__).resolve().parent.parent


class TlsBootstrapTests(unittest.TestCase):
    def setUp(self):
        self._saved_env = {
            k: os.environ.get(k)
            for k in ("SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE")
        }

    def tearDown(self):
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _reimport(self):
        sys.modules.pop("src.tls_bootstrap", None)
        return importlib.import_module("src.tls_bootstrap")

    def test_configure_points_ssl_cert_file_at_certifi_bundle(self):
        os.environ.pop("SSL_CERT_FILE", None)
        os.environ.pop("REQUESTS_CA_BUNDLE", None)

        self._reimport()

        self.assertEqual(os.environ["SSL_CERT_FILE"], certifi.where())
        self.assertEqual(os.environ["REQUESTS_CA_BUNDLE"], certifi.where())
        self.assertTrue(os.path.isfile(os.environ["SSL_CERT_FILE"]))

    def test_configure_overrides_a_broken_inherited_value(self):
        # The customer's bundle effectively starts with a broken cert path
        # (the compiled-in OPENSSLDIR). The bootstrap must replace it, not
        # politely leave it alone — otherwise the fix does nothing for the
        # exact users we're trying to help.
        os.environ["SSL_CERT_FILE"] = "/nonexistent/cert.pem"
        os.environ["REQUESTS_CA_BUNDLE"] = "/nonexistent/cert.pem"

        self._reimport()

        self.assertEqual(os.environ["SSL_CERT_FILE"], certifi.where())
        self.assertEqual(os.environ["REQUESTS_CA_BUNDLE"], certifi.where())

    def test_default_ssl_context_trusts_certifi_after_bootstrap(self):
        # Run in a subprocess with SSL_CERT_FILE / DIR explicitly pointed
        # at /nonexistent so any working trust store comes from the
        # bootstrap rather than the dev machine's Homebrew CA bundle.
        # Without the bootstrap this fails to load certs and the
        # post-bootstrap context loads 100+ — that delta is the proof
        # the customer's CERTIFICATE_VERIFY_FAILED can no longer happen.
        env = {
            **os.environ,
            "SSL_CERT_FILE": "/nonexistent/cert.pem",
            "SSL_CERT_DIR": "/nonexistent",
            "PYTHONPATH": str(REPO_ROOT),
        }
        env.pop("REQUESTS_CA_BUNDLE", None)
        script = (
            "import ssl;"
            "before = len(ssl.create_default_context().get_ca_certs());"
            "import src.tls_bootstrap;"
            "after = len(ssl.create_default_context().get_ca_certs());"
            "print(before, after)"
        )
        out = subprocess.check_output(
            [sys.executable, "-c", script],
            env=env,
            cwd=str(REPO_ROOT),
            text=True,
        ).strip()
        before_str, after_str = out.split()
        before, after = int(before_str), int(after_str)
        self.assertEqual(before, 0, "expected the broken-env context to load zero CAs")
        self.assertGreater(after, 100, "expected certifi's CAs to be loaded after bootstrap")


if __name__ == "__main__":
    unittest.main()
