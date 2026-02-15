"""
Folder management for organizing meetings in StenoAI.

Stores folder metadata in folders.json alongside the output directory.
Meeting-to-folder assignment is stored in each meeting's summary JSON.
"""

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class FoldersManager:
    """Manages folders for organizing meetings."""

    def __init__(self, data_dir: Path):
        self.folders_file = data_dir / "folders.json"
        self._data = self._load()

    def _load(self) -> Dict:
        if self.folders_file.exists():
            try:
                with open(self.folders_file, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading folders: {e}")
        return {"folders": []}

    def _save(self) -> bool:
        try:
            self.folders_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.folders_file, "w") as f:
                json.dump(self._data, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error saving folders: {e}")
            return False

    def list_folders(self) -> List[Dict]:
        return self._data.get("folders", [])

    def create_folder(self, name: str, color: str = "#6366f1") -> Optional[Dict]:
        folder = {
            "id": str(uuid.uuid4())[:8],
            "name": name,
            "color": color,
            "created_at": datetime.now().isoformat(),
            "order": len(self._data["folders"]),
        }
        self._data["folders"].append(folder)
        if self._save():
            return folder
        return None

    def rename_folder(self, folder_id: str, name: str) -> bool:
        for folder in self._data["folders"]:
            if folder["id"] == folder_id:
                folder["name"] = name
                return self._save()
        return False

    def delete_folder(self, folder_id: str) -> bool:
        self._data["folders"] = [
            f for f in self._data["folders"] if f["id"] != folder_id
        ]
        return self._save()

    def add_meeting_to_folder(self, summary_path: Path, folder_id: str) -> bool:
        """Add a folder reference to a meeting's summary JSON."""
        try:
            with open(summary_path, "r") as f:
                data = json.load(f)
            folders = data.get("folders", [])
            if folder_id not in folders:
                folders.append(folder_id)
                data["folders"] = folders
                with open(summary_path, "w") as f:
                    json.dump(data, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error adding meeting to folder: {e}")
            return False

    def remove_meeting_from_folder(self, summary_path: Path, folder_id: str) -> bool:
        """Remove a folder reference from a meeting's summary JSON."""
        try:
            with open(summary_path, "r") as f:
                data = json.load(f)
            folders = data.get("folders", [])
            if folder_id in folders:
                folders.remove(folder_id)
                data["folders"] = folders
                with open(summary_path, "w") as f:
                    json.dump(data, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error removing meeting from folder: {e}")
            return False


def get_folders_manager() -> FoldersManager:
    """Get a FoldersManager using the current data directory."""
    from src.config import get_data_dirs
    dirs = get_data_dirs()
    # Store folders.json alongside the output directory's parent
    data_dir = dirs["output"].parent
    return FoldersManager(data_dir)
