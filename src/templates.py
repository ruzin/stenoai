"""
Template engine for StenoAI Scribe mode.

Provides extensible clinical documentation templates (SOAP, H&P, Vet, etc.)
defined as JSON files. Each template drives both LLM prompt generation and
frontend rendering via its sections metadata.
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class TemplateSection(BaseModel):
    key: str
    title: str
    instruction: str
    format: str = "paragraph"  # "paragraph" | "list" | "string"
    item_format: Optional[str] = None  # structured list item schema
    required: bool = False


class SummaryTemplate(BaseModel):
    id: str
    name: str
    description: str
    category: str  # "clinical" for now
    sections: List[TemplateSection]
    title_instruction: str = "Summarize this clinical encounter in max 6 words"


class TemplateManager:
    """Loads JSON template files and generates LLM prompts from them."""

    def __init__(self):
        self._templates: Dict[str, SummaryTemplate] = {}
        self._load_templates()

    def _get_templates_dir(self) -> Path:
        """Resolve the templates directory (bundled or project root)."""
        if getattr(sys, 'frozen', False):
            # PyInstaller bundle: templates/ is bundled alongside the executable
            base = Path(sys._MEIPASS)
        else:
            base = Path(__file__).parent.parent
        return base / "templates"

    def _load_templates(self):
        """Load all *.json template files from the templates directory."""
        templates_dir = self._get_templates_dir()
        if not templates_dir.exists():
            logger.warning(f"Templates directory not found: {templates_dir}")
            return

        for template_file in sorted(templates_dir.glob("*.json")):
            try:
                with open(template_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                template = SummaryTemplate(**data)
                self._templates[template.id] = template
                logger.info(f"Loaded template: {template.id} ({template.name})")
            except Exception as e:
                logger.error(f"Failed to load template {template_file}: {e}")

    def get_template(self, template_id: str) -> Optional[SummaryTemplate]:
        """Get a template by ID."""
        return self._templates.get(template_id)

    def list_templates(self) -> Dict[str, dict]:
        """Return a dict of {id: {name, description, category, sections}} for all templates."""
        result = {}
        for tid, t in self._templates.items():
            result[tid] = {
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "sections": [s.model_dump() for s in t.sections],
            }
        return result

    def generate_prompt(self, template: SummaryTemplate, transcript: str, language: str = "en") -> str:
        """Build an LLM prompt from a template's sections."""
        if language and language != "en":
            from .config import get_config
            language_name = get_config().get_language_name(language)
            language_instruction = (
                f"\n\nCRITICAL: Respond in {language_name}. "
                f"All text values in the JSON below MUST be written in {language_name}."
            )
        else:
            language_instruction = ""

        # Build JSON schema from sections
        schema_lines = []
        for section in template.sections:
            if section.format == "list":
                if section.item_format:
                    schema_lines.append(f'  "{section.key}": [{section.item_format}]')
                else:
                    schema_lines.append(f'  "{section.key}": ["First item", "Second item"]')
            elif section.format == "string":
                schema_lines.append(f'  "{section.key}": "Value"')
            else:  # paragraph
                schema_lines.append(f'  "{section.key}": "Detailed paragraph about {section.title.lower()}"')

        json_schema = "{\n" + ",\n".join(schema_lines) + "\n}"

        # Build section instructions
        section_instructions = []
        for section in template.sections:
            req = " (required)" if section.required else ""
            section_instructions.append(f"- {section.key}: {section.instruction}{req}")

        return f"""You are a clinical documentation assistant generating structured notes from patient encounter transcripts. Only document information explicitly stated in the transcript. Do NOT infer diagnoses or treatments not mentioned. This is a DRAFT requiring clinician review.

SECTION INSTRUCTIONS:
{chr(10).join(section_instructions)}

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use empty string "" for sections not discussed, empty array [] for list fields
3. Use null (not "null") for empty values
4. NO trailing commas anywhere
5. NO comments or extra text outside the JSON
6. ALL array elements must be properly quoted strings

IMPORTANT - VARIABLE NUMBER OF ITEMS:
- List fields: Include as many items as were discussed (1, 3, 6+ items are all fine)
- Do not pad lists with empty items or omit discussed items to match example counts
- The examples below are illustrative only

CORRECT FORMAT EXAMPLE:
{{
  "plan": ["First treatment item", "Second treatment item"],
  "medications": ["Medication 1 with dosage"]
}}

INCORRECT FORMAT (DO NOT DO THIS):
{{
  "plan": ["First", second item without quotes,],
  "medications": [Medication 1]
}}

TRANSCRIPT:
{transcript}
{language_instruction}
Return ONLY the response in this exact JSON format:
{json_schema}"""
