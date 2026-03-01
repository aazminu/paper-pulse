"""
Entity Extraction Service for PaperPulse Knowledge Graph

Uses o4-mini to extract structured entities from paper abstracts:
  - Concepts (methods, techniques, datasets, tasks, theories)
  - Institution affiliations (parsed from author metadata when available)

Output feeds into Neo4j graph population.
"""

import json
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

EXTRACTION_PROMPT = """You are an expert academic entity extractor. Given a research paper's title and abstract, extract structured entities.

Return a JSON object with these fields:
{
  "concepts": [
    {"name": "concept name", "category": "method|dataset|theory|task|technique"}
  ],
  "affiliations": [
    {"author": "Author Name", "institution": "University/Lab Name"}
  ]
}

Rules:
- Concepts: Extract 3–10 key technical concepts. Each must be specific and meaningful (not generic like "machine learning" unless the paper is specifically about ML foundations).
  - method: specific algorithms or approaches (e.g., "transformer attention", "diffusion sampling")
  - dataset: named datasets (e.g., "ImageNet", "MMLU")
  - theory: theoretical frameworks or mathematical concepts
  - task: specific problems being solved (e.g., "image segmentation", "named entity recognition")
  - technique: implementation techniques (e.g., "knowledge distillation", "gradient checkpointing")
- Affiliations: Only extract if clearly stated or inferable from emails in the abstract. If not present, return empty array.
- Normalize names: use the most common/canonical form.
- Return ONLY valid JSON, no markdown formatting."""


def extract_entities(title: str, abstract: str, authors: list[str] | None = None) -> dict:
    """
    Extract concepts and affiliations from a paper.
    Returns: {"concepts": [...], "affiliations": [...]}
    """
    user_content = f"Title: {title}\n\nAbstract: {abstract}"
    if authors:
        user_content += f"\n\nAuthors: {', '.join(authors)}"

    try:
        response = client.chat.completions.create(
            model="o4-mini",
            reasoning_effort="low",
            messages=[
                {"role": "developer", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": user_content},
            ],
            max_completion_tokens=2048,
        )

        raw = response.choices[0].message.content
        if not raw:
            print(f"  [EntityExtract] Empty response from LLM")
            return {"concepts": [], "affiliations": []}
        raw = raw.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        result = json.loads(raw)

        # Validate structure
        concepts = result.get("concepts", [])
        affiliations = result.get("affiliations", [])

        # Ensure each concept has required fields
        valid_categories = {"method", "dataset", "theory", "task", "technique"}
        validated_concepts = []
        for c in concepts:
            if isinstance(c, dict) and c.get("name"):
                cat = c.get("category", "technique").lower()
                if cat not in valid_categories:
                    cat = "technique"
                validated_concepts.append({
                    "name": c["name"].strip(),
                    "category": cat,
                })

        validated_affiliations = []
        for a in affiliations:
            if isinstance(a, dict) and a.get("author") and a.get("institution"):
                validated_affiliations.append({
                    "author": a["author"].strip(),
                    "institution": a["institution"].strip(),
                })

        return {
            "concepts": validated_concepts,
            "affiliations": validated_affiliations,
        }

    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"  [EntityExtract] JSON parse error: {e}")
        return {"concepts": [], "affiliations": []}
    except Exception as e:
        print(f"  [EntityExtract] Error: {e}")
        return {"concepts": [], "affiliations": []}


def batch_extract_entities(papers: list[dict]) -> dict[str, dict]:
    """
    Extract entities from a list of papers.
    Returns: {arxiv_id: {"concepts": [...], "affiliations": [...]}}
    """
    results = {}
    for paper in papers:
        pid = paper.get("arxiv_id", "")
        if not pid:
            continue

        title = paper.get("title", "")
        abstract = paper.get("abstract", "")
        authors = paper.get("authors", [])

        if not abstract:
            results[pid] = {"concepts": [], "affiliations": []}
            continue

        print(f"  [EntityExtract] Processing {pid}: {title[:60]}…")
        entities = extract_entities(title, abstract, authors)
        results[pid] = entities

        concept_names = [c["name"] for c in entities.get("concepts", [])]
        if concept_names:
            print(f"    Concepts: {', '.join(concept_names[:5])}" +
                  (f" (+{len(concept_names)-5} more)" if len(concept_names) > 5 else ""))

    return results
