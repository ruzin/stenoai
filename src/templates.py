"""Summary template management for StenoAI."""
import sys
from pathlib import Path
from typing import Dict, List, Optional
from pydantic import BaseModel
import json
import logging

logger = logging.getLogger(__name__)


class TemplateSection(BaseModel):
    """A section within a summary template."""
    key: str                    # JSON key in output
    title: str                  # Display title
    instruction: str            # LLM instruction
    format: str                 # "paragraph", "list", or "string"
    item_format: Optional[str] = None  # For lists: item structure
    required: bool = True


class SummaryTemplate(BaseModel):
    """A complete summary template definition."""
    id: str
    name: str
    description: str
    icon: str = "meeting"       # Icon identifier
    sections: List[TemplateSection]


class TemplateManager:
    """Loads and manages summary templates."""

    DEFAULT_TEMPLATE = "standard_meeting"

    def __init__(self):
        self._templates: Dict[str, SummaryTemplate] = {}
        self._load_templates()

    def _get_templates_dir(self) -> Path:
        """Get templates directory (bundled or development)."""
        # Check for bundled templates first (PyInstaller)
        if hasattr(sys, '_MEIPASS'):
            bundled = Path(sys._MEIPASS) / 'templates'
            if bundled.exists():
                return bundled
        # Development: templates/ in project root
        return Path(__file__).parent.parent / 'templates'

    def _load_templates(self):
        """Load all template JSON files."""
        templates_dir = self._get_templates_dir()
        if not templates_dir.exists():
            logger.warning(f"Templates directory not found: {templates_dir}")
            return

        for template_file in templates_dir.glob('*.json'):
            try:
                with open(template_file, 'r') as f:
                    data = json.load(f)
                template = SummaryTemplate(**data)
                self._templates[template.id] = template
                logger.info(f"Loaded template: {template.id}")
            except Exception as e:
                logger.error(f"Failed to load template {template_file}: {e}")

    def get_template(self, template_id: str) -> Optional[SummaryTemplate]:
        """Get a template by ID."""
        return self._templates.get(template_id)

    def list_templates(self) -> Dict[str, Dict[str, str]]:
        """List all templates with metadata."""
        return {
            tid: {
                "name": t.name,
                "description": t.description,
                "icon": t.icon
            }
            for tid, t in self._templates.items()
        }

    def generate_prompt(self, template: SummaryTemplate, transcript: str) -> str:
        """Generate LLM prompt from template, matching the proven permissive prompt style."""
        # Build section descriptions for the prose intro
        section_names = [s.title.lower() for s in template.sections]
        sections_prose = ", ".join(section_names[:-1]) + f" and {section_names[-1]}" if len(section_names) > 1 else section_names[0]

        # Build the JSON structure with multiple example items (like OLD prompt)
        json_structure = {}
        for section in template.sections:
            if section.format == "paragraph":
                json_structure[section.key] = f"Brief {section.title.lower()} of the meeting"
            elif section.format == "string":
                json_structure[section.key] = f"{section.title} if mentioned or null"
            elif section.format == "list":
                if section.item_format:
                    # Parse item_format and create multiple examples
                    try:
                        example_item = json.loads(section.item_format.replace("'", '"'))
                        # Create 3 example items with descriptive placeholders
                        examples = []
                        for i in range(3):
                            item = {}
                            for k, v in example_item.items():
                                if "null" in str(v).lower():
                                    item[k] = f"{k.replace('_', ' ').title()} or null if unclear"
                                else:
                                    item[k] = f"{v} {i+1}" if i > 0 else v
                            examples.append(item)
                        json_structure[section.key] = examples
                    except:
                        json_structure[section.key] = [
                            f"First {section.title.lower()} item",
                            f"Second {section.title.lower()} item",
                            f"Third {section.title.lower()} item"
                        ]
                else:
                    json_structure[section.key] = [
                        f"First {section.title.lower()} item",
                        f"Second {section.title.lower()} item",
                        f"Third {section.title.lower()} item"
                    ]

        # Build section-specific instructions
        section_instructions = []
        for section in template.sections:
            section_instructions.append(f"- {section.title}: {section.instruction}")

        prompt = f"""You are a helpful meeting assistant. Summarise this meeting transcript into {sections_prose}. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned. Use names exactly as spoken - if only "John" is mentioned, do not add a surname.

{chr(10).join(section_instructions)}

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no items are mentioned for a section, return an empty array [] for that field.

IMPORTANT - VARIABLE NUMBER OF ITEMS:
- Include as many items as needed (1-2 for short meetings, 4-6 for detailed discussions)
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
{json.dumps(json_structure, indent=2)}"""
        return prompt
