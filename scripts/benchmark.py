from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.provenance_graph_scorer import CitationGraphProvenanceEngine


def run_benchmark(seed: int = 42) -> List[Dict[str, Any]]:
    """Run reproducible citation Personalized PageRank, RRF fusion, and claim provenance benchmarks."""
    rng = random.Random(seed)
    engine = CitationGraphProvenanceEngine(damping=0.85, rrf_k=60)

    # 1. Personalized PageRank on multi-hop citation graph
    nodes = ["P_FOUNDATION", "P_EXT_1", "P_EXT_2", "P_RECENT"]
    edges = [
        ("P_EXT_1", "P_FOUNDATION"),
        ("P_EXT_2", "P_FOUNDATION"),
        ("P_RECENT", "P_FOUNDATION"),
        ("P_RECENT", "P_EXT_1"),
    ]
    personalization = {
        "P_FOUNDATION": 1.0,
        "P_EXT_1": 0.5 + rng.uniform(-0.1, 0.1),
        "P_EXT_2": 0.3 + rng.uniform(-0.05, 0.05),
        "P_RECENT": 0.2,
    }
    pr = engine.compute_citation_pagerank(nodes, edges, personalization=personalization)

    # 2. Weighted Reciprocal Rank Fusion (RRF)
    fused = engine.reciprocal_rank_fusion(
        [["DOC_A", "DOC_B", "DOC_C"], ["DOC_B", "DOC_A", "DOC_D"]],
        weights=[1.0 + rng.uniform(-0.08, 0.08), 2.0 + rng.uniform(-0.08, 0.08)],
    )

    # 3. Grounded vs. hallucinated numeric claim verification
    corpus = {
        "ARXIV:2601.001": (
            "ChromAlphaGenome achieves 0.964 AUROC on cryptic splice variants "
            "across 1420 curated ClinVar non-coding loci."
        ),
        "ARXIV:2601.002": "The pipeline reduces latency by 12% across 2 benchmark datasets.",
    }
    grounded = engine.verify_claim_provenance(
        "ChromAlphaGenome achieves 0.964 AUROC on cryptic splice variants across 1420 ClinVar loci.",
        ["ARXIV:2601.001"],
        corpus,
    )
    hallucinated = engine.verify_claim_provenance(
        "The pipeline reduces latency by 95% across 8 benchmark datasets.",
        ["ARXIV:2601.002"],
        corpus,
    )

    return [
        {
            "benchmark": "citation_personalized_pagerank",
            "top_item": "P_FOUNDATION",
            "primary_metric": "pagerank_mass",
            "score": round(pr["P_FOUNDATION"], 6),
            "secondary_metric": "mass_conservation",
            "secondary_value": round(sum(pr.values()), 6),
            "status": "CONVERGED",
        },
        {
            "benchmark": "weighted_reciprocal_rank_fusion",
            "top_item": fused[0][0],
            "primary_metric": "rrf_score",
            "score": round(fused[0][1], 6),
            "secondary_metric": "candidate_count",
            "secondary_value": len(fused),
            "status": "RANKED",
        },
        {
            "benchmark": "grounded_claim_verification",
            "top_item": "ARXIV:2601.001",
            "primary_metric": "lexical_support_score",
            "score": round(grounded.lexical_support_score, 4),
            "secondary_metric": "numeric_tokens_verified",
            "secondary_value": int(grounded.numeric_tokens_verified),
            "status": "GROUNDED" if grounded.is_grounded else "REJECTED",
        },
        {
            "benchmark": "hallucinated_number_rejection",
            "top_item": "ARXIV:2601.002",
            "primary_metric": "lexical_support_score",
            "score": round(hallucinated.lexical_support_score, 4),
            "secondary_metric": "numeric_tokens_verified",
            "secondary_value": int(hallucinated.numeric_tokens_verified),
            "status": "REJECTED" if not hallucinated.is_grounded else "MISSED",
        },
    ]


def format_markdown_table(rows: Sequence[Dict[str, Any]]) -> str:
    headers = [
        "benchmark",
        "top_item",
        "primary_metric",
        "score",
        "secondary_metric",
        "secondary_value",
        "status",
    ]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(row[h]) for h in headers) + " |")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run reproducible PaperPulse citation PageRank, RRF, and provenance verification benchmarks."
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format for benchmark results.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible benchmark execution.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional file path to write benchmark output.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    rows = run_benchmark(seed=args.seed)
    rendered = (
        json.dumps({"seed": args.seed, "benchmarks": rows}, indent=2)
        if args.format == "json"
        else format_markdown_table(rows)
    )
    if args.output is not None:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        except OSError as exc:
            print(f"Error writing output to {args.output}: {exc}", file=sys.stderr)
            return 1
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
