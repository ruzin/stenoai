#!/usr/bin/env python3
"""Comprehensive template testing with edge cases using deepseek model."""
import json
import sys
import time
from pathlib import Path

# Setup paths
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from src.templates import TemplateManager
from src.summarizer import OllamaSummarizer

# Standard test cases - matching template to appropriate transcript
STANDARD_TESTS = {
    'standard_meeting': SCRIPT_DIR / 'transcripts/standard_meeting_test.txt',
    'daily_standup': SCRIPT_DIR / 'transcripts/daily_standup_test.txt',
    'retrospective': SCRIPT_DIR / 'transcripts/retrospective_test.txt',
    'one_on_one': SCRIPT_DIR / 'transcripts/one_on_one_test.txt',
    'project_sync': SCRIPT_DIR / 'transcripts/project_sync_test.txt',
    'sales_call': SCRIPT_DIR / 'transcripts/sales_call_test.txt',
    'vet_consultation': SCRIPT_DIR / 'transcripts/vet_consultation_test.txt',
}

# Edge case transcripts to test robustness
EDGE_CASES = {
    'edge_minimal': SCRIPT_DIR / 'transcripts/edge_minimal.txt',
    'edge_fragmented': SCRIPT_DIR / 'transcripts/edge_fragmented.txt',
    'edge_no_actions': SCRIPT_DIR / 'transcripts/edge_no_actions.txt',
    'edge_numbers_dates': SCRIPT_DIR / 'transcripts/edge_numbers_dates.txt',
    'edge_technical': SCRIPT_DIR / 'transcripts/edge_technical.txt',
}

def evaluate_output(result: dict, template_id: str, transcript: str = None) -> dict:
    """Evaluate the quality of the output with comprehensive hallucination detection."""
    import re
    issues = []
    warnings = []

    if not result:
        return {"score": 0, "issues": ["No result returned"], "warnings": []}

    result_str = json.dumps(result)

    # === HALLUCINATION DETECTION ===

    # 1. Check for invented dates in multiple formats
    date_patterns = [
        (r'\d{4}-\d{2}-\d{2}', "YYYY-MM-DD date"),
        (r'\d{1,2}/\d{1,2}/\d{4}', "MM/DD/YYYY date"),
        (r'\d{1,2}/\d{1,2}/\d{2}', "MM/DD/YY date"),
        (r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}', "Month DD, YYYY date"),
    ]
    for pattern, desc in date_patterns:
        if re.search(pattern, result_str, re.IGNORECASE):
            issues.append(f"Contains {desc} (potential hallucination)")

    # 2. Check for over-specific times (e.g., "10:30 AM" when only "morning" was said)
    specific_time_pattern = r'\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)'
    time_matches = re.findall(specific_time_pattern, result_str)
    if time_matches and transcript:
        # Check if these times exist in the transcript
        for time_match in time_matches:
            if time_match.lower() not in transcript.lower():
                issues.append(f"Contains specific time '{time_match}' not in transcript")

    # 3. Check for surnames when only first names in transcript
    common_surnames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
    for surname in common_surnames:
        if surname in result_str:
            if transcript and surname not in transcript:
                issues.append(f"Contains surname '{surname}' not in transcript (hallucination)")

    # === STRUCTURAL QUALITY ===

    # 4. Check for empty string arrays (should use null or omit)
    for key, value in result.items():
        if key.startswith('_'):
            continue
        if isinstance(value, list):
            empty_items = sum(1 for item in value if item == "" or item == {} or
                            (isinstance(item, dict) and all(v in (None, "", []) for v in item.values())))
            if empty_items > 0:
                issues.append(f"{key}: contains {empty_items} empty/useless items")
        if value == "":
            issues.append(f"{key}: empty string (should be null)")

    # 5. Check for placeholder text
    placeholder_patterns = [
        r'\[.*?\]',  # [placeholder]
        r'TBD|TBA|N/A',
        r'to be determined',
        r'not specified',
        r'unknown',  # Only flag if it looks fabricated
    ]
    for pattern in placeholder_patterns[:4]:  # Skip 'unknown' for now
        if re.search(pattern, result_str, re.IGNORECASE):
            warnings.append(f"Contains placeholder text matching '{pattern}'")

    # === READABILITY METRICS ===

    # 6. Check for overly long sentences in paragraph fields
    for key, value in result.items():
        if isinstance(value, str) and len(value) > 50:
            sentences = re.split(r'[.!?]+', value)
            long_sentences = [s for s in sentences if len(s.split()) > 40]
            if long_sentences:
                warnings.append(f"{key}: contains very long sentences (>40 words)")

    # 7. Check output is not too brief for content-heavy templates
    if template_id in ['standard_meeting', 'sales_call', 'vet_consultation']:
        list_fields = [k for k, v in result.items() if isinstance(v, list) and not k.startswith('_')]
        total_items = sum(len(result[k]) for k in list_fields if isinstance(result[k], list))
        if total_items < 3 and transcript and len(transcript) > 1000:
            warnings.append("Output seems too brief for transcript length")

    # === SCORE CALCULATION ===
    # Issues are severe (-15 each), warnings are minor (-5 each)
    score = 100 - (len(issues) * 15) - (len(warnings) * 5)
    score = max(0, score)

    return {"score": score, "issues": issues, "warnings": warnings}

def test_template(summarizer, template_id: str, transcript_path: str, test_name: str):
    """Test a single template with a transcript."""
    print(f"\n{'='*60}")
    print(f"TEST: {test_name}")
    print(f"Template: {template_id}")
    print(f"{'='*60}")

    try:
        with open(transcript_path, 'r') as f:
            transcript = f.read()
    except FileNotFoundError:
        print(f"ERROR: File not found: {transcript_path}")
        return None, {"score": 0, "issues": ["File not found"], "warnings": []}

    print(f"Transcript: {len(transcript)} chars")

    start_time = time.time()
    result = summarizer.summarize_with_template(transcript, template_id)
    elapsed = time.time() - start_time

    print(f"Time: {elapsed:.1f}s")

    if result:
        # Remove metadata for display
        output = {k: v for k, v in result.items() if not k.startswith('_')}
        print(f"\nRESULT:")
        print(json.dumps(output, indent=2, default=str, ensure_ascii=False))

        # Evaluate with transcript for hallucination checking
        evaluation = evaluate_output(output, template_id, transcript)
        print(f"\nEVALUATION: Score {evaluation['score']}/100")
        if evaluation['issues']:
            print(f"Issues: {', '.join(evaluation['issues'])}")
        if evaluation.get('warnings'):
            print(f"Warnings: {', '.join(evaluation['warnings'])}")

        return output, evaluation
    else:
        print("ERROR: Summarization failed")
        return None, {"score": 0, "issues": ["Summarization failed"], "warnings": []}

def main():
    print("="*60)
    print("TEMPLATE OPTIMIZATION TEST - ROUND 2")
    print("Model: deepseek-r1:8b")
    print("="*60)

    # Initialize with deepseek model
    summarizer = OllamaSummarizer(model_name="deepseek-r1:8b")

    all_results = {}

    # Run standard tests
    print("\n" + "="*60)
    print("PART 1: STANDARD TESTS (Template-matched transcripts)")
    print("="*60)

    for template_id, transcript_path in STANDARD_TESTS.items():
        result, evaluation = test_template(
            summarizer, template_id, transcript_path,
            f"Standard: {template_id}"
        )
        all_results[f"std_{template_id}"] = {
            "result": result,
            "evaluation": evaluation
        }

    # Run edge case tests with standard_meeting template
    print("\n" + "="*60)
    print("PART 2: EDGE CASES (Using standard_meeting template)")
    print("="*60)

    for edge_name, transcript_path in EDGE_CASES.items():
        result, evaluation = test_template(
            summarizer, "standard_meeting", transcript_path,
            f"Edge: {edge_name}"
        )
        all_results[f"edge_{edge_name}"] = {
            "result": result,
            "evaluation": evaluation
        }

    # Summary
    print("\n" + "="*60)
    print("FINAL SUMMARY")
    print("="*60)

    total_score = 0
    test_count = 0

    print("\nStandard Tests:")
    for key, data in all_results.items():
        if key.startswith("std_"):
            score = data["evaluation"]["score"]
            status = "PASS" if score >= 70 else "WARN" if score >= 50 else "FAIL"
            print(f"  {key.replace('std_', '')}: {score}/100 [{status}]")
            total_score += score
            test_count += 1

    print("\nEdge Case Tests:")
    for key, data in all_results.items():
        if key.startswith("edge_"):
            score = data["evaluation"]["score"]
            status = "PASS" if score >= 70 else "WARN" if score >= 50 else "FAIL"
            issues_str = ""
            if data['evaluation']['issues']:
                issues_str = f" - Issues: {', '.join(data['evaluation']['issues'])}"
            if data['evaluation'].get('warnings'):
                issues_str += f" - Warnings: {', '.join(data['evaluation']['warnings'])}"
            print(f"  {key.replace('edge_', '')}: {score}/100 [{status}]{issues_str}")
            total_score += score
            test_count += 1

    avg_score = total_score / test_count if test_count > 0 else 0
    print(f"\nOVERALL AVERAGE: {avg_score:.1f}/100")

    if avg_score >= 80:
        print("STATUS: GOOD - Templates performing well")
    elif avg_score >= 60:
        print("STATUS: ACCEPTABLE - Some improvements needed")
    else:
        print("STATUS: NEEDS WORK - Significant issues found")

if __name__ == '__main__':
    main()
