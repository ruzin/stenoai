"""
Live integration test for pull_with_fallback.

Forces the registry path to 404 with a deliberately bogus model tag, then
verifies that the HuggingFace mirror fallback actually pulls a real model
from huggingface.co. Uses Llama 3.2 1B (~700MB) to keep bandwidth modest.

Run: python scripts/test_hf_fallback.py
Cleanup after: bin/ollama rm hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

from src.config import Config
from src import ollama_manager

# Synthesize a test case: fake internal ID whose registry tag will 404,
# paired with a small real HF mirror.
FAKE_INTERNAL_ID = "stenoai-fallback-test:does-not-exist"
SMALL_HF_MIRROR = "hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M"
Config.HF_MIRRORS[FAKE_INTERNAL_ID] = SMALL_HF_MIRROR


def progress(tag, status, completed, total):
    if total > 0 and completed > 0:
        pct = int(completed / total * 100)
        print(f"  [{tag}] {status} {pct}%", flush=True)
    elif status:
        print(f"  [{tag}] {status}", flush=True)


print(f"Calling pull_with_fallback({FAKE_INTERNAL_ID!r})")
print(f"  candidates: {Config.get_pull_candidates(FAKE_INTERNAL_ID)}")
print()

success, resolved_tag = ollama_manager.pull_with_fallback(
    FAKE_INTERNAL_ID, progress_callback=progress
)

print()
print(f"success      = {success}")
print(f"resolved_tag = {resolved_tag}")
print(f"fallback fired correctly: {success and resolved_tag == SMALL_HF_MIRROR}")
