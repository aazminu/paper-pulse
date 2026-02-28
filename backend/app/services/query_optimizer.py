"""
LLM Query Optimizer — Transforms raw user interest text into
precision search queries optimized for each academic API.

Uses GPT-5-mini as a classifier/optimizer to:
  1. Extract the exact technical keywords that would appear in paper titles
  2. Generate multiple focused search queries covering different facets
  3. Identify the most specific ArXiv sub-categories (e.g., cs.LG, cs.CL)
  4. Output a structured JSON profile cached per user

This is called once at onboarding (and whenever the user updates their
interests), NOT on every pipeline run.
"""

import json
from typing import Optional
from app.services.openai_service import client


def optimize_user_interests(
    interest_text: str,
    domains: list[str],
) -> dict:
    """
    Takes raw user interest text like:
      "I'm interested in machine learning for drug discovery and protein folding"

    Returns a structured profile:
      {
        "search_queries": [
          "deep learning drug discovery",
          "protein structure prediction neural network",
          "molecular generation diffusion model",
          "AlphaFold protein folding"
        ],
        "keywords": [
          "drug discovery", "protein folding", "molecular docking",
          "GNN", "diffusion models", "AlphaFold"
        ],
        "arxiv_categories": ["cs.LG", "q-bio.BM", "cs.AI"]
      }
    """
    if not interest_text or not interest_text.strip():
        return {
            "search_queries": [],
            "keywords": [],
            "arxiv_categories": [],
        }

    domain_context = ", ".join(domains) if domains else "general science"

    prompt = f"""You are an expert academic research librarian. A researcher has described their interests in casual language. Your job is to transform this into optimized search queries that will find the most relevant papers on ArXiv, Semantic Scholar, PubMed, and OpenAlex.

The researcher's domains: {domain_context}
The researcher's raw interest description: "{interest_text}"

Return a JSON object with exactly these fields:
1. "search_queries": An array of 3-5 focused search query strings. Each should be 3-6 words using the EXACT technical vocabulary that would appear in paper titles and abstracts (not casual language). Cover different facets/sub-topics of their interest. These will be sent directly to academic search APIs.

2. "keywords": An array of 6-10 individual technical terms or short phrases (1-3 words each) that are the core concepts. Include abbreviations, model names, and method names that researchers in this field would use (e.g., "GNN", "BERT", "CRISPR", "Monte Carlo").

3. "arxiv_categories": An array of the most specific ArXiv sub-categories that match (e.g., "cs.LG", "cs.CL", "q-bio.BM", "stat.ML"). Use 2-5 categories. Only include categories that genuinely match — do not pad.

Rules:
- Use the technical vocabulary of the field, NOT the user's casual words
- Search queries should be what a domain expert would type into Google Scholar
- If the user mentions a broad area, break it into the specific active sub-fields
- Prefer precision over recall — narrow queries find better papers
- Return ONLY the JSON object, no markdown, no explanation"""

    try:
        response = client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a research query optimization system. Return only valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=1,
            max_completion_tokens=500,
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        result = json.loads(raw)

        # Validate structure
        return {
            "search_queries": result.get("search_queries", [])[:5],
            "keywords": result.get("keywords", [])[:10],
            "arxiv_categories": result.get("arxiv_categories", [])[:5],
        }

    except json.JSONDecodeError as e:
        print(f"[QueryOptimizer] Failed to parse LLM response: {e}")
        print(f"[QueryOptimizer] Raw response: {raw[:200]}")
        # Fallback: extract simple keywords from interest text
        return _fallback_extract(interest_text)
    except Exception as e:
        print(f"[QueryOptimizer] Error: {e}")
        return _fallback_extract(interest_text)


def _fallback_extract(interest_text: str) -> dict:
    """Simple keyword extraction fallback if the LLM call fails."""
    stop_words = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
        "have", "has", "had", "i", "my", "me", "we", "us", "am", "not",
        "interested", "interest", "like", "want", "research", "study",
        "using", "based", "new", "i'm", "particularly", "especially",
        "including", "related", "focusing", "focused", "about",
    }
    words = [w.strip('.,!?()[]{}"\':;') for w in interest_text.split()]
    keywords = [w for w in words if len(w) > 2 and w.lower() not in stop_words][:10]
    # Build 2 simple queries by grouping keywords
    queries = []
    if len(keywords) >= 4:
        queries.append(" ".join(keywords[:3]))
        queries.append(" ".join(keywords[3:6]))
    elif keywords:
        queries.append(" ".join(keywords))

    return {
        "search_queries": queries,
        "keywords": keywords,
        "arxiv_categories": [],
    }
