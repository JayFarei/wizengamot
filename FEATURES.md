# Features

## Sidebar Enhancement (January 2025)

### Three Display Modes

The sidebar now supports three different viewing modes, accessible via the style selector below the top actions:

| Mode | Description |
|------|-------------|
| **All List** (default) | Flat list of all conversations with category badges, single scrollable area |
| **Category** | Equidistant sections for Notes, Council, Visualiser, and Monitor with independent scrolling |
| **Single/Focus** | Click a category to expand it, others collapse to headers only |

### Category Order

Sections are displayed in this order:
1. **Notes** - Synthesizer and Discovery conversations
2. **Council** - Multi-model deliberation discussions
3. **Visualiser** - Diagram and image generations
4. **Monitor** - Web monitoring configurations (compact in Category mode)
5. **Discovery** - Sticky tab at bottom for knowledge discovery queue

### Filtering and Sorting

In All List and Single modes, a filter bar provides:

- **Recent** - Sort by creation date (default)
- **Cost** - Sort by total cost descending
- **Type** - Filter by source type (YouTube, Podcast, PDF, Article, Text)
- **Mode** - Filter by origin (agent-generated vs user-created)

### Interactive Features

- **Clickable category headers** - In Category mode, clicking a section header switches to Single mode with that category focused
- **Style persistence** - Selected view mode is saved to localStorage
- **Compact Monitor section** - In Category mode, Monitor takes minimal space (1 slot) instead of equal height

### Visual Improvements

- Smaller, more compact text to fit more items
- Category badges in List mode with color coding:
  - Notes: Blue
  - Council: Amber
  - Visualiser: Purple
  - Monitor: Green
