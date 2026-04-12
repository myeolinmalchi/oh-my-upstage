"""
Skeleton for a simple notes CLI application.
The main() function and argument parsing are done.
You need to implement the NotesManager class methods.
"""

import json
import os
import sys
from datetime import datetime
from typing import Optional


NOTES_FILE = "/tmp/omu_notes.json"


class NotesManager:
    def __init__(self, filepath: str = NOTES_FILE):
        self.filepath = filepath
        self.notes: list[dict] = []
        self._load()

    def _load(self):
        """Load notes from JSON file. Create empty list if file doesn't exist."""
        if not os.path.exists(self.filepath):
            self.notes = []
        else:
            try:
                with open(self.filepath, "r") as f:
                    self.notes = json.load(f)
            except (json.JSONDecodeError, IOError):
                self.notes = []

    def _save(self):
        """Save notes to JSON file."""
        with open(self.filepath, "w") as f:
            json.dump(self.notes, f, indent=2)

    def add(self, title: str, content: str, tags: Optional[list[str]] = None) -> dict:
        """Add a new note. Returns the created note dict with id, title, content, tags, created_at."""
        note_id = 1 if not self.notes else max(note["id"] for note in self.notes) + 1
        note = {
            "id": note_id,
            "title": title,
            "content": content,
            "tags": tags if tags is not None else [],
            "created_at": datetime.now().isoformat(),
        }
        self.notes.append(note)
        self._save()
        return note

    def delete(self, note_id: int) -> bool:
        """Delete a note by ID. Returns True if found and deleted, False otherwise."""
        for note in self.notes:
            if note["id"] == note_id:
                self.notes.remove(note)
                self._save()
                return True
        return False

    def search(self, query: str) -> list[dict]:
        """Search notes by title or content (case-insensitive). Returns matching notes."""
        query_lower = query.lower()
        results = []
        for note in self.notes:
            if (
                query_lower in note["title"].lower()
                or query_lower in note["content"].lower()
            ):
                results.append(note)
        return results

    def list_all(self) -> list[dict]:
        """Return all notes sorted by created_at (newest first)."""
        return sorted(self.notes, key=lambda x: x["created_at"], reverse=True)

    def get_by_tag(self, tag: str) -> list[dict]:
        """Return all notes with the given tag."""
        return [note for note in self.notes if tag in note.get("tags", [])]

    def update(
        self,
        note_id: int,
        title: Optional[str] = None,
        content: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> Optional[dict]:
        """Update a note's fields. Only update provided fields. Returns updated note or None."""
        note_to_update = None
        for note in self.notes:
            if note["id"] == note_id:
                note_to_update = note
                break

        if note_to_update is None:
            return None

        updated = False
        if title is not None:
            note_to_update["title"] = title
            updated = True
        if content is not None:
            note_to_update["content"] = content
            updated = True
        if tags is not None:
            note_to_update["tags"] = tags
            updated = True

        if updated:
            self._save()
        return note_to_update


def main():
    if len(sys.argv) < 2:
        print("Usage: python notes_app.py <command> [args]")
        print("Commands: add, delete, search, list, tag, update")
        return

    manager = NotesManager()
    command = sys.argv[1]

    if command == "add":
        if len(sys.argv) < 4:
            print("Usage: add <title> <content> [tag1,tag2,...]")
            return
        tags = sys.argv[4].split(",") if len(sys.argv) > 4 else None
        note = manager.add(sys.argv[2], sys.argv[3], tags)
        print(f"Added note #{note['id']}: {note['title']}")

    elif command == "delete":
        if manager.delete(int(sys.argv[2])):
            print(f"Deleted note #{sys.argv[2]}")
        else:
            print(f"Note #{sys.argv[2]} not found")

    elif command == "search":
        results = manager.search(sys.argv[2])
        for note in results:
            print(f"  #{note['id']} [{','.join(note.get('tags', []))}] {note['title']}")

    elif command == "list":
        for note in manager.list_all():
            print(f"  #{note['id']} [{','.join(note.get('tags', []))}] {note['title']}")

    elif command == "tag":
        for note in manager.get_by_tag(sys.argv[2]):
            print(f"  #{note['id']} {note['title']}")

    elif command == "update":
        note = manager.update(
            int(sys.argv[2]),
            title=sys.argv[3] if len(sys.argv) > 3 else None,
            content=sys.argv[4] if len(sys.argv) > 4 else None,
        )
        if note:
            print(f"Updated note #{note['id']}")
        else:
            print(f"Note #{sys.argv[2]} not found")


if __name__ == "__main__":
    main()
