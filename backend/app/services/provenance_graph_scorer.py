from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Sequence, Set, Tuple

TOKEN_RE = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?")


@dataclass(frozen=True)
class ClaimVerificationResult:
    claim_text: str
    cited_paper_ids: List[str]
    lexical_support_score: float
    numeric_tokens_verified: bool
    is_grounded: bool


class CitationGraphProvenanceEngine:
    """Multi-hop citation Personalized PageRank, Reciprocal Rank Fusion (RRF), and claim provenance verifier."""

    def __init__(self, damping: float = 0.85, rrf_k: int = 60) -> None:
        if not (0.0 < damping < 1.0):
            raise ValueError("damping must be in (0, 1)")
        if rrf_k < 1:
            raise ValueError("rrf_k must be >= 1")
        self.damping = damping
        self.rrf_k = rrf_k

    def compute_citation_pagerank(
        self,
        nodes: Sequence[str],
        citation_edges: Sequence[Tuple[str, str]],
        personalization: Mapping[str, float] | None = None,
        max_iter: int = 100,
        tol: float = 1e-8,
    ) -> Dict[str, float]:
        """
        Computes Personalized PageRank over a citation graph where (u, v) means paper u cites paper v.
        """
        unique_nodes = list(dict.fromkeys(nodes))
        n = len(unique_nodes)
        if n == 0:
            return {}
        node_set = set(unique_nodes)

        out_neighbors: Dict[str, List[str]] = {u: [] for u in unique_nodes}
        for u, v in citation_edges:
            if u in node_set and v in node_set and u != v:
                if v not in out_neighbors[u]:
                    out_neighbors[u].append(v)

        if personalization:
            raw_p = {u: max(0.0, float(personalization.get(u, 0.0))) for u in unique_nodes}
            total_p = sum(raw_p.values())
            if total_p <= 0.0:
                pers = {u: 1.0 / n for u in unique_nodes}
            else:
                pers = {u: val / total_p for u, val in raw_p.items()}
        else:
            pers = {u: 1.0 / n for u in unique_nodes}

        scores = dict(pers)
        for _ in range(max_iter):
            next_scores = {u: (1.0 - self.damping) * pers[u] for u in unique_nodes}
            dangling_mass = sum(scores[u] for u in unique_nodes if not out_neighbors[u])
            for u in unique_nodes:
                next_scores[u] += self.damping * dangling_mass * pers[u]

            for u in unique_nodes:
                targets = out_neighbors[u]
                if targets:
                    share = (self.damping * scores[u]) / len(targets)
                    for v in targets:
                        next_scores[v] += share

            diff = sum(abs(next_scores[u] - scores[u]) for u in unique_nodes)
            scores = next_scores
            if diff < tol:
                break

        return {u: round(scores[u], 8) for u in unique_nodes}

    def reciprocal_rank_fusion(
        self,
        ranked_lists: Sequence[Sequence[str]],
        weights: Sequence[float] | None = None,
    ) -> List[Tuple[str, float]]:
        if not ranked_lists:
            return []
        if weights is not None:
            if len(weights) != len(ranked_lists):
                raise ValueError("weights length must match ranked_lists length")
            if any(w < 0.0 for w in weights):
                raise ValueError("weights must be non-negative")
            norm_weights = list(weights)
        else:
            norm_weights = [1.0] * len(ranked_lists)

        fused: Dict[str, float] = {}
        for r_list, w in zip(ranked_lists, norm_weights):
            seen: Set[str] = set()
            for rank_idx, doc_id in enumerate(r_list, start=1):
                if doc_id in seen:
                    continue
                seen.add(doc_id)
                fused[doc_id] = fused.get(doc_id, 0.0) + w / (self.rrf_k + rank_idx)

        ordered = sorted(fused.items(), key=lambda kv: (-kv[1], kv[0]))
        return [(doc_id, round(score, 6)) for doc_id, score in ordered]

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return TOKEN_RE.findall(text.lower())

    def verify_claim_provenance(
        self,
        claim_text: str,
        cited_paper_ids: Sequence[str],
        corpus_by_id: Mapping[str, str],
        min_support_threshold: float = 0.45,
    ) -> ClaimVerificationResult:
        claim_tokens = [t for t in self._tokenize(claim_text) if len(t) > 2]
        if not claim_tokens or not cited_paper_ids:
            return ClaimVerificationResult(
                claim_text=claim_text,
                cited_paper_ids=list(cited_paper_ids),
                lexical_support_score=0.0,
                numeric_tokens_verified=False,
                is_grounded=False,
            )

        evidence_tokens: Set[str] = set()
        for pid in cited_paper_ids:
            source_text = corpus_by_id.get(pid, "")
            evidence_tokens.update(self._tokenize(source_text))

        matched = sum(1 for t in claim_tokens if t in evidence_tokens)
        support = matched / len(claim_tokens)

        numeric_claims = [t for t in claim_tokens if any(ch.isdigit() for ch in t)]
        numeric_ok = all(t in evidence_tokens for t in numeric_claims) if numeric_claims else True
        grounded = support >= min_support_threshold and numeric_ok

        return ClaimVerificationResult(
            claim_text=claim_text,
            cited_paper_ids=list(cited_paper_ids),
            lexical_support_score=round(support, 4),
            numeric_tokens_verified=numeric_ok,
            is_grounded=grounded,
        )
