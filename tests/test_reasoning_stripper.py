import pytest
from src.summarizer import _strip_reasoning_blocks, _strip_reasoning_stream

def test_strip_reasoning_blocks_think():
    text = "<think>\nThinking about this...\n</think>\n## Summary\nHere is the summary."
    assert _strip_reasoning_blocks(text) == "## Summary\nHere is the summary."

def test_strip_reasoning_blocks_thought():
    text = "<thought>\nThinking about this...\n</thought>\n## Summary\nHere is the summary."
    assert _strip_reasoning_blocks(text) == "## Summary\nHere is the summary."

def test_strip_reasoning_blocks_inline():
    text = "<thought>Thinking...</thought>## Summary\nHere is the summary."
    assert _strip_reasoning_blocks(text) == "## Summary\nHere is the summary."

def test_strip_reasoning_blocks_none():
    text = "## Summary\nHere is the summary."
    assert _strip_reasoning_blocks(text) == "## Summary\nHere is the summary."

def test_strip_reasoning_stream_think():
    chunks = ["<th", "ink>\nThinking...\n</t", "hink>\n## Summary", "\nHere is the summary."]
    result = "".join(list(_strip_reasoning_stream(chunks)))
    assert result.strip() == "## Summary\nHere is the summary."

def test_strip_reasoning_stream_thought():
    chunks = ["<th", "ought>\nThinking...\n</t", "hought>\n## Summary", "\nHere is the summary."]
    result = "".join(list(_strip_reasoning_stream(chunks)))
    assert result.strip() == "## Summary\nHere is the summary."

def test_strip_reasoning_stream_inline():
    chunks = ["<thought>Thinking...</thought>", "## Summary\nHere is the summary."]
    result = "".join(list(_strip_reasoning_stream(chunks)))
    assert result.strip() == "## Summary\nHere is the summary."

def test_strip_reasoning_stream_none():
    chunks = ["## Summary\n", "Here is the summary."]
    result = "".join(list(_strip_reasoning_stream(chunks)))
    assert result.strip() == "## Summary\nHere is the summary."
