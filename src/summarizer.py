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
    
    def _start_ollama_service(self) -> bool:
        """Start the Ollama service if not running."""
        logger.info("Starting Ollama service...")
        
        try:
            # Check if ollama command exists
            result = subprocess.run(['which', 'ollama'], capture_output=True, text=True)
            if result.returncode != 0:
                logger.error("Ollama not found in PATH. Please install Ollama first.")
                logger.info("Install with: brew install ollama (macOS) or visit https://ollama.com")
                return False
            
            # Start ollama serve in background
            self.ollama_process = subprocess.Popen(
                ['ollama', 'serve'],
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
    
    def _ensure_model_available(self) -> bool:
        """Ensure the required model is downloaded and available."""
        try:
            # Check if model is already available
            result = subprocess.run(['ollama', 'list'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and self.model_name in result.stdout:
                logger.info(f"Model {self.model_name} is already available")
                return True
            
            # Model not found, try to pull it
            logger.info(f"Downloading model {self.model_name}...")
            result = subprocess.run(['ollama', 'pull', self.model_name], 
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
                    result = subprocess.run(['ollama', 'pull', fallback], 
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
        
    def _create_prompt(self, transcript: str, *, meeting_title: str = "", meeting_date: str = "", timezone: str = "Europe/London") -> str:
        """
        Create a comprehensive prompt for high-quality meeting analysis like Claude.
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
            
            # Try to parse JSON response
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
                
                structured_data = json.loads(response_text)
                logger.info("Successfully parsed JSON response")
                
            except json.JSONDecodeError as e:
                logger.error(f"Ollama returned invalid JSON: {e}")
                logger.error(f"JSON parse error at position: {e.pos}")
                logger.error(f"Full Ollama response: {response_text}")
                logger.error(f"Response type: {type(response_text)}")
                logger.info("Creating fallback summary due to JSON parsing failure...")
                
                # Create a basic fallback summary for non-English or failed parsing
                try:
                    fallback_summary = MeetingTranscript(
                        duration=f"{duration_minutes} minutes",
                        overview=f"Meeting transcript recorded but detailed analysis failed. Content appears to be in a non-English language or format not fully supported.",
                        participants=[],
                        key_actions=[],
                        key_decisions=[],
                        transcript=transcript
                    )
                    logger.info("Created fallback summary")
                    return fallback_summary
                except Exception as fallback_error:
                    logger.error(f"Even fallback summary creation failed: {fallback_error}")
                    return None
            
            # Create MeetingTranscript object
            try:
                # Parse action items
                actions = []
                for action_data in structured_data.get('key_actions', []):
                    actions.append(ActionItem(
                        description=action_data.get('description', ''),
                        assignee=action_data.get('assignee', '') or '',
                        deadline=action_data.get('deadline')
                    ))
                
                # Parse decisions
                decisions = []
                for decision_data in structured_data.get('key_decisions', []):
                    decisions.append(Decision(
                        decision=decision_data.get('decision', ''),
                        assignee=decision_data.get('assignee', '') or '',
                        context=decision_data.get('context', '')
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