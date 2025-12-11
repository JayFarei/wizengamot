#!/usr/bin/env python3
"""
Migration script to regenerate titles for conversations that still have "New Conversation".
"""

import asyncio
import json
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config import DATA_DIR
from backend.council import (
    generate_conversation_title,
    generate_synthesizer_title,
    generate_visualiser_title,
)
from backend.storage import get_conversation, save_conversation


async def migrate_titles():
    """Regenerate titles for all conversations with 'New Conversation' title."""

    if not os.path.exists(DATA_DIR):
        print("No data directory found.")
        return

    conversations_to_migrate = []

    # Find all conversations that need title regeneration
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith('.json'):
            continue

        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, 'r') as f:
            data = json.load(f)

        title = data.get('title', 'New Conversation')
        if title == 'New Conversation' and len(data.get('messages', [])) > 0:
            conversations_to_migrate.append({
                'id': data['id'],
                'mode': data.get('mode', 'council'),
                'messages': data.get('messages', []),
            })

    print(f"Found {len(conversations_to_migrate)} conversations to migrate.")

    for conv in conversations_to_migrate:
        conv_id = conv['id']
        mode = conv['mode']
        messages = conv['messages']

        print(f"\nProcessing {conv_id} (mode: {mode})...")

        try:
            new_title = None

            if mode == 'council':
                # Get first user message
                first_user_msg = next(
                    (m for m in messages if m.get('role') == 'user'),
                    None
                )
                if first_user_msg:
                    query = first_user_msg.get('content', '')
                    if query:
                        new_title = await generate_conversation_title(query)

            elif mode == 'synthesizer':
                # Get first assistant message with notes
                first_assistant_msg = next(
                    (m for m in messages if m.get('role') == 'assistant' and m.get('notes')),
                    None
                )
                if first_assistant_msg:
                    notes = first_assistant_msg.get('notes', [])
                    if notes:
                        new_title = await generate_synthesizer_title(notes)

            elif mode == 'visualiser':
                # Get first assistant message with source_content
                first_assistant_msg = next(
                    (m for m in messages if m.get('role') == 'assistant' and m.get('source_content')),
                    None
                )
                if first_assistant_msg:
                    source_content = first_assistant_msg.get('source_content', '')
                    if source_content:
                        new_title = await generate_visualiser_title(source_content)

            if new_title and new_title != 'New Conversation':
                # Load and update the conversation
                conversation = get_conversation(conv_id)
                if conversation:
                    conversation['title'] = new_title
                    save_conversation(conversation)
                    print(f"  Updated title: {new_title}")
            else:
                print(f"  Could not generate title, skipping.")

        except Exception as e:
            print(f"  Error: {e}")
            continue

    print("\nMigration complete!")


if __name__ == '__main__':
    asyncio.run(migrate_titles())
