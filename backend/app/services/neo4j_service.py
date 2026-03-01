"""
Neo4j Knowledge Graph Service for PaperPulse

Graph Schema:
  Nodes:
    (:Paper  {arxiv_id, title, published_date, source, url})
    (:Author {name, name_lower})
    (:Concept {name, name_lower, category})       # method / dataset / theory / task / technique
    (:Institution {name, name_lower})

  Relationships:
    (:Paper)-[:CITES]->(:Paper)
    (:Author)-[:AUTHORED]->(:Paper)
    (:Author)-[:AFFILIATED_WITH]->(:Institution)
    (:Paper)-[:INVOLVES_CONCEPT]->(:Concept)
"""

import os
from contextlib import contextmanager
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "paperpulse2024")

# ---------------------------------------------------------------------------
# Driver singleton
# ---------------------------------------------------------------------------
_driver = None


def get_driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return _driver


def close_driver():
    global _driver
    if _driver:
        _driver.close()
        _driver = None


@contextmanager
def get_session():
    driver = get_driver()
    session = driver.session()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Schema initialisation (constraints + indexes) — idempotent
# ---------------------------------------------------------------------------
def init_schema():
    """Create uniqueness constraints & indexes (safe to call repeatedly)."""
    with get_session() as s:
        # Uniqueness constraints
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (p:Paper) REQUIRE p.arxiv_id IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (a:Author) REQUIRE a.name_lower IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (c:Concept) REQUIRE c.name_lower IS UNIQUE")
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (i:Institution) REQUIRE i.name_lower IS UNIQUE")
        # Full-text indexes for fuzzy search
        try:
            s.run(
                "CREATE FULLTEXT INDEX paper_title_ft IF NOT EXISTS "
                "FOR (p:Paper) ON EACH [p.title]"
            )
            s.run(
                "CREATE FULLTEXT INDEX concept_name_ft IF NOT EXISTS "
                "FOR (c:Concept) ON EACH [c.name]"
            )
        except Exception:
            pass  # older Neo4j versions may not support IF NOT EXISTS for FT
    print("[Neo4j] Schema initialised")


# ---------------------------------------------------------------------------
# Paper CRUD
# ---------------------------------------------------------------------------
def upsert_paper(paper: dict):
    """Merge a Paper node. Returns the node."""
    with get_session() as s:
        result = s.run(
            """
            MERGE (p:Paper {arxiv_id: $arxiv_id})
            SET p.title          = $title,
                p.published_date = $published_date,
                p.source         = $source,
                p.url            = $url
            RETURN p
            """,
            arxiv_id=paper["arxiv_id"],
            title=paper.get("title", ""),
            published_date=str(paper.get("published_date", "")),
            source=paper.get("source", "unknown"),
            url=paper.get("url", ""),
        )
        return result.single()


def upsert_papers_batch(papers: list[dict]):
    """Batch-merge Paper nodes."""
    with get_session() as s:
        s.run(
            """
            UNWIND $papers AS p
            MERGE (paper:Paper {arxiv_id: p.arxiv_id})
            SET paper.title          = p.title,
                paper.published_date = p.published_date,
                paper.source         = p.source,
                paper.url            = p.url
            """,
            papers=[
                {
                    "arxiv_id": p["arxiv_id"],
                    "title": p.get("title", ""),
                    "published_date": str(p.get("published_date", "")),
                    "source": p.get("source", "unknown"),
                    "url": p.get("url", ""),
                }
                for p in papers
            ],
        )


# ---------------------------------------------------------------------------
# Author + Authorship
# ---------------------------------------------------------------------------
def upsert_authors_for_paper(arxiv_id: str, authors: list[str]):
    """Merge Author nodes and create AUTHORED relationships."""
    with get_session() as s:
        s.run(
            """
            MATCH (p:Paper {arxiv_id: $arxiv_id})
            UNWIND $authors AS authorName
            MERGE (a:Author {name_lower: toLower(trim(authorName))})
            SET a.name = trim(authorName)
            MERGE (a)-[:AUTHORED]->(p)
            """,
            arxiv_id=arxiv_id,
            authors=authors,
        )


# ---------------------------------------------------------------------------
# Concepts (entities extracted by LLM)
# ---------------------------------------------------------------------------
def upsert_concepts_for_paper(arxiv_id: str, concepts: list[dict]):
    """
    Merge Concept nodes and link to a Paper.
    Each concept: {"name": "...", "category": "method|dataset|theory|task|technique"}
    """
    with get_session() as s:
        s.run(
            """
            MATCH (p:Paper {arxiv_id: $arxiv_id})
            UNWIND $concepts AS c
            MERGE (concept:Concept {name_lower: toLower(trim(c.name))})
            SET concept.name     = trim(c.name),
                concept.category = c.category
            MERGE (p)-[:INVOLVES_CONCEPT]->(concept)
            """,
            arxiv_id=arxiv_id,
            concepts=concepts,
        )


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------
def upsert_institution_for_author(author_name: str, institution: str):
    """Merge Institution node and AFFILIATED_WITH relationship."""
    with get_session() as s:
        s.run(
            """
            MERGE (a:Author {name_lower: toLower(trim($author_name))})
            SET a.name = trim($author_name)
            MERGE (i:Institution {name_lower: toLower(trim($institution))})
            SET i.name = trim($institution)
            MERGE (a)-[:AFFILIATED_WITH]->(i)
            """,
            author_name=author_name,
            institution=institution,
        )


def upsert_institutions_batch(affiliations: list[dict]):
    """
    Batch merge institutions.
    Each item: {"author": "...", "institution": "..."}
    """
    with get_session() as s:
        s.run(
            """
            UNWIND $affiliations AS aff
            MERGE (a:Author {name_lower: toLower(trim(aff.author))})
            SET a.name = trim(aff.author)
            MERGE (i:Institution {name_lower: toLower(trim(aff.institution))})
            SET i.name = trim(aff.institution)
            MERGE (a)-[:AFFILIATED_WITH]->(i)
            """,
            affiliations=affiliations,
        )


# ---------------------------------------------------------------------------
# Citations
# ---------------------------------------------------------------------------
def add_citations(citing_arxiv_id: str, cited_arxiv_ids: list[str]):
    """Create CITES relationships between Paper nodes."""
    with get_session() as s:
        s.run(
            """
            MATCH (citing:Paper {arxiv_id: $citing_id})
            UNWIND $cited_ids AS cited_id
            MERGE (cited:Paper {arxiv_id: cited_id})
            MERGE (citing)-[:CITES]->(cited)
            """,
            citing_id=citing_arxiv_id,
            cited_ids=cited_arxiv_ids,
        )


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def get_paper_graph(arxiv_id: str) -> dict:
    """
    Retrieve a paper's full graph neighborhood:
    - authors, concepts, citations (both directions), institutions
    """
    with get_session() as s:
        result = s.run(
            """
            MATCH (p:Paper {arxiv_id: $arxiv_id})
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
            OPTIONAL MATCH (p)-[:INVOLVES_CONCEPT]->(c:Concept)
            OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
            OPTIONAL MATCH (citedBy:Paper)-[:CITES]->(p)
            OPTIONAL MATCH (a)-[:AFFILIATED_WITH]->(i:Institution)
            RETURN p,
                   collect(DISTINCT {name: a.name, institution: i.name}) AS authors,
                   collect(DISTINCT {name: c.name, category: c.category}) AS concepts,
                   collect(DISTINCT cited.arxiv_id) AS cites,
                   collect(DISTINCT citedBy.arxiv_id) AS cited_by
            """,
            arxiv_id=arxiv_id,
        )
        record = result.single()
        if not record:
            return {}

        paper_node = record["p"]
        return {
            "arxiv_id": paper_node["arxiv_id"],
            "title": paper_node.get("title", ""),
            "published_date": paper_node.get("published_date", ""),
            "source": paper_node.get("source", ""),
            "url": paper_node.get("url", ""),
            "authors": [a for a in record["authors"] if a["name"]],
            "concepts": [c for c in record["concepts"] if c["name"]],
            "cites": [c for c in record["cites"] if c],
            "cited_by": [c for c in record["cited_by"] if c],
        }


def get_related_papers(arxiv_id: str, limit: int = 10) -> list[dict]:
    """
    Find papers related to a given paper via shared concepts, citations,
    or shared authors (multi-hop). Returns scored & deduplicated list.
    """
    with get_session() as s:
        result = s.run(
            """
            MATCH (source:Paper {arxiv_id: $arxiv_id})

            // Shared concepts (strongest signal)
            OPTIONAL MATCH (source)-[:INVOLVES_CONCEPT]->(c:Concept)<-[:INVOLVES_CONCEPT]-(related1:Paper)
            WHERE related1.arxiv_id <> $arxiv_id

            // Citation neighbors
            OPTIONAL MATCH (source)-[:CITES]->(cited:Paper)<-[:CITES]-(related2:Paper)
            WHERE related2.arxiv_id <> $arxiv_id
            OPTIONAL MATCH (source)<-[:CITES]-(citedBy:Paper)-[:CITES]->(related3:Paper)
            WHERE related3.arxiv_id <> $arxiv_id

            // Shared authors
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(source)
            OPTIONAL MATCH (a)-[:AUTHORED]->(related4:Paper)
            WHERE related4.arxiv_id <> $arxiv_id

            WITH source,
                 collect(DISTINCT related1) AS conceptRelated,
                 collect(DISTINCT related2) AS citeFwd,
                 collect(DISTINCT related3) AS citeBack,
                 collect(DISTINCT related4) AS authorRelated

            // Combine all with scores
            UNWIND (
                [r IN conceptRelated | {paper: r, score: 3}] +
                [r IN citeFwd        | {paper: r, score: 2}] +
                [r IN citeBack       | {paper: r, score: 2}] +
                [r IN authorRelated  | {paper: r, score: 1}]
            ) AS candidate
            WITH candidate.paper AS p, sum(candidate.score) AS relevance
            WHERE p IS NOT NULL
            RETURN p.arxiv_id AS arxiv_id,
                   p.title AS title,
                   p.published_date AS published_date,
                   p.source AS source,
                   p.url AS url,
                   relevance
            ORDER BY relevance DESC
            LIMIT $limit
            """,
            arxiv_id=arxiv_id,
            limit=limit,
        )
        return [dict(record) for record in result]


def get_citation_network(arxiv_id: str, depth: int = 2) -> dict:
    """
    Return citation network up to `depth` hops from a paper.
    Returns nodes + edges for graph visualization.
    """
    with get_session() as s:
        result = s.run(
            """
            MATCH path = (start:Paper {arxiv_id: $arxiv_id})-[:CITES*1.."""
            + str(min(depth, 3))
            + """]->(cited:Paper)
            WITH nodes(path) AS ns, relationships(path) AS rs
            UNWIND ns AS n
            WITH collect(DISTINCT {id: n.arxiv_id, title: n.title, source: n.source}) AS nodes,
                 rs
            UNWIND rs AS r
            WITH nodes,
                 collect(DISTINCT {source: startNode(r).arxiv_id, target: endNode(r).arxiv_id}) AS edges
            RETURN nodes, edges
            """,
            arxiv_id=arxiv_id,
        )
        record = result.single()
        if not record:
            return {"nodes": [], "edges": []}
        return {"nodes": record["nodes"], "edges": record["edges"]}


def get_author_network(author_name: str, limit: int = 20) -> dict:
    """
    Return co-author network for an author.
    Nodes = authors, edges = co-authored papers.
    """
    with get_session() as s:
        result = s.run(
            """
            MATCH (a:Author {name_lower: toLower(trim($author_name))})-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(coauthor:Author)
            WITH a, coauthor, collect(p.title) AS shared_papers, count(p) AS paper_count
            ORDER BY paper_count DESC
            LIMIT $limit
            RETURN a.name AS author,
                   collect({
                       name: coauthor.name,
                       shared_papers: shared_papers,
                       paper_count: paper_count
                   }) AS coauthors
            """,
            author_name=author_name,
            limit=limit,
        )
        record = result.single()
        if not record:
            return {"author": author_name, "coauthors": []}
        return dict(record)


def get_concept_papers(concept_name: str, limit: int = 20) -> list[dict]:
    """Return papers that involve a given concept."""
    with get_session() as s:
        result = s.run(
            """
            MATCH (c:Concept {name_lower: toLower(trim($concept_name))})<-[:INVOLVES_CONCEPT]-(p:Paper)
            RETURN p.arxiv_id AS arxiv_id,
                   p.title AS title,
                   p.published_date AS published_date,
                   p.source AS source,
                   p.url AS url
            ORDER BY p.published_date DESC
            LIMIT $limit
            """,
            concept_name=concept_name,
            limit=limit,
        )
        return [dict(record) for record in result]


def get_graph_context_for_query(paper_ids: list[str]) -> str:
    """
    Given a list of paper IDs (from vector search), enrich with graph context.
    Returns a text summary of graph relationships for the RAG prompt.
    """
    if not paper_ids:
        return ""

    with get_session() as s:
        result = s.run(
            """
            UNWIND $paper_ids AS pid
            MATCH (p:Paper {arxiv_id: pid})

            // Concepts
            OPTIONAL MATCH (p)-[:INVOLVES_CONCEPT]->(c:Concept)
            WITH p, collect(DISTINCT c.name) AS concepts

            // Citations
            OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
            WITH p, concepts, collect(DISTINCT cited.title) AS cites_titles

            // Cited by
            OPTIONAL MATCH (citedBy:Paper)-[:CITES]->(p)
            WITH p, concepts, cites_titles, collect(DISTINCT citedBy.title) AS cited_by_titles

            // Authors
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
            OPTIONAL MATCH (a)-[:AFFILIATED_WITH]->(i:Institution)
            WITH p, concepts, cites_titles, cited_by_titles,
                 collect(DISTINCT {name: a.name, inst: i.name}) AS author_info

            RETURN p.arxiv_id AS arxiv_id,
                   p.title AS title,
                   concepts,
                   cites_titles[0..5] AS cites,
                   cited_by_titles[0..5] AS cited_by,
                   author_info
            """,
            paper_ids=paper_ids,
        )

        lines = ["=== Knowledge Graph Context ==="]
        for record in result:
            lines.append(f"\n📄 {record['title']} ({record['arxiv_id']})")
            if record["concepts"]:
                lines.append(f"  Concepts: {', '.join(record['concepts'])}")
            if record["author_info"]:
                authors_str = "; ".join(
                    f"{a['name']}" + (f" ({a['inst']})" if a["inst"] else "")
                    for a in record["author_info"]
                    if a["name"]
                )
                if authors_str:
                    lines.append(f"  Authors: {authors_str}")
            if record["cites"]:
                lines.append(f"  References: {'; '.join(record['cites'])}")
            if record["cited_by"]:
                lines.append(f"  Cited by: {'; '.join(record['cited_by'])}")

        return "\n".join(lines) if len(lines) > 1 else ""


def get_full_graph_visualization(limit: int = 200) -> dict:
    """
    Return a subgraph for the full graph explorer.
    Returns papers, authors, concepts, and their relationships.
    """
    with get_session() as s:
        # Get paper-concept relationships
        result = s.run(
            """
            MATCH (p:Paper)
            WITH p ORDER BY p.published_date DESC LIMIT $limit
            OPTIONAL MATCH (a:Author)-[:AUTHORED]->(p)
            OPTIONAL MATCH (p)-[:INVOLVES_CONCEPT]->(c:Concept)
            OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
            RETURN p.arxiv_id AS paper_id,
                   p.title AS paper_title,
                   p.source AS paper_source,
                   collect(DISTINCT a.name) AS authors,
                   collect(DISTINCT {name: c.name, category: c.category}) AS concepts,
                   collect(DISTINCT cited.arxiv_id) AS cites
            """,
            limit=limit,
        )

        nodes = []
        edges = []
        seen_nodes = set()

        for record in result:
            pid = record["paper_id"]
            if pid and pid not in seen_nodes:
                nodes.append({
                    "id": pid,
                    "label": record["paper_title"] or pid,
                    "type": "paper",
                    "source": record["paper_source"],
                })
                seen_nodes.add(pid)

            # Author nodes + edges
            for author in record["authors"]:
                if author:
                    author_id = f"author:{author.lower()}"
                    if author_id not in seen_nodes:
                        nodes.append({
                            "id": author_id,
                            "label": author,
                            "type": "author",
                        })
                        seen_nodes.add(author_id)
                    edges.append({
                        "source": author_id,
                        "target": pid,
                        "type": "authored",
                    })

            # Concept nodes + edges
            for concept in record["concepts"]:
                if concept["name"]:
                    concept_id = f"concept:{concept['name'].lower()}"
                    if concept_id not in seen_nodes:
                        nodes.append({
                            "id": concept_id,
                            "label": concept["name"],
                            "type": "concept",
                            "category": concept.get("category"),
                        })
                        seen_nodes.add(concept_id)
                    edges.append({
                        "source": pid,
                        "target": concept_id,
                        "type": "involves",
                    })

            # Citation edges
            for cited_id in record["cites"]:
                if cited_id:
                    edges.append({
                        "source": pid,
                        "target": cited_id,
                        "type": "cites",
                    })

        return {"nodes": nodes, "edges": edges}


def get_graph_stats() -> dict:
    """Return basic graph statistics."""
    with get_session() as s:
        result = s.run(
            """
            MATCH (p:Paper) WITH count(p) AS papers
            MATCH (a:Author) WITH papers, count(a) AS authors
            MATCH (c:Concept) WITH papers, authors, count(c) AS concepts
            MATCH (i:Institution) WITH papers, authors, concepts, count(i) AS institutions
            OPTIONAL MATCH ()-[cites:CITES]->() WITH papers, authors, concepts, institutions, count(cites) AS citations
            OPTIONAL MATCH ()-[auth:AUTHORED]->() WITH papers, authors, concepts, institutions, citations, count(auth) AS authorships
            RETURN papers, authors, concepts, institutions, citations, authorships
            """
        )
        record = result.single()
        if not record:
            return {}
        return dict(record)
