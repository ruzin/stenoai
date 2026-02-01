#!/usr/bin/env python3
"""
Prompt Testing Framework

Test multiple prompt templates on the same transcript to compare results.

Usage:
    python test_prompts.py compare path/to/transcript.txt
    python test_prompts.py compare transcripts/20241230_120000_Meeting_transcript.txt
    python test_prompts.py list-prompts
"""

import click
import json
import ollama
from pathlib import Path
from datetime import datetime
from typing import Dict, Any
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# Define your prompt templates here
PROMPT_TEMPLATES = {
    # Current prompt - matches _create_permissive_prompt in src/summarizer.py
    "current": lambda transcript: f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, discussion areas, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned.

Include a brief overview so someone can quickly understand what happened in the meeting, who were the participants, what areas/topics were discussed, what were the key points, and what are the next steps if any were mentioned.

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no participants, discussion areas, key points, or next steps are mentioned, return an empty array [] for that field.

IMPORTANT - VARIABLE NUMBER OF ITEMS:
- Discussion areas: Include as many as needed to organize the topics (1-2 for short meetings, 4-5 for complex discussions)
- Key points: Extract as many as were actually discussed (2-3 for short meetings, 6-8 for detailed discussions)
- Next steps: Include only action items that were clearly mentioned (could be 1, could be 6+)
- The examples below are illustrative - do not feel obligated to match the exact number shown

CORRECT FORMAT EXAMPLE:
{{
  "participants": ["John Smith", "Sarah Wilson"],
  "key_points": ["Budget discussion", "Timeline review"]
}}

INCORRECT FORMAT (DO NOT DO THIS):
{{
  "participants": ["John", no other participants mentioned],
  "key_points": ["Budget", timeline,]
}}

TRANSCRIPT:
{transcript}

Return ONLY the response in this exact JSON format:
{{
  "overview": "Brief overview of what happened in the meeting",
  "participants": [""],
  "discussion_areas": [
    {{
      "title": "First main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }},
    {{
      "title": "Second main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }},
    {{
      "title": "Third main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }}
  ],
  "key_points": [
    "First important point or topic discussed",
    "Second key point from the meeting",
    "Third key point from the meeting",
    "Fourth key point from the meeting",
    "Fifth key point from the meeting"
  ],
  "next_steps": [
    {{
      "description": "First next step or action item as explicitly mentioned",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Second next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Third next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Fourth next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }}
  ]
}}""",

    # Chain-of-thought prompt - step by step reasoning
    "chain_of_thought": lambda transcript: f"""You are a meeting assistant. Analyze this transcript step by step.

TRANSCRIPT:
{transcript}

---

Analyze this transcript by following these steps IN ORDER. Show your reasoning for each step before providing the final JSON.

STEP 1 - IDENTIFY SPEAKERS:
List everyone who spoke or was mentioned by name. If this is a monologue or presentation, note the speaker/presenter.

STEP 2 - LIST MAIN TOPICS:
What are the 2-5 main topics or themes discussed? List them briefly.

STEP 3 - ANALYZE EACH TOPIC:
For each topic you identified, write 1-2 sentences summarizing what was said about it.

STEP 4 - EXTRACT KEY POINTS:
What are the most important takeaways? List 3-6 concrete points.

STEP 5 - FIND ACTION ITEMS:
Were any next steps, tasks, or action items mentioned? List them with who is responsible (if stated).

STEP 6 - WRITE OVERVIEW:
Write a 2-3 sentence overview that captures the essence of this meeting/discussion.

---

After completing your analysis above, provide the final summary as valid JSON (no markdown):

{{
  "overview": "Your overview from Step 6",
  "participants": ["Names from Step 1"],
  "discussion_areas": [
    {{"title": "Topic from Step 2", "analysis": "Analysis from Step 3"}}
  ],
  "key_points": ["Points from Step 4"],
  "next_steps": [
    {{"description": "Action from Step 5", "assignee": "Person or null", "deadline": "Date or null"}}
  ]
}}"""
}


def test_prompt(prompt_name: str, prompt_template: callable, transcript: str, model: str = "llama3.2:3b") -> Dict[str, Any]:
    """
    Test a single prompt template on a transcript.

    Args:
        prompt_name: Name of the prompt template
        prompt_template: Function that generates the prompt from transcript
        transcript: The transcript text to analyze
        model: Ollama model to use

    Returns:
        Dict with results including response, timing, and any errors
    """
    logger.info(f"Testing prompt: {prompt_name}")

    try:
        # Generate the prompt
        prompt = prompt_template(transcript)

        # Time the request
        start_time = datetime.now()

        # Make the Ollama request
        client = ollama.Client()
        response = client.chat(
            model=model,
            messages=[
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            options={
                'timeout': 1800  # 30 minute timeout
            }
        )

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        # Extract response text
        response_text = response['message']['content'].strip()

        # Try to clean and parse JSON
        if response_text.startswith('```json'):
            response_text = response_text.replace('```json', '').replace('```', '').strip()
        elif response_text.startswith('```'):
            response_text = response_text.replace('```', '').strip()

        # Extract JSON if there's preamble text
        if '{' in response_text and '}' in response_text:
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            response_text = response_text[json_start:json_end].strip()

        # Try to parse the JSON
        try:
            parsed_response = json.loads(response_text)
            parse_success = True
            parse_error = None
        except json.JSONDecodeError as e:
            parsed_response = None
            parse_success = False
            parse_error = str(e)

        return {
            "prompt_name": prompt_name,
            "success": True,
            "duration_seconds": duration,
            "response_text": response_text,
            "parsed_response": parsed_response,
            "parse_success": parse_success,
            "parse_error": parse_error
        }

    except Exception as e:
        logger.error(f"Error testing prompt {prompt_name}: {e}")
        return {
            "prompt_name": prompt_name,
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


# Default output directory relative to this script
DEFAULT_OUTPUT_DIR = Path(__file__).parent / "outputs"


def compare_prompts(transcript_file: str, output_dir: str = None, model: str = "llama3.2:3b", prompts: list = None):
    """
    Compare multiple prompt templates on the same transcript.

    Args:
        transcript_file: Path to the transcript file
        output_dir: Directory to save test results (default: prompt_tests/outputs)
        model: Ollama model to use
        prompts: List of prompt names to test (default: all)
    """
    output_dir = output_dir or str(DEFAULT_OUTPUT_DIR)
    # Load transcript
    transcript_path = Path(transcript_file)
    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript file not found: {transcript_file}")

    with open(transcript_path, 'r') as f:
        transcript_content = f.read()

    logger.info(f"Loaded transcript: {transcript_path.name}")
    logger.info(f"Transcript length: {len(transcript_content)} characters")

    # Determine which prompts to test
    prompts_to_test = prompts if prompts else list(PROMPT_TEMPLATES.keys())

    # Run tests
    results = {}
    for prompt_name in prompts_to_test:
        if prompt_name not in PROMPT_TEMPLATES:
            logger.warning(f"Unknown prompt template: {prompt_name}, skipping")
            continue

        prompt_template = PROMPT_TEMPLATES[prompt_name]
        result = test_prompt(prompt_name, prompt_template, transcript_content, model)
        results[prompt_name] = result

    # Save results
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = output_path / f"prompt_comparison_{timestamp}.json"

    comparison_data = {
        "transcript_file": str(transcript_path),
        "transcript_length": len(transcript_content),
        "model": model,
        "timestamp": timestamp,
        "results": results
    }

    with open(results_file, 'w') as f:
        json.dump(comparison_data, f, indent=2)

    logger.info(f"Results saved to: {results_file}")

    # Print comparison summary
    print("\n" + "="*80)
    print(f"PROMPT COMPARISON RESULTS")
    print("="*80)
    print(f"Transcript: {transcript_path.name}")
    print(f"Model: {model}")
    print(f"Tested {len(results)} prompts\n")

    for prompt_name, result in results.items():
        print(f"\n{'─'*80}")
        print(f"PROMPT: {prompt_name}")
        print(f"{'─'*80}")

        if result['success']:
            print(f"✓ Duration: {result['duration_seconds']:.2f}s")
            print(f"✓ JSON Parse: {'Success' if result['parse_success'] else 'Failed'}")

            if result['parse_success']:
                parsed = result['parsed_response']

                # Show overview
                overview = parsed.get('overview', '')
                print(f"\nOverview ({len(overview)} chars):")
                print(f"  {overview}")

                # Show participants
                participants = parsed.get('participants', [])
                print(f"\nParticipants ({len(participants)}):")
                for p in participants:
                    print(f"  - {p}")

                # Show key points/decisions
                key_points = parsed.get('key_points', parsed.get('key_decisions', parsed.get('discussion_summary', [])))
                print(f"\nKey Points ({len(key_points)}):")
                for kp in key_points[:5]:  # Show first 5
                    if isinstance(kp, str):
                        print(f"  - {kp}")
                    elif isinstance(kp, dict):
                        print(f"  - {kp.get('decision', kp.get('topic', kp))}")
                if len(key_points) > 5:
                    print(f"  ... and {len(key_points) - 5} more")

                # Show action items
                actions = parsed.get('next_steps', parsed.get('key_actions', parsed.get('action_items', [])))
                print(f"\nAction Items ({len(actions)}):")
                for action in actions[:3]:  # Show first 3
                    if isinstance(action, str):
                        print(f"  - {action}")
                    elif isinstance(action, dict):
                        desc = action.get('description', action.get('action', ''))
                        assignee = action.get('assignee', 'Unassigned')
                        print(f"  - {desc} [{assignee}]")
                if len(actions) > 3:
                    print(f"  ... and {len(actions) - 3} more")

            else:
                print(f"\n✗ JSON Parse Error: {result['parse_error']}")
                print(f"\nRaw response preview:")
                print(f"  {result['response_text'][:300]}...")
        else:
            print(f"✗ Error: {result['error']}")

    print(f"\n{'='*80}")
    print(f"\nFull results saved to: {results_file}")
    print(f"{'='*80}\n")

    return comparison_data


@click.group()
def cli():
    """Prompt testing framework for meeting summarization"""
    pass


@cli.command()
@click.argument('transcript_file', type=click.Path(exists=True))
@click.option('--model', '-m', default='llama3.2:3b', help='Ollama model to use')
@click.option('--output', '-o', default=None, help='Output directory for results (default: prompt_tests/outputs)')
@click.option('--prompts', '-p', multiple=True, help='Specific prompts to test (can specify multiple)')
def compare(transcript_file, model, output, prompts):
    """Compare multiple prompt templates on a transcript"""
    prompt_list = list(prompts) if prompts else None
    compare_prompts(transcript_file, output, model, prompt_list)


@cli.command()
def list_prompts():
    """List all available prompt templates"""
    print("\nAvailable Prompt Templates:")
    print("="*50)
    for i, name in enumerate(PROMPT_TEMPLATES.keys(), 1):
        print(f"{i}. {name}")
    print("="*50)
    print(f"\nTotal: {len(PROMPT_TEMPLATES)} templates\n")


@cli.command()
@click.argument('prompt_name')
@click.argument('transcript_file', type=click.Path(exists=True))
def show_prompt(prompt_name, transcript_file):
    """Show what a specific prompt looks like for a transcript"""
    if prompt_name not in PROMPT_TEMPLATES:
        print(f"Error: Unknown prompt template '{prompt_name}'")
        print(f"Available prompts: {', '.join(PROMPT_TEMPLATES.keys())}")
        return

    # Load transcript
    with open(transcript_file, 'r') as f:
        transcript = f.read()

    # Show first 500 chars of transcript
    print(f"\nTranscript preview ({len(transcript)} total chars):")
    print("─"*80)
    print(transcript[:500])
    if len(transcript) > 500:
        print("...")
    print("─"*80)

    # Generate and show prompt
    prompt = PROMPT_TEMPLATES[prompt_name](transcript)

    print(f"\nGenerated Prompt for '{prompt_name}':")
    print("="*80)
    print(prompt)
    print("="*80)


if __name__ == '__main__':
    cli()
