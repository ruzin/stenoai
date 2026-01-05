from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime
import uuid


class ActionItem(BaseModel):
    description: str
    assignee: Optional[str] = ""
    deadline: Optional[str] = None


class Decision(BaseModel):
    decision: str
    assignee: Optional[str] = ""
    context: str


class DiscussionArea(BaseModel):
    title: str
    analysis: str


class MeetingTranscript(BaseModel):
    meeting_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    duration: str
    overview: str
    participants: List[str]
    discussion_areas: List[DiscussionArea] = []  # New field - optional for backwards compatibility
    key_points: List[Decision]
    next_steps: List[ActionItem]
    transcript: str

    def to_json_file(self, filepath: str) -> None:
        """Save the meeting transcript to a JSON file."""
        import json
        with open(filepath, 'w') as f:
            json.dump(self.model_dump(), f, indent=2)

    @classmethod
    def from_json_file(cls, filepath: str) -> 'MeetingTranscript':
        """Load a meeting transcript from a JSON file."""
        import json
        with open(filepath, 'r') as f:
            data = json.load(f)
        return cls(**data)