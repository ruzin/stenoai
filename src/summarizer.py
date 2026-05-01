try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    ollama = None
    OLLAMA_AVAILABLE = False
import json
import logging
import re
import subprocess
import time
import os
from typing import Optional, Dict, Any
from .models import MeetingTranscript, ActionItem, Decision
from . import ollama_manager

logger = logging.getLogger(__name__)


# Pattern matches a complete reasoning block emitted by DeepSeek-R1 / similar
# models. ``re.DOTALL`` is required because the block spans multiple lines.
_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _strip_reasoning_tags(text: str) -> str:
    """
    Remove ``<think>...</think>`` reasoning blocks from a model response.

    Reasoning-tuned models (DeepSeek-R1 and family) emit a ``<think>`` chain
    of thought before their final answer. Ollama's curated *registry*
    distributions ship a Modelfile/template that strips these server-side,
    but raw HuggingFace GGUFs (e.g. the ``hf.co/bartowski/...`` mirrors we
    fall back to on a blocked registry) don't have that template, so the
    tags pass straight through to our parser.

    Without this strip, JSON extraction (``find('{') ... rfind('}')``) can
    span across the model's draft inside ``<think>`` and the real final
    answer, producing malformed JSON. Also handles an *unclosed* trailing
    ``<think>`` (model truncated mid-reasoning) by dropping everything
    from the opening tag onward.
    """
    if not text or "<think>" not in text:
        return text
    cleaned = _THINK_BLOCK_RE.sub("", text)
    open_idx = cleaned.find("<think>")
    if open_idx != -1:
        cleaned = cleaned[:open_idx]
    return cleaned.strip()


def _strip_reasoning_tags_streaming(chunks):
    """
    Generator that yields ``chunks`` with ``<think>...</think>`` blocks
    suppressed in-flight. Same purpose as ``_strip_reasoning_tags`` but
    works on a stream where tags can straddle chunk boundaries.

    Strategy: maintain a small holdback buffer so we never yield a
    fragment that *could* extend into a ``<think>`` opener. When a
    full ``<think>`` is observed we switch to suppressing mode and
    drop everything until ``</think>`` (again with a tail-buffer for
    partial closers). Final-chunk flushing yields any tail that can't
    be a partial tag.
    """
    OPEN, CLOSE = "<think>", "</think>"
    suppressing = False
    buffer = ""

    def trailing_partial_match(text: str, target: str) -> int:
        """How many trailing chars of *text* could be a prefix of *target*."""
        max_len = min(len(text), len(target) - 1)
        for i in range(max_len, 0, -1):
            if text.endswith(target[:i]):
                return i
        return 0

    for chunk in chunks:
        buffer += chunk
        produced = []
        while True:
            if suppressing:
                idx = buffer.find(CLOSE)
                if idx == -1:
                    # Still inside a <think>; drop everything except a
                    # possible partial closing tag at the end.
                    keep = trailing_partial_match(buffer, CLOSE)
                    buffer = buffer[len(buffer) - keep:] if keep else ""
                    break
                buffer = buffer[idx + len(CLOSE):]
                suppressing = False
                # loop again; remaining buffer might contain another tag
            else:
                idx = buffer.find(OPEN)
                if idx == -1:
                    # No <think> in buffer. Yield everything except a
                    # possible partial opener at the end.
                    keep = trailing_partial_match(buffer, OPEN)
                    if keep:
                        produced.append(buffer[:len(buffer) - keep])
                        buffer = buffer[len(buffer) - keep:]
                    else:
                        produced.append(buffer)
                        buffer = ""
                    break
                if idx > 0:
                    produced.append(buffer[:idx])
                buffer = buffer[idx + len(OPEN):]
                suppressing = True
                # loop again to find </think> in remaining buffer
        out = "".join(produced)
        if out:
            yield out

    # Stream ended. Flush any remaining buffer unless we're still
    # mid-reasoning (in which case the tail is reasoning we want to drop).
    if buffer and not suppressing:
        yield buffer


class OllamaSummarizer:
    def __init__(self, model_name: Optional[str] = None):
        """
        Initialize the summarizer with automatic service management.
        Supports local Ollama, remote Ollama, and cloud API providers.

        Args:
            model_name: Name of the model to use. If None, loads from config.
        """
        from .config import get_config
        config = get_config()

        self.ai_provider = config.get_ai_provider()
        self.client = None
        self.cloud_client = None
        self.anthropic_client = None
        self.cloud_provider = None
        self.ollama_process = None
        self.remote_url = config.get_remote_ollama_url()

        if self.ai_provider == "cloud":
            # Cloud mode: use OpenAI-compatible or Anthropic API
            cloud_api_key = config.get_cloud_api_key()
            self.cloud_provider = config.get_cloud_provider()
            cloud_api_url = config.get_cloud_api_url()
            self.model_name = model_name or config.get_cloud_model()

            if not cloud_api_key:
                raise ValueError("Cloud API key is not configured. Set it in Settings > AI.")

            if self.cloud_provider == "anthropic":
                try:
                    from anthropic import Anthropic
                except ImportError:
                    raise ImportError("anthropic package is required for Anthropic cloud mode. pip install anthropic")
                self.anthropic_client = Anthropic(api_key=cloud_api_key)
                logger.info(f"Anthropic provider initialized: model={self.model_name}")
            else:
                try:
                    from openai import OpenAI
                except ImportError:
                    raise ImportError("openai package is required for cloud mode. pip install openai")
                base_url = cloud_api_url if self.cloud_provider == "custom" and cloud_api_url else None
                self.cloud_client = OpenAI(api_key=cloud_api_key, base_url=base_url)
                logger.info(f"Cloud provider initialized: model={self.model_name}")

        elif self.ai_provider == "remote":
            # Remote mode: connect to user's Ollama on LAN
            if not OLLAMA_AVAILABLE:
                raise ImportError("Ollama is not installed. Please install ollama-python.")

            if model_name is None:
                model_name = config.get_model()
                logger.info(f"Using configured model: {model_name}")
            self.model_name = model_name

            if not self.remote_url:
                raise ValueError("Remote Ollama URL is not configured. Set it in Settings > AI.")

            self.client = ollama.Client(host=self.remote_url)
            logger.info(f"Remote Ollama initialized: host={self.remote_url}, model={self.model_name}")

        else:
            # Local mode: existing behavior
            if not OLLAMA_AVAILABLE:
                raise ImportError("Ollama is not installed. Please install ollama-python.")

            if model_name is None:
                try:
                    model_name = config.get_model()
                    logger.info(f"Using configured model: {model_name}")
                except Exception as e:
                    logger.warning(f"Failed to load model from config: {e}, using default")
                    model_name = "llama3.2:3b"

            self.model_name = model_name
            self._ensure_ollama_ready()
            self.client = ollama.Client()
    
    def _is_ollama_running(self) -> bool:
        """Check if Ollama service is running."""
        return ollama_manager.is_ollama_running()
    
    def _find_ollama_path(self) -> Optional[str]:
        """Find the Ollama executable path (bundled or system)."""
        ollama_path = ollama_manager.get_ollama_binary()
        if ollama_path:
            return str(ollama_path)
        logger.error("Ollama executable not found")
        return None
    
    def _start_ollama_service(self) -> bool:
        """Start the Ollama service if not running."""
        logger.info("Starting Ollama service...")
        return ollama_manager.start_ollama_server(wait=True, timeout=30)
    
    def _repair_json(self, json_text: str) -> Optional[str]:
        """
        Attempt to repair common JSON formatting issues.
        
        Args:
            json_text: The malformed JSON string
            
        Returns:
            Repaired JSON string or None if repair fails
        """
        try:
            logger.info("Attempting JSON repair...")
            repaired = json_text
            
            # Common repair patterns
            repairs = [
                # Fix unquoted strings in arrays (the original issue)
                (r'(\[|\,)\s*([^"\[\]{},:]+?)\s*(\]|\,)', r'\1 "\2" \3'),
                # Fix trailing commas
                (r',\s*}', '}'),
                (r',\s*]', ']'),
                # Fix missing quotes around object keys
                (r'(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1 "\2":'),
                # Fix single quotes to double quotes
                (r"'([^']*)'", r'"\1"'),
            ]
            
            for pattern, replacement in repairs:
                import re
                old_repaired = repaired
                repaired = re.sub(pattern, replacement, repaired)
                if old_repaired != repaired:
                    logger.info(f"Applied repair: {pattern}")
            
            # Test if repaired JSON is valid
            json.loads(repaired)
            logger.info("JSON repair successful")
            return repaired
            
        except Exception as e:
            logger.error(f"JSON repair failed: {e}")
            return None
    
    def _create_enhanced_fallback(self, malformed_response: str, transcript: str, duration_minutes: int) -> MeetingTranscript:
        """
        Create an enhanced fallback summary by extracting whatever data we can.
        
        Args:
            malformed_response: The malformed JSON response from Ollama
            transcript: Original transcript
            duration_minutes: Meeting duration
            
        Returns:
            MeetingTranscript with extracted data
        """
        logger.info("Creating enhanced fallback summary...")
        
        # Try to extract useful information from malformed response
        overview = "Meeting transcript was processed but JSON parsing failed."
        participants = []
        key_points = []
        
        try:
            # Extract overview if present
            if '"overview"' in malformed_response:
                import re
                overview_match = re.search(r'"overview":\s*"([^"]*)"', malformed_response)
                if overview_match:
                    overview = overview_match.group(1)
                    logger.info("Extracted overview from malformed response")
            
            # Extract participants if present
            if '"participants"' in malformed_response:
                # Try to find participant names between quotes
                import re
                participants_section = re.search(r'"participants":\s*\[(.*?)\]', malformed_response, re.DOTALL)
                if participants_section:
                    # Extract quoted strings
                    quoted_names = re.findall(r'"([^"]+)"', participants_section.group(1))
                    participants = quoted_names
                    logger.info(f"Extracted {len(participants)} participants from malformed response")
            
            # Extract key points if present
            if '"key_points"' in malformed_response:
                import re
                key_points_section = re.search(r'"key_points":\s*\[(.*?)\]', malformed_response, re.DOTALL)
                if key_points_section:
                    # Extract quoted strings
                    quoted_points = re.findall(r'"([^"]+)"', key_points_section.group(1))
                    key_points = quoted_points
                    logger.info(f"Extracted {len(key_points)} key points from malformed response")
            
        except Exception as e:
            logger.warning(f"Failed to extract data from malformed response: {e}")
        
        # Create fallback summary with extracted data
        fallback_summary = MeetingTranscript(
            duration=f"{duration_minutes} minutes",
            overview=overview,
            participants=participants,
            next_steps=[],  # Create empty action items since parsing failed
            key_points=[],  # Create empty key points since parsing failed  
            transcript=transcript
        )
        
        # Add key points
        for point in key_points:
            from .models import Decision
            fallback_summary.key_points.append(Decision(
                decision=point,
                assignee='',
                context='Extracted from partially parsed response'
            ))
        
        logger.info("Created enhanced fallback summary with extracted data")
        return fallback_summary
    
    def _ensure_model_available(self) -> bool:
        """Ensure the required model is downloaded and available (uses HTTP API).

        Resolves the configured internal model ID against installed tags,
        accepting either the canonical Ollama tag or its HuggingFace mirror tag
        (so a model pulled via the HF fallback during setup is still recognised).
        Falls back to pulling via the HF mirror if the registry pull fails.
        """
        from .config import get_config

        try:
            internal_id = self.model_name

            installed_tag = ollama_manager.find_installed_tag(internal_id)
            if installed_tag:
                if installed_tag != self.model_name:
                    logger.info(
                        f"Model {internal_id} is installed as {installed_tag} "
                        "(HF mirror) — using that tag"
                    )
                    self.model_name = installed_tag
                else:
                    logger.info(f"Model {self.model_name} is already available")
                return True

            logger.info(f"Downloading model {internal_id}...")
            success, resolved_tag = ollama_manager.pull_with_fallback(internal_id)
            if success and resolved_tag:
                logger.info(f"Successfully downloaded {internal_id} as {resolved_tag}")
                self.model_name = resolved_tag
                if resolved_tag != internal_id:
                    try:
                        get_config().set_resolved_pull_tag(internal_id, resolved_tag)
                    except Exception as e:
                        logger.warning(f"Could not persist resolved tag: {e}")
                return True

            # Last-resort: try any other supported model that's already installed,
            # so a working summary is still possible when the requested model
            # can't be pulled.
            try:
                response = ollama.list()
                models = getattr(response, 'models', []) or []
                installed = [getattr(m, 'model', '') for m in models]
            except Exception:
                installed = []

            from .config import Config
            for candidate_id in Config.SUPPORTED_MODELS.keys():
                for candidate_tag in Config.get_pull_candidates(candidate_id):
                    if candidate_tag in installed:
                        logger.info(
                            f"Using already-installed alternative model: {candidate_tag}"
                        )
                        self.model_name = candidate_tag
                        return True

            return False

        except Exception as e:
            logger.error(f"Error ensuring model availability: {e}")
            return False
    
    def _ensure_ollama_ready(self) -> bool:
        """Ensure Ollama service is running and model is available."""
        logger.info("Checking Ollama service...")
        
        # Step 1: Check if Ollama is running
        if not self._is_ollama_running():
            if not self._start_ollama_service():
                raise Exception("Failed to start Ollama service")
        else:
            logger.info("Ollama service is already running")
        
        # Step 2: Ensure model is available
        if not self._ensure_model_available():
            raise Exception(f"Failed to ensure model {self.model_name} is available")
        
        logger.info(f"Ollama ready with model {self.model_name}")
        return True
        
    def _cloud_chat(self, prompt: str, timeout_seconds: int = 300) -> str:
        """
        Send a chat request via the configured cloud API (OpenAI or Anthropic).

        Args:
            prompt: The user prompt to send
            timeout_seconds: Request timeout in seconds

        Returns:
            The assistant's response text
        """
        if self.cloud_provider == "anthropic":
            return self._anthropic_chat(prompt, timeout_seconds)
        return self._openai_chat(prompt, timeout_seconds)

    def _openai_chat(self, prompt: str, timeout_seconds: int = 300) -> str:
        """Send a chat request via the OpenAI-compatible cloud API."""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    logger.info(f"Cloud API retry attempt {attempt + 1}/{max_retries}")
                    time.sleep(5)

                response = self.cloud_client.chat.completions.create(
                    model=self.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=timeout_seconds,
                )
                return response.choices[0].message.content.strip()

            except Exception as e:
                logger.error(f"Cloud API attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    raise
        raise RuntimeError("OpenAI chat failed after all retries")

    def _anthropic_chat(self, prompt: str, timeout_seconds: int = 300) -> str:
        """Send a chat request via the Anthropic Messages API."""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    logger.info(f"Anthropic API retry attempt {attempt + 1}/{max_retries}")
                    time.sleep(5)

                response = self.anthropic_client.messages.create(
                    model=self.model_name,
                    max_tokens=4096,
                    messages=[{"role": "user", "content": prompt}],
                    timeout=timeout_seconds,
                )
                # Anthropic returns content blocks; extract text
                if not response.content:
                    raise RuntimeError("Anthropic returned empty response")
                return response.content[0].text.strip()

            except Exception as e:
                logger.error(f"Anthropic API attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    raise
        raise RuntimeError("Anthropic chat failed after all retries")

    def _create_permissive_prompt(self, transcript: str, language: str = "en", notes: str = None) -> str:
        """
        Create an enhanced prompt with discussion_areas and improved extraction.
        Uses more examples in schema to permit more detailed summaries.
        """
        # Build language instruction
        if language and language not in ("en", "auto"):
            from .config import get_config
            language_name = get_config().get_language_name(language)
            if language_name != "Unknown":
                language_instruction = f"\n\nCRITICAL: Respond in {language_name}. All text values in the JSON below MUST be written in {language_name}."
            else:
                language_instruction = ""
        else:
            language_instruction = ""

        # Add speaker label context when diarised transcript is provided
        diarisation_note = ""
        if "[You]" in transcript and "[Others]" in transcript:
            diarisation_note = """NOTE: This transcript has speaker labels. [You] is the person who recorded
the meeting. [Others] are remote participants heard through system audio.
Attribute statements to speakers in your summary where relevant.

"""

        # Add user notes context if provided
        notes_context = ""
        if notes and notes.strip():
            notes_context = f"""USER NOTES (written by the meeting participant during the recording):
{notes.strip()}

Use these notes as additional context to improve your summary. They may contain
names, jargon, or context that helps interpret the transcript more accurately.

"""

        return f"""{diarisation_note}{notes_context}You are a helpful meeting assistant. Summarise this meeting transcript into discussion areas, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned.

Include a brief overview so someone can quickly understand what happened in the meeting, what areas/topics were discussed, what were the key points, and what are the next steps if any were mentioned.

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no discussion areas, key points, or next steps are mentioned, return an empty array [] for that field.

IMPORTANT - VARIABLE NUMBER OF ITEMS:
- Discussion areas: Include as many as needed to organize the topics (1-2 for short meetings, 4-5 for complex discussions)
- Key points: Extract as many as were actually discussed (2-3 for short meetings, 6-8 for detailed discussions)
- Next steps: Include only action items that were clearly mentioned (could be 1, could be 6+)
- The examples below are illustrative - do not feel obligated to match the exact number shown

CORRECT FORMAT EXAMPLE:
{{
  "key_points": ["Budget discussion", "Timeline review"]
}}

INCORRECT FORMAT (DO NOT DO THIS):
{{
  "key_points": ["Budget", timeline,]
}}

TRANSCRIPT:
{transcript}
{language_instruction}
Return ONLY the response in this exact JSON format:
{{
  "overview": "Brief overview of what happened in the meeting",
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
}}"""

    def summarize_transcript(self, transcript: str, duration_minutes: int, language: str = "en", notes: str = None) -> Optional[MeetingTranscript]:
        """
        Summarize a meeting transcript using Ollama.

        Args:
            transcript: The meeting transcript text
            duration_minutes: Duration of the meeting in minutes
            language: Language code for the summary output

        Returns:
            MeetingTranscript object or None if summarization failed
        """
        try:
            # Handle empty or None transcripts
            if not transcript or transcript.strip() == "" or transcript.lower().strip() == "none":
                logger.warning("Empty or None transcript provided, returning placeholder summary")
                return MeetingTranscript(
                    overview="No transcript was generated for this recording. This may be due to poor audio quality, silence throughout the recording, or technical issues with the speech recognition system.",
                    participants=[],
                    action_items=[],
                    decisions=[],
                    duration_minutes=duration_minutes
                )
            
            prompt = self._create_permissive_prompt(transcript, language, notes=notes)
            logger.info(f"Sending transcript to {self.ai_provider} model: {self.model_name}")
            logger.info(f"Transcript length: {len(transcript)} characters")

            # Calculate dynamic timeout based on transcript length
            # Base 30 min + 10 min per 10k chars, capped at 2 hours
            base_timeout = 1800  # 30 minutes
            extra_timeout = (len(transcript) // 10000) * 600  # 10 min per 10k chars
            timeout_seconds = min(base_timeout + extra_timeout, 7200)  # Cap at 2 hours
            logger.info(f"Using timeout: {timeout_seconds} seconds ({timeout_seconds // 60} minutes)")

            if self.ai_provider == "cloud":
                response_text = self._cloud_chat(prompt, timeout_seconds)
            else:
                # Retry logic for Ollama API calls (local or remote)
                max_retries = 3
                ollama_response = None
                for attempt in range(max_retries):
                    try:
                        if attempt > 0:
                            logger.info(f"Retry attempt {attempt + 1}/{max_retries}")
                            if self.ai_provider == "remote":
                                self.client = ollama.Client(host=self.remote_url)
                            else:
                                self._ensure_ollama_ready()
                                self.client = ollama.Client()

                        ollama_response = self.client.chat(
                            model=self.model_name,
                            messages=[
                                {
                                    'role': 'user',
                                    'content': prompt
                                }
                            ],
                        )
                        break  # Success, exit retry loop

                    except Exception as e:
                        logger.error(f"Ollama API attempt {attempt + 1} failed: {e}")
                        if attempt == max_retries - 1:
                            raise
                        else:
                            logger.info("Waiting 5 seconds before retry...")
                            time.sleep(5)

                response_text = ollama_response['message']['content'].strip()

            response_text = _strip_reasoning_tags(response_text)

            logger.info(f"Received response from {self.ai_provider}")
            logger.info(f"Response length: {len(response_text)} characters")
            logger.info(f"Response preview: {response_text[:200]}...")
            
            # Try to parse JSON response with repair functionality
            try:
                # Remove any markdown formatting
                if response_text.startswith('```json'):
                    response_text = response_text.replace('```json', '').replace('```', '').strip()
                elif response_text.startswith('```'):
                    response_text = response_text.replace('```', '').strip()
                
                # Handle preamble text like "Here is the extracted information in JSON format:"
                if '{' in response_text and '}' in response_text:
                    # Find the first { and last } to extract just the JSON
                    json_start = response_text.find('{')
                    json_end = response_text.rfind('}') + 1
                    response_text = response_text[json_start:json_end].strip()
                
                # First attempt - try parsing as-is
                structured_data = json.loads(response_text)
                logger.info("Successfully parsed JSON response")
                
            except json.JSONDecodeError as e:
                logger.error(f"Ollama returned invalid JSON: {e}")
                logger.error(f"JSON parse error at position: {e.pos}")
                logger.error(f"Full Ollama response: {response_text}")
                logger.info("Attempting simple JSON repair for unquoted strings...")
                
                # Simple fix for unquoted strings in arrays (the actual issue we encountered)
                import re
                repaired_json = re.sub(r'(\[|\,)\s*([^"\[\]{},:]+?)\s*(\]|\,)', r'\1 "\2" \3', response_text)
                
                try:
                    structured_data = json.loads(repaired_json)
                    logger.info("Successfully parsed repaired JSON response")
                except json.JSONDecodeError:
                    logger.error("JSON repair failed, creating fallback summary")
                    
                    # Create simple fallback summary with original user-friendly message
                    fallback_summary = MeetingTranscript(
                        duration=f"{duration_minutes} minutes",
                        overview="Meeting transcript recorded but detailed analysis failed. Content appears to be in a non-English language or format not fully supported.",
                        participants=[],
                        next_steps=[],
                        key_points=[],
                        transcript=transcript
                    )
                    logger.info("Created fallback summary")
                    return fallback_summary
            
            # Create MeetingTranscript object
            try:
                # Parse next steps (formerly key_actions)
                actions = []
                for action_data in structured_data.get('next_steps', []):
                    actions.append(ActionItem(
                        description=action_data.get('description', ''),
                        assignee=action_data.get('assignee', '') or '',
                        deadline=action_data.get('deadline')
                    ))
                
                # Parse key points as decisions (keeping the same data structure for compatibility)
                decisions = []
                for point in structured_data.get('key_points', []):
                    if isinstance(point, str):
                        # Simple string format
                        decisions.append(Decision(
                            decision=point,
                            assignee='',
                            context=''
                        ))
                    elif isinstance(point, dict):
                        # Object format (fallback for complex key points)
                        decisions.append(Decision(
                            decision=point.get('point', ''),
                            assignee='',
                            context=point.get('context', '')
                        ))

                # Parse discussion areas (new field from permissive prompt)
                from .models import DiscussionArea
                discussion_areas = []
                for area_data in structured_data.get('discussion_areas', []):
                    if isinstance(area_data, dict):
                        discussion_areas.append(DiscussionArea(
                            title=area_data.get('title', ''),
                            analysis=area_data.get('analysis', '')
                        ))

                meeting_summary = MeetingTranscript(
                    duration=f"{duration_minutes} minutes",
                    overview=structured_data.get('overview', ''),
                    participants=structured_data.get('participants', []),
                    discussion_areas=discussion_areas,
                    next_steps=actions,
                    key_points=decisions,
                    transcript=transcript
                )
                
                logger.info("Successfully created MeetingTranscript object")
                return meeting_summary
                
            except Exception as e:
                logger.error(f"Error creating MeetingTranscript object: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Ollama API call failed: {e}")
            logger.error(f"Model used: {self.model_name}")
            logger.error(f"Transcript length: {len(transcript)} characters")
            logger.error(f"Error type: {type(e).__name__}")
            if hasattr(e, 'response'):
                logger.error(f"HTTP response: {e.response}")
            return None
    
    def _create_markdown_prompt(self, transcript: str, language: str = "en", notes: str = None) -> str:
        """Create a prompt that asks the LLM to output markdown directly."""
        # Language instruction
        if language and language not in ("en", "auto"):
            from .config import get_config
            language_name = get_config().get_language_name(language)
            if language_name != "Unknown":
                language_instruction = f"\n\nCRITICAL: Write the entire output in {language_name}."
            else:
                language_instruction = ""
        else:
            language_instruction = ""

        # Diarisation context
        diarisation_note = ""
        if "[You]" in transcript and "[Others]" in transcript:
            diarisation_note = "NOTE: [You] is the recorder, [Others] are remote participants.\n\n"

        # User notes context
        notes_context = ""
        if notes and notes.strip():
            notes_context = f"USER NOTES (written during the meeting):\n{notes.strip()}\n\n"

        return f"""{diarisation_note}{notes_context}Summarise this meeting transcript as markdown. Output ONLY the markdown below with no preamble, commentary, or explanation. Start directly with ## Summary.

## Summary
A 1-3 sentence overview of what was discussed.

## Key Topics
### [Topic title]
Brief analysis of what was discussed about this topic.

(Repeat for each major topic)

## Key Points
- [Key point 1]
- [Key point 2]

## Action Items
- [Action item 1]
- [Action item 2]

Only include information explicitly discussed. Do not infer or assume.{language_instruction}

TRANSCRIPT:
{transcript}"""

    def summarize_transcript_streaming(self, transcript: str, duration_minutes: int = 0, language: str = "en", notes: str = None):
        """Generator that yields markdown chunks from the LLM.

        Args:
            transcript: Meeting transcript text
            duration_minutes: Duration of the meeting
            language: Language code for output
            notes: Optional user notes for context

        Yields:
            str: Text chunks as they arrive from the LLM
        """
        prompt = self._create_markdown_prompt(transcript, language, notes)
        logger.info(f"Starting streaming summary with {self.ai_provider} model: {self.model_name}")

        if self.ai_provider == "cloud":
            if self.cloud_provider == "anthropic":
                try:
                    with self.anthropic_client.messages.stream(
                        model=self.model_name,
                        max_tokens=4096,
                        messages=[{"role": "user", "content": prompt}],
                    ) as stream:
                        for text in stream.text_stream:
                            yield text
                except Exception as e:
                    logger.error(f"Anthropic streaming failed: {e}")
                    return
            else:
                try:
                    response = self.cloud_client.chat.completions.create(
                        model=self.model_name,
                        messages=[{"role": "user", "content": prompt}],
                        stream=True,
                    )
                    for chunk in response:
                        if not chunk.choices:
                            continue
                        content = chunk.choices[0].delta.content or ""
                        if content:
                            yield content
                except Exception as e:
                    logger.error(f"OpenAI streaming failed: {e}")
                    return
        else:
            # Ollama (local or remote)
            try:
                if self.ai_provider != "remote":
                    self._ensure_ollama_ready()
                response = self.client.chat(
                    model=self.model_name,
                    messages=[{'role': 'user', 'content': prompt}],
                    stream=True,
                )

                def _chunk_contents():
                    for chunk in response:
                        content = chunk.get('message', {}).get('content', '')
                        if content:
                            yield content

                # Reasoning models (DeepSeek-R1 family) emit <think>...</think>
                # blocks before their answer. Ollama-registry templates strip
                # these server-side; raw HuggingFace GGUFs (our fallback path)
                # do not, so we strip them client-side.
                for visible in _strip_reasoning_tags_streaming(_chunk_contents()):
                    yield visible
            except Exception as e:
                logger.error(f"Ollama streaming failed: {e}")
                return

    def test_connection(self) -> bool:
        """
        Test connection to Ollama.
        
        Returns:
            True if connection is successful
        """
        try:
            models = self.client.list()
            available_models = [model.model for model in models.models]
            
            if self.model_name not in available_models:
                logger.warning(f"Model {self.model_name} not found. Available models: {available_models}")
                if available_models:
                    self.model_name = available_models[0]
                    logger.info(f"Using available model: {self.model_name}")
                else:
                    logger.error("No models available in Ollama")
                    return False
            
            # Test with a simple prompt
            test_response = self.client.chat(
                model=self.model_name,
                messages=[{'role': 'user', 'content': 'Hello'}]
            )
            
            logger.info("Ollama connection test successful")
            logger.debug(f"Test response: {test_response.get('message', {}).get('content', '')[:50]}...")
            return True
            
        except Exception as e:
            logger.error(f"Ollama connection test failed: {e}")
            return False
    
    def set_model(self, model_name: str) -> bool:
        """
        Change the Ollama model.
        
        Args:
            model_name: Name of the new model
            
        Returns:
            True if model is available and set successfully
        """
        try:
            models = self.client.list()
            available_models = [model.model for model in models.models]
            
            if model_name in available_models:
                self.model_name = model_name
                logger.info(f"Model changed to: {model_name}")
                return True
            else:
                logger.error(f"Model {model_name} not available. Available models: {available_models}")
                return False
                
        except Exception as e:
            logger.error(f"Error setting model: {e}")
            return False
    
    def cleanup(self):
        """Clean up Ollama process if we started it."""
        if self.ollama_process:
            try:
                self.ollama_process.terminate()
                self.ollama_process.wait(timeout=10)
                logger.info("Ollama service process terminated")
            except:
                try:
                    self.ollama_process.kill()
                    logger.info("Ollama service process killed")
                except:
                    pass
            self.ollama_process = None
    
    def __del__(self):
        """Cleanup when object is destroyed."""
        self.cleanup()

    def generate_title(self, summary: str, transcript: str, language: str = "en") -> Optional[str]:
        """
        Generate a short, descriptive meeting title from the summary and transcript.

        Args:
            summary: The meeting overview/summary text
            transcript: The raw transcript text (used as fallback context)
            language: Language code for the title

        Returns:
            A short title string, or None if generation failed
        """
        try:
            # Use summary if available, otherwise fall back to first part of transcript
            context = summary if summary else transcript[:2000]
            if not context or context.strip() == "":
                return None

            # Build language instruction
            if language and language not in ("en", "auto"):
                from .config import get_config
                language_name = get_config().get_language_name(language)
                if language_name != "Unknown":
                    lang_instruction = f" The title MUST be in {language_name}."
                else:
                    lang_instruction = ""
            else:
                lang_instruction = ""

            prompt = f"""Generate a short, descriptive title for this meeting based on the summary below.

RULES:
1. Maximum 6 words
2. No quotes, no punctuation, no prefixes like "Meeting:" or "Title:"
3. Just the title text, nothing else
4. Capture the main topic or purpose of the meeting{lang_instruction}

SUMMARY:
{context}

TITLE:"""

            logger.info("Generating meeting title from summary")

            if self.ai_provider == "cloud":
                response_text = self._cloud_chat(prompt, 30)
            else:
                # HTTP-level timeout must account for model cold-start (~10s Metal init)
                title_client = ollama.Client(
                    host=self.remote_url if self.ai_provider == "remote" else None,
                    timeout=90
                )
                ollama_response = title_client.chat(
                    model=self.model_name,
                    messages=[{'role': 'user', 'content': prompt}],
                )
                response_text = ollama_response['message']['content'].strip()

            # Clean up the response
            title = response_text.strip().strip('"').strip("'").strip()
            # Remove common prefixes the model might add
            for prefix in ["Title:", "Meeting:", "Meeting Title:", "title:", "meeting:"]:
                if title.lower().startswith(prefix.lower()):
                    title = title[len(prefix):].strip()

            # Enforce max length (6 words, ~60 chars)
            words = title.split()
            if len(words) > 6:
                title = " ".join(words[:6])

            # Only return if we got something meaningful
            if title and len(title) > 2:
                logger.info(f"Generated meeting title: {title}")
                return title

            return None

        except Exception as e:
            logger.warning(f"Failed to generate meeting title: {e}")
            return None

    def _build_query_prompt(self, transcript: str, question: str, language: str = "en") -> str:
        if language and language not in ("en", "auto"):
            from .config import get_config
            language_name = get_config().get_language_name(language)
            query_lang_instruction = f"\nRespond in {language_name}." if language_name != "Unknown" else ""
        else:
            query_lang_instruction = ""
        return f"""Answer the following question based on the meeting content below (summary, key topics, and transcript).
Be concise and direct. If the answer requires inference from what was discussed, that's fine.
Only say you don't know if the topic truly wasn't discussed at all.{query_lang_instruction}

QUESTION: {question}

{transcript}

ANSWER:"""

    def query_transcript_streaming(self, transcript: str, question: str, language: str = "en"):
        """Generator that yields text chunks from the LLM for a transcript query."""
        if not transcript or transcript.strip() == "":
            yield "No transcript available to query."
            return
        if not question or question.strip() == "":
            yield "Please provide a question."
            return

        prompt = self._build_query_prompt(transcript, question, language)

        try:
            if self.ai_provider == "cloud":
                if self.cloud_provider == "anthropic":
                    with self.anthropic_client.messages.stream(
                        model=self.model_name,
                        max_tokens=2048,
                        messages=[{"role": "user", "content": prompt}],
                    ) as stream:
                        for text in stream.text_stream:
                            yield text
                else:
                    response = self.cloud_client.chat.completions.create(
                        model=self.model_name,
                        messages=[{"role": "user", "content": prompt}],
                        stream=True,
                    )
                    for chunk in response:
                        # Some providers emit chunk variants with empty choices
                        # (e.g. usage-only chunks); skip those instead of crashing.
                        if not chunk.choices:
                            continue
                        content = chunk.choices[0].delta.content
                        if content:
                            yield content
            else:
                if self.ai_provider == "remote":
                    self.client = ollama.Client(host=self.remote_url)
                else:
                    self._ensure_ollama_ready()
                    self.client = ollama.Client()
                stream = self.client.chat(
                    model=self.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    stream=True,
                )
                for chunk in stream:
                    content = chunk['message']['content']
                    if content:
                        yield content
        except Exception as e:
            logger.error(f"Streaming query failed: {e}")
            yield f"\n[Error: {e}]"

    def query_transcript(self, transcript: str, question: str, language: str = "en") -> Optional[str]:
        """
        Query a transcript with a question using Ollama.

        Args:
            transcript: The meeting transcript text
            question: The question to ask about the transcript
            language: Language code for the response

        Returns:
            Answer string or None if query failed
        """
        try:
            if not transcript or transcript.strip() == "":
                return "No transcript available to query."

            if not question or question.strip() == "":
                return "Please provide a question."

            prompt = self._build_query_prompt(transcript, question, language)

            logger.info(f"Querying transcript with question: {question[:50]}...")

            if self.ai_provider == "cloud":
                response_text = self._cloud_chat(prompt, 120)
            else:
                # Retry logic for Ollama API calls (local or remote)
                max_retries = 2
                for attempt in range(max_retries):
                    try:
                        if attempt > 0:
                            logger.info(f"Retry attempt {attempt + 1}/{max_retries}")
                            if self.ai_provider == "remote":
                                self.client = ollama.Client(host=self.remote_url)
                            else:
                                self._ensure_ollama_ready()
                                self.client = ollama.Client()

                        ollama_response = self.client.chat(
                            model=self.model_name,
                            messages=[
                                {
                                    'role': 'user',
                                    'content': prompt
                                }
                            ],
                        )
                        break

                    except Exception as e:
                        logger.error(f"Ollama API attempt {attempt + 1} failed: {e}")
                        if attempt == max_retries - 1:
                            raise
                        else:
                            logger.info("Waiting 2 seconds before retry...")
                            time.sleep(2)

                response_text = ollama_response['message']['content'].strip()
            logger.info(f"Query response received: {len(response_text)} characters")

            return response_text

        except Exception as e:
            logger.error(f"Query transcript failed: {e}")
            return None
