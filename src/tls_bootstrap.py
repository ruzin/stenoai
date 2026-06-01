"""Point Python's stdlib SSL at certifi's CA bundle.

PyInstaller compiles `_ssl` with the build host's `OPENSSLDIR` baked in
(usually a Homebrew path on a dev Mac). On a customer's clean Mac that
path doesn't exist, so every HTTPS call from `urllib` / `http.client` —
including the adapter requests in `summarizer.py` — fails with
`[SSL: CERTIFICATE_VERIFY_FAILED] unable to get local issuer certificate`.

Pointing `SSL_CERT_FILE` at certifi's bundle (which PyInstaller already
ships as a data file under `_internal/certifi/cacert.pem`) makes stdlib
SSL self-contained, so the desktop app works on any Mac without the
user touching anything.
"""

from __future__ import annotations

import os


def configure() -> None:
    try:
        import certifi
    except ImportError:
        return
    ca_file = certifi.where()
    if not os.path.isfile(ca_file):
        return
    os.environ["SSL_CERT_FILE"] = ca_file
    os.environ["REQUESTS_CA_BUNDLE"] = ca_file


configure()
