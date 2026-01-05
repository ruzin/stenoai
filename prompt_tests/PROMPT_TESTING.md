# Prompt Testing Framework

This framework allows you to test multiple prompt templates on the same transcript and compare the results side-by-side.

## Quick Start

### 1. List available prompts
```bash
python test_prompts.py list-prompts
```

Available prompts:
- **current_simple** - Conservative prompt that avoids hallucinations, includes discussion areas
- **enhanced_simple** - Encourages more comprehensive extraction of discussion areas, key points, and action items

### 2. Compare all prompts on a transcript
```bash
python test_prompts.py compare transcripts/20251116_204017_Meeting-ZNZXC3_transcript.txt
```

This will:
- Run all 2 prompt templates on the same transcript
- Show a side-by-side comparison in the terminal
- Save detailed results to `prompt_tests/prompt_comparison_TIMESTAMP.json`

### 3. Test specific prompts only
```bash
python test_prompts.py compare transcripts/YOUR_FILE.txt -p current_simple -p enhanced_simple
```

### 4. Use a different model
```bash
python test_prompts.py compare transcripts/YOUR_FILE.txt --model llama3.1:8b
```

### 5. Preview what a prompt looks like
```bash
python test_prompts.py show-prompt balanced transcripts/YOUR_FILE.txt
```

## Understanding the Output

The comparison will show for each prompt:
- **Duration**: How long it took to generate the summary
- **JSON Parse Success**: Whether the response was valid JSON
- **Overview**: The summary overview (with character count)
- **Participants**: List of detected participants
- **Key Points**: Main discussion points or decisions
- **Action Items**: Next steps with assignees

## Adding Your Own Prompts

Edit `test_prompts.py` and add new prompts to the `PROMPT_TEMPLATES` dictionary:

```python
PROMPT_TEMPLATES = {
    "my_custom_prompt": lambda transcript: f"""Your prompt here...

    TRANSCRIPT:
    {transcript}
    """,
    # ... existing prompts
}
```

## Example Workflow

1. Pick a transcript that represents your typical meetings:
   ```bash
   python test_prompts.py compare transcripts/20251116_204017_Meeting-ZNZXC3_transcript.txt
   ```

2. Review the side-by-side comparison in your terminal

3. Check the detailed JSON results:
   ```bash
   cat prompt_tests/prompt_comparison_*.json | jq
   ```

4. Once you find a prompt you like, update `src/summarizer.py` to use it

## Tips

- Start with your longest/most detailed transcript to see how prompts handle complex content
- Pay attention to:
  - **Accuracy**: Does it capture what was actually said?
  - **Detail level**: Too brief or too verbose?
  - **Hallucinations**: Does it infer things that weren't mentioned?
  - **Structure**: Is the output well-organized?
  - **JSON reliability**: Does it consistently return valid JSON?

- The `enhanced_simple` prompt encourages more comprehensive extraction while staying grounded in the transcript
