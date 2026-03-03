"""
Graph API Router — Knowledge Graph queries for PaperPulse

Endpoints:
  GET  /graph/paper/{arxiv_id}        — Paper's graph neighborhood
  GET  /graph/paper/{arxiv_id}/related — Related papers via graph traversal
  GET  /graph/paper/{arxiv_id}/citations — Citation network for visualization
  GET  /graph/author/{name}            — Co-author network
  GET  /graph/concept/{name}           — Papers involving a concept
  GET  /graph/explore                  — Full graph for explorer view
  GET  /graph/stats                    — Graph statistics
  GET  /graph/clusters                 — Auto-detected paper clusters
  POST /graph/synthesize               — Synthesize literature review from selected nodes
  GET  /graph/reports                  — List saved synthesis reports
  POST /graph/reports                  — Save a synthesis report
  DELETE /graph/reports/{id}           — Delete a saved report
  POST /graph/populate                 — Trigger graph population manually
"""

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from app.services.neo4j_service import (
    get_paper_graph,
    get_related_papers,
    get_citation_network,
    get_author_network,
    get_concept_papers,
    get_full_graph_visualization,
    get_graph_stats,
    get_node_neighborhood,
    search_graph_nodes,
    get_subgraph_for_synthesis,
    detect_clusters,
)
from app.services.openai_service import synthesize_literature_review, synthesize_publication_review
from app.database import supabase

router = APIRouter(prefix="/graph", tags=["Knowledge Graph"])


@router.get("/paper/{arxiv_id}")
def paper_graph(arxiv_id: str):
    """Get a paper's full graph neighborhood (authors, concepts, citations)."""
    result = get_paper_graph(arxiv_id)
    if not result:
        raise HTTPException(status_code=404, detail="Paper not found in graph")
    return result


@router.get("/paper/{arxiv_id}/related")
def related_papers(arxiv_id: str, limit: int = Query(default=10, le=50)):
    """Find papers related via shared concepts, citations, or co-authors."""
    results = get_related_papers(arxiv_id, limit=limit)
    return {"paper_id": arxiv_id, "related": results}


@router.get("/paper/{arxiv_id}/citations")
def citation_network(arxiv_id: str, depth: int = Query(default=2, le=3)):
    """Get citation network up to N hops for visualization."""
    result = get_citation_network(arxiv_id, depth=depth)
    return result


@router.get("/author/{name}")
def author_network(name: str, limit: int = Query(default=20, le=50)):
    """Get co-author network for an author."""
    result = get_author_network(name, limit=limit)
    return result


@router.get("/concept/{name}")
def concept_papers_route(name: str, limit: int = Query(default=20, le=50)):
    """Get papers involving a specific concept."""
    results = get_concept_papers(name, limit=limit)
    return {"concept": name, "papers": results}


@router.get("/explore")
def graph_explorer(limit: int = Query(default=200, le=500)):
    """Get full graph data for the interactive explorer."""
    result = get_full_graph_visualization(limit=limit)
    return result


@router.get("/stats")
def graph_statistics():
    """Get knowledge graph statistics."""
    stats = get_graph_stats()
    return stats


@router.get("/node/{node_id:path}")
def node_details(node_id: str, node_type: str = Query(...)):
    """Get detailed neighborhood info for a single node."""
    result = get_node_neighborhood(node_id, node_type)
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/search")
def search_nodes(q: str = Query(..., min_length=1), limit: int = Query(default=20, le=50)):
    """Search across papers, authors, and concepts."""
    results = search_graph_nodes(q, limit=limit)
    return {"results": results}


@router.get("/clusters")
def get_clusters(limit: int = Query(default=200, le=500)):
    """Detect paper clusters based on shared concepts and citations."""
    clusters = detect_clusters(limit=limit)
    return {"clusters": clusters}


class SynthesizeRequest(BaseModel):
    node_ids: list[str]
    title: str | None = None


@router.post("/synthesize")
def synthesize_report(req: SynthesizeRequest):
    """Generate a literature review + Mermaid diagram from selected graph nodes."""
    if not req.node_ids:
        raise HTTPException(status_code=400, detail="No nodes selected")
    if len(req.node_ids) > 30:
        raise HTTPException(status_code=400, detail="Too many nodes (max 30)")

    subgraph = get_subgraph_for_synthesis(req.node_ids)
    if not subgraph["papers"]:
        raise HTTPException(status_code=404, detail="No papers found for selected nodes")

    markdown = synthesize_literature_review(subgraph)
    return {
        "markdown": markdown,
        "paper_count": len(subgraph["papers"]),
        "citation_count": len(subgraph["citations"]),
    }


@router.post("/synthesize-publication")
def synthesize_publication(req: SynthesizeRequest):
    """Generate a publication-ready multi-section literature review with BibTeX."""
    if not req.node_ids:
        raise HTTPException(status_code=400, detail="No nodes selected")
    if len(req.node_ids) > 30:
        raise HTTPException(status_code=400, detail="Too many nodes (max 30)")

    subgraph = get_subgraph_for_synthesis(req.node_ids)
    if not subgraph["papers"]:
        raise HTTPException(status_code=404, detail="No papers found for selected nodes")

    result = synthesize_publication_review(subgraph)
    return result


# ── Saved Reports ─────────────────────────────────────────────────────────

class SaveReportRequest(BaseModel):
    user_id: str
    title: str
    markdown: str
    node_ids: list[str]
    paper_count: int = 0
    citation_count: int = 0


@router.get("/reports")
def list_reports(user_id: str = Query(...)):
    """List saved synthesis reports for a user."""
    try:
        resp = (
            supabase.table("synthesis_reports")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reports")
def save_report(req: SaveReportRequest):
    """Save a synthesis report."""
    try:
        resp = (
            supabase.table("synthesis_reports")
            .insert({
                "user_id": req.user_id,
                "title": req.title,
                "markdown": req.markdown,
                "node_ids": req.node_ids,
                "paper_count": req.paper_count,
                "citation_count": req.citation_count,
            })
            .execute()
        )
        return resp.data[0] if resp.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/reports/{report_id}")
def delete_report(report_id: str):
    """Delete a saved synthesis report."""
    try:
        supabase.table("synthesis_reports").delete().eq("id", report_id).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_graph_populate_status = {"running": False, "last_result": None}

def _run_graph_populate_bg(paper_ids: list[str] | None = None):
    global _graph_populate_status
    _graph_populate_status["running"] = True
    try:
        from app.services.graph_pipeline_service import run_graph_pipeline
        result = run_graph_pipeline(paper_ids=paper_ids)
        _graph_populate_status["last_result"] = result
    except Exception as e:
        _graph_populate_status["last_result"] = {"status": "error", "message": str(e)}
    finally:
        _graph_populate_status["running"] = False


@router.post("/populate")
def trigger_population(background_tasks: BackgroundTasks, paper_ids: list[str] | None = None):
    """Manually trigger graph population for specific papers or recent papers."""
    if _graph_populate_status["running"]:
        return {"status": "already_running", "message": "Graph population is already in progress"}
    background_tasks.add_task(_run_graph_populate_bg, paper_ids)
    return {"status": "started", "message": "Graph population started in background"}


@router.get("/populate/status")
def populate_status():
    """Check graph population status."""
    return _graph_populate_status
