#!/usr/bin/env python3
"""
Migration template - copy this file to create new migrations.

Naming convention: XXX_description.py where XXX is a zero-padded version number.
Example: 001_add_context_stack.py, 002_normalize_timestamps.py

Usage:
    python 000_template.py /path/to/data/conversations up
    python 000_template.py /path/to/data/conversations down
"""

import json
import sys
from pathlib import Path

VERSION = 0  # Change this to the migration version number
DESCRIPTION = "Template migration - does nothing"


def up(data_dir: Path) -> None:
    """
    Migrate forward - apply changes to conversation JSON files.

    Args:
        data_dir: Path to the conversations directory
    """
    print(f"  Applying migration {VERSION}: {DESCRIPTION}")

    for json_file in data_dir.glob("*.json"):
        try:
            data = json.loads(json_file.read_text())

            # === Add your forward migration logic here ===
            # Example: Add a new field to all conversations
            # if "new_field" not in data:
            #     data["new_field"] = []

            json_file.write_text(json.dumps(data, indent=2))

        except json.JSONDecodeError as e:
            print(f"  Warning: Could not parse {json_file.name}: {e}")
        except Exception as e:
            print(f"  Error processing {json_file.name}: {e}")
            raise


def down(data_dir: Path) -> None:
    """
    Rollback migration - undo changes to conversation JSON files.

    Args:
        data_dir: Path to the conversations directory
    """
    print(f"  Rolling back migration {VERSION}: {DESCRIPTION}")

    for json_file in data_dir.glob("*.json"):
        try:
            data = json.loads(json_file.read_text())

            # === Add your rollback logic here ===
            # Example: Remove the field added in up()
            # data.pop("new_field", None)

            json_file.write_text(json.dumps(data, indent=2))

        except json.JSONDecodeError as e:
            print(f"  Warning: Could not parse {json_file.name}: {e}")
        except Exception as e:
            print(f"  Error processing {json_file.name}: {e}")
            raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <data_dir> <up|down>")
        sys.exit(1)

    data_dir = Path(sys.argv[1])
    direction = sys.argv[2]

    if not data_dir.exists():
        print(f"Error: Data directory does not exist: {data_dir}")
        sys.exit(1)

    if direction == "up":
        up(data_dir)
    elif direction == "down":
        down(data_dir)
    else:
        print(f"Error: Invalid direction '{direction}'. Use 'up' or 'down'.")
        sys.exit(1)
