"""Source metadata extraction for knowledge graph enrichment.

This module extracts structured metadata from source URLs and titles
to enrich entity extraction with author, publication, and context information.
"""

import json
import logging
import re
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse

from .openrouter import query_model
from .settings import get_knowledge_graph_model

logger = logging.getLogger(__name__)


@dataclass
class EntityInfo:
    """Represents an entity extracted from source metadata."""
    name: str
    type: str  # person, organization, publication, channel, event
    role: str  # author, creator, publisher, host, guest
    confidence: float = 0.8


@dataclass
class SourceMetadata:
    """Structured metadata extracted from a source URL and title."""
    author_entities: List[EntityInfo] = field(default_factory=list)
    context_entities: List[EntityInfo] = field(default_factory=list)
    temporal_context: Optional[str] = None
    content_type: str = "article"  # interview, lecture, article, podcast, video, etc.
    inferred_context: str = ""
    source_url: Optional[str] = None
    source_title: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "author_entities": [asdict(e) for e in self.author_entities],
            "context_entities": [asdict(e) for e in self.context_entities],
            "temporal_context": self.temporal_context,
            "content_type": self.content_type,
            "inferred_context": self.inferred_context,
            "source_url": self.source_url,
            "source_title": self.source_title,
        }


# Well-known YouTube channels and their common names
YOUTUBE_CHANNEL_MAPPINGS = {
    "lexfridman": ("Lex Fridman", "person", "host"),
    "hubaboratory": ("Andrew Huberman", "person", "host"),
    "jaboratory": ("Andrew Huberman", "person", "host"),  # Alt handle
    "joerogan": ("Joe Rogan", "person", "host"),
    "veritasium": ("Derek Muller", "person", "creator"),
    "3blue1brown": ("Grant Sanderson", "person", "creator"),
    "computerphile": ("Computerphile", "organization", "publisher"),
    "numberphile": ("Numberphile", "organization", "publisher"),
    "kurzgesagt": ("Kurzgesagt", "organization", "publisher"),
    "vsauce": ("Michael Stevens", "person", "creator"),
    "crashcourse": ("Crash Course", "organization", "publisher"),
    "tedtalks": ("TED", "organization", "publisher"),
    "ted": ("TED", "organization", "publisher"),
    "tedx": ("TEDx", "organization", "publisher"),
    "mitocw": ("MIT OpenCourseWare", "organization", "publisher"),
    "stanford": ("Stanford University", "organization", "publisher"),
    "googledevelopers": ("Google", "organization", "publisher"),
}

# Well-known podcast shows
PODCAST_SHOW_MAPPINGS = {
    "lex fridman podcast": ("Lex Fridman", "person", "host"),
    "huberman lab": ("Andrew Huberman", "person", "host"),
    "the joe rogan experience": ("Joe Rogan", "person", "host"),
    "making sense": ("Sam Harris", "person", "host"),
    "acquired": ("Acquired", "organization", "publisher"),
    "all-in": ("All-In Podcast", "organization", "publisher"),
    "founders": ("David Senra", "person", "host"),
}

# Well-known publication domains
PUBLICATION_DOMAINS = {
    "nytimes.com": ("The New York Times", "organization", "publisher"),
    "washingtonpost.com": ("The Washington Post", "organization", "publisher"),
    "theguardian.com": ("The Guardian", "organization", "publisher"),
    "bbc.com": ("BBC", "organization", "publisher"),
    "bbc.co.uk": ("BBC", "organization", "publisher"),
    "economist.com": ("The Economist", "organization", "publisher"),
    "wired.com": ("Wired", "organization", "publisher"),
    "arstechnica.com": ("Ars Technica", "organization", "publisher"),
    "techcrunch.com": ("TechCrunch", "organization", "publisher"),
    "theverge.com": ("The Verge", "organization", "publisher"),
    "medium.com": ("Medium", "organization", "platform"),
    "substack.com": ("Substack", "organization", "platform"),
    "arxiv.org": ("arXiv", "organization", "repository"),
    "nature.com": ("Nature", "organization", "publisher"),
    "science.org": ("Science", "organization", "publisher"),
    "pnas.org": ("PNAS", "organization", "publisher"),
    "acm.org": ("ACM", "organization", "publisher"),
    "ieee.org": ("IEEE", "organization", "publisher"),
    "springer.com": ("Springer", "organization", "publisher"),
    "sciencedirect.com": ("Elsevier", "organization", "publisher"),
    "hbr.org": ("Harvard Business Review", "organization", "publisher"),
    "stratechery.com": ("Stratechery", "organization", "publisher"),
}


def extract_youtube_channel(url: str) -> Optional[EntityInfo]:
    """
    Extract channel information from YouTube URL.

    Handles patterns:
    - youtube.com/@handle
    - youtube.com/c/ChannelName
    - youtube.com/channel/UC...
    - youtube.com/user/username
    """
    parsed = urlparse(url)
    if "youtube.com" not in parsed.netloc and "youtu.be" not in parsed.netloc:
        return None

    path = parsed.path.lower()

    # Handle @handle format
    handle_match = re.search(r'/@([^/\?]+)', path)
    if handle_match:
        handle = handle_match.group(1).lower()
        if handle in YOUTUBE_CHANNEL_MAPPINGS:
            name, etype, role = YOUTUBE_CHANNEL_MAPPINGS[handle]
            return EntityInfo(name=name, type=etype, role=role)
        # Return the handle as a channel name
        return EntityInfo(
            name=f"@{handle_match.group(1)}",
            type="channel",
            role="creator",
            confidence=0.6
        )

    # Handle /c/ChannelName format
    channel_match = re.search(r'/c/([^/\?]+)', path)
    if channel_match:
        channel_name = channel_match.group(1).replace('-', ' ').replace('_', ' ')
        return EntityInfo(
            name=channel_name,
            type="channel",
            role="creator",
            confidence=0.7
        )

    # Handle /user/username format
    user_match = re.search(r'/user/([^/\?]+)', path)
    if user_match:
        username = user_match.group(1)
        if username.lower() in YOUTUBE_CHANNEL_MAPPINGS:
            name, etype, role = YOUTUBE_CHANNEL_MAPPINGS[username.lower()]
            return EntityInfo(name=name, type=etype, role=role)

    return None


def extract_podcast_show(url: str, title: str) -> Optional[EntityInfo]:
    """
    Extract podcast show information from URL and title.
    """
    # Check title for known podcast shows
    title_lower = title.lower()
    for show_name, (name, etype, role) in PODCAST_SHOW_MAPPINGS.items():
        if show_name in title_lower:
            return EntityInfo(name=name, type=etype, role=role)

    # Try to extract from title patterns like "Show Name: Episode Title"
    # or "Show Name - Episode Title" or "Show Name | Episode Title"
    title_match = re.match(r'^([^:\-|]+?)[\s]*[:\-|][\s]', title)
    if title_match:
        show_name = title_match.group(1).strip()
        if len(show_name) > 3 and len(show_name) < 50:
            return EntityInfo(
                name=show_name,
                type="organization",
                role="publisher",
                confidence=0.6
            )

    return None


def extract_publication_from_domain(url: str) -> Optional[EntityInfo]:
    """
    Extract publication information from URL domain.
    """
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    # Remove www. prefix
    if domain.startswith("www."):
        domain = domain[4:]

    if domain in PUBLICATION_DOMAINS:
        name, etype, role = PUBLICATION_DOMAINS[domain]
        return EntityInfo(name=name, type=etype, role=role)

    # For substack, extract the subdomain as the publication name
    if "substack.com" in domain:
        subdomain = domain.replace(".substack.com", "")
        if subdomain and subdomain != "substack":
            return EntityInfo(
                name=subdomain.replace("-", " ").title(),
                type="publication",
                role="publisher",
                confidence=0.7
            )

    # For medium, check for custom domains or subdomains
    if "medium.com" in domain:
        path = parsed.path
        # Check for @author pattern
        author_match = re.match(r'^/@([^/]+)', path)
        if author_match:
            return EntityInfo(
                name=author_match.group(1),
                type="person",
                role="author",
                confidence=0.6
            )

    return None


def infer_content_type(url: str, title: str, source_type: str) -> str:
    """
    Infer the content type from URL, title, and source type.
    """
    title_lower = title.lower()

    if source_type == "youtube":
        # Check title patterns for content type
        if any(word in title_lower for word in ["interview", "conversation with", "talks with", "speaks with"]):
            return "interview"
        if any(word in title_lower for word in ["lecture", "class", "lesson", "course"]):
            return "lecture"
        if any(word in title_lower for word in ["tutorial", "how to", "guide"]):
            return "tutorial"
        if any(word in title_lower for word in ["podcast", "episode", "ep."]):
            return "podcast_video"
        return "video"

    if source_type == "podcast":
        if any(word in title_lower for word in ["interview", "conversation", "talks with"]):
            return "interview"
        return "podcast"

    if source_type == "pdf":
        if "arxiv" in url.lower():
            return "research_paper"
        if any(word in title_lower for word in ["paper", "study", "research"]):
            return "research_paper"
        return "document"

    # Article type detection
    if any(word in title_lower for word in ["how to", "guide", "tutorial"]):
        return "tutorial"
    if any(word in title_lower for word in ["review", "analysis"]):
        return "analysis"
    if any(word in title_lower for word in ["interview", "conversation"]):
        return "interview"
    if any(word in title_lower for word in ["opinion", "editorial"]):
        return "opinion"

    return "article"


# LLM prompt for inferring source context
SOURCE_INFERENCE_PROMPT = """Analyze this content source and extract metadata.

URL: {url}
Title: {title}
Source Type: {source_type}

Based on the URL and title, infer:
1. Who created this content (author/speaker/host)?
2. What organization or publication is it from?
3. What type of content is this (interview, lecture, essay, etc.)?
4. Any temporal context (when was it created, what time period does it discuss)?
5. A brief (1-2 sentence) summary of the context.

Return ONLY a JSON object with these fields:
{{
  "author_name": "Name or null if unknown",
  "author_type": "person|organization|channel",
  "author_role": "author|creator|host|speaker|guest",
  "publisher_name": "Name or null if unknown",
  "publisher_type": "organization|publication|channel",
  "content_type": "interview|lecture|essay|tutorial|podcast|video|article|research_paper",
  "temporal_context": "Date or time period reference, or null",
  "context_summary": "Brief context description"
}}"""


async def infer_source_metadata_llm(
    url: str,
    title: str,
    source_type: str,
    model: Optional[str] = None
) -> Dict[str, Any]:
    """
    Use LLM to infer source metadata when URL parsing is insufficient.
    """
    if model is None:
        model = get_knowledge_graph_model()

    prompt = SOURCE_INFERENCE_PROMPT.format(
        url=url,
        title=title,
        source_type=source_type
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, timeout=30.0)

        if response is None:
            return {}

        content = response.get("content", "").strip()

        # Parse JSON from response
        if content.startswith("```"):
            content = re.sub(r'^```(?:json)?\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        return json.loads(content)

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM source metadata: {e}")
        return {}
    except Exception as e:
        logger.error(f"Error inferring source metadata: {e}")
        return {}


async def extract_source_metadata(
    url: str,
    title: str,
    source_type: str,
    use_crawler: bool = False,
    use_llm: bool = True
) -> SourceMetadata:
    """
    Extract structured metadata from source URL and title.

    Args:
        url: The source URL
        title: The content title
        source_type: Type of source (youtube, podcast, article, pdf)
        use_crawler: Whether to use Crawl4AI for additional metadata (articles only)
        use_llm: Whether to use LLM for inference when parsing is insufficient

    Returns:
        SourceMetadata with extracted entities and context
    """
    metadata = SourceMetadata(
        source_url=url,
        source_title=title,
        content_type=infer_content_type(url, title, source_type)
    )

    # Step 1: URL-based extraction (always fast)
    if source_type == "youtube":
        channel_entity = extract_youtube_channel(url)
        if channel_entity:
            metadata.author_entities.append(channel_entity)

    elif source_type == "podcast":
        show_entity = extract_podcast_show(url, title)
        if show_entity:
            metadata.author_entities.append(show_entity)

    elif source_type in ("article", "pdf"):
        publication_entity = extract_publication_from_domain(url)
        if publication_entity:
            metadata.context_entities.append(publication_entity)

    # Step 2: Crawl4AI metadata (articles only, optional)
    if use_crawler and source_type == "article":
        try:
            from .crawler.adapter import scrape_article

            result = await scrape_article(url, timeout=30)
            if result.get("success"):
                crawler_metadata = result.get("data", {}).get("metadata", {})

                # Extract author from crawler metadata if available
                # Note: Crawl4AI normalized metadata may include author info
                og_title = crawler_metadata.get("ogTitle", "")
                if og_title and og_title != title:
                    # Sometimes og_title contains "by Author Name"
                    author_match = re.search(r'\bby\s+([^|]+)', og_title, re.IGNORECASE)
                    if author_match:
                        author_name = author_match.group(1).strip()
                        metadata.author_entities.append(EntityInfo(
                            name=author_name,
                            type="person",
                            role="author",
                            confidence=0.7
                        ))
        except Exception as e:
            logger.warning(f"Crawler metadata extraction failed: {e}")

    # Step 3: LLM inference for remaining gaps (optional)
    if use_llm and (not metadata.author_entities or not metadata.inferred_context):
        llm_metadata = await infer_source_metadata_llm(url, title, source_type)

        if llm_metadata:
            # Add author if not already found
            if not metadata.author_entities and llm_metadata.get("author_name"):
                metadata.author_entities.append(EntityInfo(
                    name=llm_metadata["author_name"],
                    type=llm_metadata.get("author_type", "person"),
                    role=llm_metadata.get("author_role", "author"),
                    confidence=0.6
                ))

            # Add publisher if not already found
            if not metadata.context_entities and llm_metadata.get("publisher_name"):
                metadata.context_entities.append(EntityInfo(
                    name=llm_metadata["publisher_name"],
                    type=llm_metadata.get("publisher_type", "organization"),
                    role="publisher",
                    confidence=0.6
                ))

            # Update content type if more specific
            if llm_metadata.get("content_type"):
                metadata.content_type = llm_metadata["content_type"]

            # Add temporal context
            if llm_metadata.get("temporal_context"):
                metadata.temporal_context = llm_metadata["temporal_context"]

            # Add context summary
            if llm_metadata.get("context_summary"):
                metadata.inferred_context = llm_metadata["context_summary"]

    return metadata


def build_source_context_prompt(metadata: SourceMetadata) -> str:
    """
    Build a context prompt section from source metadata for entity extraction.

    Args:
        metadata: SourceMetadata object

    Returns:
        Formatted string to prepend to entity extraction prompt
    """
    if not metadata.author_entities and not metadata.context_entities and not metadata.inferred_context:
        return ""

    sections = []

    # Author/creator info
    if metadata.author_entities:
        authors = [f"{e.name} ({e.role})" for e in metadata.author_entities]
        sections.append(f"Created by: {', '.join(authors)}")

    # Publication/venue info
    if metadata.context_entities:
        contexts = [f"{e.name} ({e.role})" for e in metadata.context_entities]
        sections.append(f"Published on: {', '.join(contexts)}")

    # Content type
    sections.append(f"Content type: {metadata.content_type}")

    # Temporal context
    if metadata.temporal_context:
        sections.append(f"Time context: {metadata.temporal_context}")

    # Summary
    if metadata.inferred_context:
        sections.append(f"Background: {metadata.inferred_context}")

    return "SOURCE CONTEXT:\n" + "\n".join(f"- {s}" for s in sections)
