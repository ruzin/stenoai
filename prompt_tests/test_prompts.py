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
    "current_simple": lambda transcript: f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, discussion areas, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned. If you need to make any reasonable inference, clearly indicate it as such (e.g., "Based on the discussion, it appears...").

Include a brief overview so someone can quickly understand what happened in the meeting, who were the participants, what areas/topics were discussed, what were the key points, and what are the next steps if any were mentioned.

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no participants, discussion areas, key points, or next steps are mentioned, return an empty array [] for that field.

TRANSCRIPT:
{transcript}

Return ONLY the response in this exact JSON format:
{{
  "overview": "Brief overview of what happened in the meeting",
  "participants": [""],
  "discussion_areas": [
    {{
      "title": "Topic or area discussed",
      "analysis": "Short paragraph about what was discussed in this area"
    }}
  ],
  "key_points": [
    "Important point or topic discussed",
    "Another key point from the meeting"
  ],
  "next_steps": [
    {{
      "description": "Next step or action item as explicitly mentioned",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }}
  ]
}}""",

    "detailed_professional": lambda transcript: f"""You are an expert meeting analyst. Provide a comprehensive, detailed analysis of this meeting transcript.

INSTRUCTIONS:
1. Read the entire transcript carefully and understand the context
2. Identify the main topics, technical details, challenges, and outcomes
3. Extract specific action items with clear owners and deadlines
4. Provide a thorough but concise analysis
5. Return ONLY valid JSON - no markdown, no extra text

ANALYSIS REQUIREMENTS:
- Overview: 3-4 sentences explaining the meeting purpose, key outcomes, and next steps
- Participants: List all people mentioned by name in the transcript
- Key Actions: Specific, actionable items with clear assignees and deadlines where mentioned
- Key Decisions: Important decisions made during the meeting with context

Focus on being thorough like a professional meeting analyst would be. Include technical details, specific challenges mentioned, current status updates, and concrete next steps.

OUTPUT FORMAT (JSON only):
{{
  "overview": "Comprehensive 3-4 sentence summary including meeting purpose, main topics discussed, key outcomes, and next steps",
  "participants": ["Name1", "Name2"],
  "key_actions": [
    {{
      "description": "Specific actionable task description",
      "assignee": "Person name or null if unclear",
      "deadline": "Deadline mentioned or null"
    }}
  ],
  "key_decisions": [
    {{
      "decision": "The specific decision made",
      "assignee": "Decision owner or null",
      "context": "Why this decision was made or background context"
    }}
  ]
}}

TRANSCRIPT TO ANALYZE:
{transcript}

Provide a thorough, professional analysis in the JSON format above.""",

    "balanced": lambda transcript: f"""You are a meeting summarization assistant. Create a clear, accurate summary of this meeting transcript.

GUIDELINES:
- Base your summary primarily on what was explicitly discussed
- You may make reasonable inferences when they're clearly supported by the context, but be conservative
- Include relevant details that help understand the meeting
- Keep the summary focused and organized

REQUIRED SECTIONS:
1. Overview: 2-3 sentences covering the meeting's main purpose and outcomes
2. Participants: People mentioned in the discussion
3. Key Points: Main topics, decisions, and important details discussed
4. Action Items: Clear next steps with owners when identified

Return your response as valid JSON with no additional formatting:

{{
  "overview": "Clear 2-3 sentence summary of the meeting",
  "participants": ["Person 1", "Person 2"],
  "key_points": [
    "Main topic or decision with relevant details",
    "Another important point discussed"
  ],
  "action_items": [
    {{
      "description": "Clear action item description",
      "assignee": "Person responsible or null",
      "deadline": "Deadline if mentioned or null"
    }}
  ]
}}

TRANSCRIPT:
{transcript}""",

    "detailed_contextual": lambda transcript: f"""You are an expert meeting analyst creating a detailed summary for team members who missed the meeting.

YOUR TASK:
Analyze this transcript and create a comprehensive summary that captures:
- The purpose and context of the meeting
- Key topics discussed with important details
- Decisions made and their rationale
- Action items with clear ownership
- Important technical details or challenges mentioned
- Current status of ongoing work

STYLE:
- Be thorough and include relevant context
- Use clear, professional language
- Capture the nuance of discussions
- Include specific examples or details when they're important
- Make reasonable inferences when strongly supported by the context

FORMAT YOUR RESPONSE AS JSON:
{{
  "overview": "Comprehensive 3-5 sentence overview explaining what this meeting was about, key outcomes, and why it matters",
  "participants": ["Name 1", "Name 2"],
  "discussion_summary": [
    {{
      "topic": "Main topic or theme",
      "details": "What was discussed, decided, or discovered",
      "significance": "Why this matters or what it impacts"
    }}
  ],
  "action_items": [
    {{
      "description": "Clear, specific action item",
      "assignee": "Person responsible or null",
      "deadline": "Deadline if mentioned or null",
      "context": "Why this action is needed"
    }}
  ],
  "open_questions": [
    "Unresolved questions or topics needing follow-up"
  ]
}}

TRANSCRIPT:
{transcript}""",

    "concise_bullet": lambda transcript: f"""Summarize this meeting transcript in a concise, scannable format.

Extract only the most important information:
- Who attended
- What was discussed (main points only)
- What was decided
- What happens next

Be brief but accurate. Only include information that was clearly stated in the transcript.

Return valid JSON:
{{
  "overview": "One clear sentence summarizing the meeting",
  "participants": ["Name1", "Name2"],
  "key_points": [
    "Brief key point 1",
    "Brief key point 2"
  ],
  "next_steps": [
    "Action item 1",
    "Action item 2"
  ]
}}

TRANSCRIPT:
{transcript}""",

    "enhanced_simple": lambda transcript: f"""You are a meeting assistant. Create a clear, comprehensive summary of this meeting transcript.

GUIDELINES:
- Base your summary on what was explicitly discussed in the transcript
- Provide enough detail and context so someone who missed the meeting can understand what happened
- Organize information logically by discussion areas/topics
- Extract ALL action items and next steps mentioned (not just 2-3)
- Return ONLY valid JSON with no markdown formatting

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. Return the complete JSON object with all fields

TRANSCRIPT:
{transcript}

Return your response in this EXACT JSON format:
{{
  "overview": "2-3 sentence summary of the meeting's purpose, main topics discussed, and key outcomes",

  "participants": [
    "Name or role of participant 1",
    "Name or role of participant 2"
  ],

  "discussion_areas": [
    {{
      "title": "Main topic or theme discussed",
      "analysis": "Detailed paragraph explaining what was discussed about this topic, including context, decisions made, challenges mentioned, and any technical details or solutions proposed"
    }}
  ],

  "key_points": [
    "Important takeaway 1",
    "Important takeaway 2",
    "Important takeaway 3"
  ],

  "next_steps": [
    {{
      "action": "What needs to be done",
      "owner": "Person responsible (or null if not mentioned)",
      "timeline": "When it should happen (or null if not mentioned)"
    }}
  ]
}}

IMPORTANT INSTRUCTIONS:
- For discussion_areas: Group related topics together. Each area should have a clear title and a comprehensive analysis paragraph (2-4 sentences) covering what was discussed.
- For key_points: Extract ALL important points mentioned, not just 2-3. If there are 10 key points, list all 10.
- For next_steps: Extract ALL action items mentioned. Look for phrases like "we need to", "I'll", "should", "will", "going to", "next", "create", "set up", "test", "build". If there are 8 action items, list all 8.
- If participants aren't mentioned by name, you can use roles like "Developer 1", "Developer 2" or leave empty array if truly no participants are identifiable.""",

    "balanced_enhanced": lambda transcript: f"""You are a meeting assistant. Create a clear, accurate summary of this meeting transcript.

CRITICAL ACCURACY REQUIREMENTS:
- ONLY include information that was explicitly stated in the transcript
- DO NOT infer or assume action items that weren't clearly mentioned
- DO NOT add extra key points beyond what was actually discussed
- When in doubt, leave it out - accuracy is more important than completeness
- Return ONLY valid JSON with no markdown formatting

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. Return the complete JSON object with all fields

TRANSCRIPT:
{transcript}

Return your response in this EXACT JSON format:
{{
  "overview": "2-3 sentence summary of the meeting's purpose, main topics discussed, and key outcomes",

  "participants": [
    "Name or role of participant 1",
    "Name or role of participant 2"
  ],

  "discussion_areas": [
    {{
      "title": "Main topic or theme discussed",
      "analysis": "Detailed paragraph explaining what was discussed about this topic, including context, decisions made, challenges mentioned, and any technical details or solutions proposed"
    }}
  ],

  "key_points": [
    "Important takeaway 1",
    "Important takeaway 2"
  ],

  "next_steps": [
    {{
      "action": "What needs to be done",
      "owner": "Person responsible (or null if not mentioned)",
      "timeline": "When it should happen (or null if not mentioned)"
    }}
  ]
}}

IMPORTANT INSTRUCTIONS:
- For discussion_areas: Group related topics together. Each area should have a clear title and a comprehensive analysis paragraph (2-4 sentences) covering what was discussed. This helps provide context and structure.
- For key_points: Extract the most important takeaways and decisions that were explicitly mentioned. Focus on clarity and accuracy rather than quantity. Include points that someone who missed the meeting would need to know.
- For next_steps: ONLY include action items that were clearly stated or assigned in the meeting. Look for explicit commitments like "I will do X", "We need to Y", or "Person should Z". Do not infer actions from general discussion.
- If participants aren't mentioned by name, you can use roles like "Developer 1", "Developer 2" or leave empty array if truly no participants are identifiable.
- Remember: It's better to have 3 accurate key points than 10 points that include guesses or assumptions.""",

    "schemaless": lambda transcript: f"""Summarize this meeting transcript. Include: overview, discussion areas, key points, and next steps. Only include what was explicitly mentioned.

TRANSCRIPT:
{transcript}""",

    "optimized": lambda transcript: f"""You are a meeting assistant. Create an accurate summary of this meeting transcript.

ACCURACY RULES:
- Extract information that was explicitly discussed
- For participants: Use actual names if mentioned, otherwise use neutral labels like "Speaker 1", "Speaker 2"
- For discussion areas: Group related topics together (e.g., technical components, strategy, implementation details)
- For key points: Extract main takeaways, decisions, and important details
- For next steps: Only include actions that were clearly mentioned or agreed upon
- Scale your detail to transcript length: longer transcripts should have more discussion areas and key points

WHAT "EXPLICITLY MENTIONED" MEANS:
✓ INCLUDE: "We should create a repo" → Next step: Create repository
✓ INCLUDE: "The complexity is in the connectors" → Key point about complexity
✗ EXCLUDE: Discussion about testing → DON'T infer "write tests" unless explicitly stated

CRITICAL JSON FORMATTING:
- Use double quotes for all strings
- Use null for missing values (not "null" string)
- No trailing commas
- No text outside JSON structure

TRANSCRIPT:
{transcript}

Return ONLY this JSON format:
{{
  "overview": "2-4 sentence summary covering the meeting's purpose, main topics discussed, and key outcomes",
  "participants": ["Actual name or Speaker 1/Speaker 2 if names not mentioned"],
  "discussion_areas": [
    {{
      "title": "Clear topic name",
      "analysis": "2-3 sentence paragraph explaining what was discussed, including context and key points"
    }}
  ],
  "key_points": [
    "Important decision, takeaway, or detail from the meeting"
  ],
  "next_steps": [
    {{
      "description": "Specific action mentioned",
      "assignee": "Person's actual name or null",
      "deadline": "Deadline mentioned or null"
    }}
  ]
}}""",

    "permissive": lambda transcript: f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, discussion areas, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

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

    "live_prompt": lambda transcript: f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned. If you need to make any reasonable inference, clearly indicate it as such (e.g., "Based on the discussion, it appears...").

Include a brief overview so someone can quickly understand what happened in the meeting, who were the participants, what were the key points discussed, and what are the next steps if any were mentioned.

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no participants, key points, or next steps are mentioned, return an empty array [] for that field.

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


def compare_prompts(transcript_file: str, output_dir: str = "outputs", model: str = "llama3.2:3b", prompts: list = None):
    """
    Compare multiple prompt templates on the same transcript.

    Args:
        transcript_file: Path to the transcript file
        output_dir: Directory to save test results
        model: Ollama model to use
        prompts: List of prompt names to test (default: all)
    """
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
@click.option('--output', '-o', default='outputs', help='Output directory for results')
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
