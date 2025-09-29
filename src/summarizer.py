try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    ollama = None
    OLLAMA_AVAILABLE = False
import json
import logging
import subprocess
import time
import os
from typing import Optional, Dict, Any
from .models import MeetingTranscript, ActionItem, Decision

logger = logging.getLogger(__name__)


class OllamaSummarizer:
    def __init__(self, model_name: str = "llama3.2:3b"):
        """
        Initialize the Ollama summarizer with automatic service management.
        
        Args:
            model_name: Name of the Ollama model to use
        """
        if not OLLAMA_AVAILABLE:
            raise ImportError("Ollama is not installed. Please install ollama-python.")
            
        self.model_name = model_name
        self.client = None
        self.ollama_process = None
        
        # Ensure Ollama is ready before initializing client
        self._ensure_ollama_ready()
        self.client = ollama.Client()
    
    def _is_ollama_running(self) -> bool:
        """Check if Ollama service is running."""
        try:
            # Try to connect to Ollama API
            response = subprocess.run(['curl', '-s', 'http://localhost:11434/api/version'], 
                                    capture_output=True, timeout=5)
            return response.returncode == 0
        except:
            return False
    
    def _find_ollama_path(self) -> Optional[str]:
        """Find the Ollama executable path, handling DMG vs development environments."""
        # Try common locations where Ollama might be installed
        possible_paths = [
            'ollama',  # Try PATH first
            '/opt/homebrew/bin/ollama',  # Homebrew on Apple Silicon
            '/usr/local/bin/ollama',     # Homebrew on Intel
            '/usr/bin/ollama',           # System installation
        ]
        
        for path in possible_paths:
            try:
                result = subprocess.run([path, '--version'], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    logger.info(f"Found Ollama at: {path}")
                    return path
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue
        
        logger.error("Ollama executable not found in any common location")
        return None
    
    def _start_ollama_service(self) -> bool:
        """Start the Ollama service if not running."""
        logger.info("Starting Ollama service...")
        
        try:
            # Find the Ollama executable path
            ollama_path = self._find_ollama_path()
            if not ollama_path:
                logger.error("Ollama executable not found. Please install Ollama first.")
                logger.info("Install with: brew install ollama (macOS) or visit https://ollama.com")
                return False
            
            # Start ollama serve in background
            self.ollama_process = subprocess.Popen(
                [ollama_path, 'serve'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True  # Detach from parent process
            )
            
            # Wait for service to start (up to 30 seconds)
            logger.info("Waiting for Ollama service to start...")
            for i in range(30):
                time.sleep(1)
                if self._is_ollama_running():
                    logger.info("Ollama service started successfully")
                    return True
                    
            logger.error("Ollama service failed to start within 30 seconds")
            return False
            
        except Exception as e:
            logger.error(f"Failed to start Ollama service: {e}")
            return False
    
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
            key_actions=[],  # Create empty action items since parsing failed
            key_decisions=[],  # Create empty decisions since parsing failed  
            transcript=transcript
        )
        
        # Add key points as decisions for now (since we don't have proper action items)
        for point in key_points:
            from .models import Decision
            fallback_summary.key_decisions.append(Decision(
                decision=point,
                assignee='',
                context='Extracted from partially parsed response'
            ))
        
        logger.info("Created enhanced fallback summary with extracted data")
        return fallback_summary
    
    def _ensure_model_available(self) -> bool:
        """Ensure the required model is downloaded and available."""
        try:
            # Find the Ollama executable path
            ollama_path = self._find_ollama_path()
            if not ollama_path:
                logger.error("Ollama executable not found")
                return False
            
            # Check if model is already available
            result = subprocess.run([ollama_path, 'list'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and self.model_name in result.stdout:
                logger.info(f"Model {self.model_name} is already available")
                return True
            
            # Model not found, try to pull it
            logger.info(f"Downloading model {self.model_name}...")
            result = subprocess.run([ollama_path, 'pull', self.model_name], 
                                  capture_output=True, text=True, timeout=300)  # 5 min timeout
            
            if result.returncode == 0:
                logger.info(f"Successfully downloaded model {self.model_name}")
                return True
            else:
                logger.error(f"Failed to download model {self.model_name}: {result.stderr}")
                
                # Try fallback models
                fallback_models = ["llama3.1:8b", "llama2:7b", "llama2:latest"]
                for fallback in fallback_models:
                    logger.info(f"Trying fallback model: {fallback}")
                    result = subprocess.run([ollama_path, 'pull', fallback], 
                                          capture_output=True, text=True, timeout=300)
                    if result.returncode == 0:
                        logger.info(f"Successfully downloaded fallback model {fallback}")
                        self.model_name = fallback
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
        
    def _create_detailed_prompt(self, transcript: str, *, meeting_title: str = "", meeting_date: str = "", timezone: str = "Europe/London") -> str:
        """
        Create a comprehensive prompt for high-quality meeting analysis like Claude.
        (Legacy detailed prompt - kept for reference and can be switched back if needed)
        """
        return f"""You are an expert meeting analyst. Provide a comprehensive, detailed analysis of this meeting transcript.

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

Provide a thorough, professional analysis in the JSON format above."""

    def _create_prompt(self, transcript: str, *, meeting_title: str = "", meeting_date: str = "", timezone: str = "Europe/London") -> str:
        """
        Create a simple, clear prompt for meeting analysis.
        """
        return f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript. 

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
}}"""
        
    def summarize_transcript(self, transcript: str, duration_minutes: int) -> Optional[MeetingTranscript]:
        """
        Summarize a meeting transcript using Ollama.
        
        Args:
            transcript: The meeting transcript text
            duration_minutes: Duration of the meeting in minutes
            
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
            
            prompt = self._create_prompt(transcript)
            logger.info(f"Sending transcript to Ollama model: {self.model_name}")
            logger.info(f"Transcript length: {len(transcript)} characters")
            
            # Retry logic for Ollama API calls
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"Retry attempt {attempt + 1}/{max_retries}")
                        # Ensure Ollama is still ready on retries
                        self._ensure_ollama_ready()
                        # Recreate client connection
                        self.client = ollama.Client()
                        
                    ollama_response = self.client.chat(
                        model=self.model_name,
                        messages=[
                            {
                                'role': 'user',
                                'content': prompt
                            }
                        ],
                        options={
                            'timeout': 1800  # 30 minute timeout for longer meetings
                        }
                    )
                    break  # Success, exit retry loop
                    
                except Exception as e:
                    logger.error(f"Ollama API attempt {attempt + 1} failed: {e}")
                    if attempt == max_retries - 1:
                        raise  # Last attempt, re-raise the exception
                    else:
                        logger.info("Waiting 5 seconds before retry...")
                        time.sleep(5)
            
            response_text = ollama_response['message']['content'].strip()
            logger.info("Received response from Ollama")
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
                        key_actions=[],
                        key_decisions=[],
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
                
                meeting_summary = MeetingTranscript(
                    duration=f"{duration_minutes} minutes",
                    overview=structured_data.get('overview', ''),
                    participants=structured_data.get('participants', []),
                    key_actions=actions,
                    key_decisions=decisions,
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