# Prompt Testing Framework

Test multiple prompt templates on the same transcript and compare results side-by-side.

## Quick Start

### 1. List available prompts
```bash
python test_prompts.py list-prompts
```

Available prompts:
- **current** - Production prompt (matches `_create_permissive_prompt` in summarizer.py)
- **chain_of_thought** - Step-by-step reasoning before JSON output

### 2. Compare prompts on a transcript
```bash
python test_prompts.py compare transcripts/granola_ai_review_transcript.txt
```

### 3. Test specific prompts only
```bash
python test_prompts.py compare transcripts/YOUR_FILE.txt -p current -p chain_of_thought
```

### 4. Use a different model
```bash
python test_prompts.py compare transcripts/YOUR_FILE.txt --model llama3.1:8b
```

### 5. Preview what a prompt looks like
```bash
python test_prompts.py show-prompt current transcripts/YOUR_FILE.txt
```

## Understanding the Output

The comparison shows for each prompt:
- **Duration**: How long it took to generate
- **JSON Parse Success**: Whether the response was valid JSON
- **Overview**: The summary overview (with character count)
- **Participants**: List of detected participants
- **Key Points**: Main discussion points
- **Action Items**: Next steps with assignees

## Adding Your Own Prompts

Edit `test_prompts.py` and add to the `PROMPT_TEMPLATES` dictionary:

```python
PROMPT_TEMPLATES = {
    "my_custom_prompt": lambda transcript: f"""Your prompt here...

    TRANSCRIPT:
    {transcript}
    """,
}
```

## Tips

- Pay attention to:
  - **Accuracy**: Does it capture what was actually said?
  - **Hallucinations**: Does it infer things that weren't mentioned?
  - **JSON reliability**: Does it consistently return valid JSON?
- Once you find a prompt you like, update `src/summarizer.py`
