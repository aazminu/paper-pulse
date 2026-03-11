"""
Graph API Router - Knowledge Graph queries for PaperPulse

Endpoints:
  GET  /graph/paper/{arxiv_id} - Paper's graph neighborhood
  GET  /graph/paper/{arxiv_id}/related - Related papers via graph traversal
  GET  /graph/paper/{arxiv_id}/citations - Citation network for visualization
  GET  /graph/author/{name} - Co-author network
  GET  /graph/concept/{name} - Papers involving a concept
  GET  /graph/explore - Full graph for explorer view
  GET  /graph/stats - Graph statistics
  GET  /graph/clusters - Auto-detected paper clusters
  POST /graph/synthesize - Synthesize literature review from selected nodes
  GET  /graph/reports - List saved synthesis reports
  POST /graph/reports - Save a synthesis report
  DELETE /graph/reports/{id} - Delete a saved report
  POST /graph/populate - Trigger graph population manually
"""

import json as _json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from neo4j.exceptions import ServiceUnavailable, SessionExpired
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
from app.services.agent_service import run_agent_traversal
from app.database import supabase
from app.auth import get_current_user, require_admin

logger = logging.getLogger("graph")

router = APIRouter(prefix="/graph", tags=["Knowledge Graph"], dependencies=[Depends(get_current_user)])


@router.get("/paper/{arxiv_id}")
def paper_graph(arxiv_id: str):
    """Get a paper's full graph neighborhood (authors, concepts, citations)."""
    try:
        result = get_paper_graph(arxiv_id)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for paper_graph: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    if not result:
        raise HTTPException(status_code=404, detail="Paper not found in graph")
    return result


@router.get("/paper/{arxiv_id}/related")
def related_papers(arxiv_id: str, limit: int = Query(default=10, le=50)):
    """Find papers related via shared concepts, citations, or co-authors."""
    try:
        results = get_related_papers(arxiv_id, limit=limit)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for related_papers: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return {"paper_id": arxiv_id, "related": results}


@router.get("/paper/{arxiv_id}/citations")
def citation_network(arxiv_id: str, depth: int = Query(default=2, le=3)):
    """Get citation network up to N hops for visualization."""
    try:
        result = get_citation_network(arxiv_id, depth=depth)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for citation_network: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return result


@router.get("/author/{name}")
def author_network(name: str, limit: int = Query(default=20, le=50)):
    """Get co-author network for an author."""
    try:
        result = get_author_network(name, limit=limit)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for author_network: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return result


@router.get("/concept/{name}")
def concept_papers_route(name: str, limit: int = Query(default=20, le=50)):
    """Get papers involving a specific concept."""
    try:
        results = get_concept_papers(name, limit=limit)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for concept_papers: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return {"concept": name, "papers": results}


@router.get("/explore")
def graph_explorer():
    """Get full graph data for the interactive explorer."""
    try:
        result = get_full_graph_visualization()
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for graph_explorer: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return result


@router.get("/stats")
def graph_statistics():
    """Get knowledge graph statistics."""
    try:
        stats = get_graph_stats()
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for graph_statistics: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return stats


@router.get("/node/{node_id:path}")
def node_details(node_id: str, node_type: str = Query(...)):
    """Get detailed neighborhood info for a single node."""
    try:
        result = get_node_neighborhood(node_id, node_type)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for node_details: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    if not result:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/search")
def search_nodes(q: str = Query(..., min_length=1), limit: int = Query(default=20, le=50)):
    """Search across papers, authors, and concepts."""
    try:
        results = search_graph_nodes(q, limit=limit)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for search_nodes: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    return {"results": results}


@router.get("/clusters")
def get_clusters():
    """Detect paper clusters based on shared concepts and citations."""
    try:
        clusters = detect_clusters()
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for get_clusters: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
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

    try:
        subgraph = get_subgraph_for_synthesis(req.node_ids)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for synthesize_report: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
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

    try:
        subgraph = get_subgraph_for_synthesis(req.node_ids)
    except (ServiceUnavailable, SessionExpired, OSError) as e:
        logger.warning("Neo4j unavailable for synthesize_publication: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge graph is temporarily unavailable. Please retry in a moment.")
    if not subgraph["papers"]:
        raise HTTPException(status_code=404, detail="No papers found for selected nodes")

    result = synthesize_publication_review(subgraph)
    return result



def _sse(event: str, data) -> str:
    """Format a server-sent event line."""
    payload = _json.dumps(data) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/agent-synthesize")
def agent_synthesize(req: SynthesizeRequest):
    """Stream an agent-driven graph traversal + synthesis via SSE."""
    if not req.node_ids:
        raise HTTPException(status_code=400, detail="No nodes selected")
    if len(req.node_ids) > 30:
        raise HTTPException(status_code=400, detail="Too many nodes (max 30)")

    def generate():
        try:
            for event in run_agent_traversal(req.node_ids):
                yield _sse(event["event"], event["data"])
        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



class SaveReportRequest(BaseModel):
    user_id: str
    title: str
    markdown: str
    node_ids: list[str]
    paper_count: int = 0
    citation_count: int = 0


@router.get("/reports")
def list_reports(user_id: str = Query(...), current_user: dict = Depends(get_current_user)):
    """List saved synthesis reports for a user."""
    if current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
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
def save_report(req: SaveReportRequest, current_user: dict = Depends(get_current_user)):
    """Save a synthesis report."""
    if current_user["id"] != req.user_id:
        raise HTTPException(status_code=403, detail="Access denied")
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
def delete_report(report_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a saved synthesis report."""
    try:
        owner_check = supabase.table("synthesis_reports").select("user_id").eq("id", report_id).execute()
        if not owner_check.data:
            raise HTTPException(status_code=404, detail="Report not found")
        if owner_check.data[0]["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
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


@router.post("/populate", dependencies=[Depends(require_admin)])
def trigger_population(background_tasks: BackgroundTasks, paper_ids: list[str] | None = None):
    """Manually trigger graph population for specific papers or recent papers."""
    if _graph_populate_status["running"]:
        return {"status": "already_running", "message": "Graph population is already in progress"}
    background_tasks.add_task(_run_graph_populate_bg, paper_ids)
    return {"status": "started", "message": "Graph population started in background"}


@router.get("/populate/status", dependencies=[Depends(require_admin)])
def populate_status():
    """Check graph population status."""
    return _graph_populate_status
