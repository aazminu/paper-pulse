import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.provenance_graph_scorer import CitationGraphProvenanceEngine


def test_citation_pagerank_concentrates_on_foundational_paper() -> None:
    engine = CitationGraphProvenanceEngine(damping=0.85, rrf_k=60)
    nodes = ["P_FOUNDATION", "P_EXT_1", "P_EXT_2", "P_RECENT"]
    # P_EXT_1, P_EXT_2, and P_RECENT all cite P_FOUNDATION; P_RECENT also cites P_EXT_1
    edges = [
        ("P_EXT_1", "P_FOUNDATION"),
        ("P_EXT_2", "P_FOUNDATION"),
        ("P_RECENT", "P_FOUNDATION"),
        ("P_RECENT", "P_EXT_1"),
    ]
    pr = engine.compute_citation_pagerank(nodes, edges)
    assert abs(sum(pr.values()) - 1.0) < 1e-5
    assert pr["P_FOUNDATION"] > pr["P_EXT_1"] > pr["P_RECENT"]


def test_reciprocal_rank_fusion_and_weights() -> None:
    engine = CitationGraphProvenanceEngine(rrf_k=60)
    dense_rank = ["DOC_A", "DOC_B", "DOC_C"]
    graph_rank = ["DOC_B", "DOC_A", "DOC_D"]
    fused = engine.reciprocal_rank_fusion([dense_rank, graph_rank], weights=[1.0, 2.0])
    assert fused[0][0] == "DOC_B"
    assert fused[1][0] == "DOC_A"

    with pytest.raises(ValueError):
        engine.reciprocal_rank_fusion([dense_rank], weights=[-1.0])


def test_claim_provenance_verification_detects_hallucinated_numbers() -> None:
    engine = CitationGraphProvenanceEngine()
    corpus = {
        "ARXIV:2601.001": (
            "ChromAlphaGenome achieves 0.964 AUROC on cryptic splice variants "
            "across 1420 curated ClinVar non-coding loci."
        )
    }
    valid_claim = "ChromAlphaGenome achieves 0.964 AUROC on cryptic splice variants across 1420 ClinVar loci."
    res_ok = engine.verify_claim_provenance(valid_claim, ["ARXIV:2601.001"], corpus)
    assert res_ok.is_grounded is True
    assert res_ok.numeric_tokens_verified is True

    hallucinated_claim = "ChromAlphaGenome achieves 0.999 AUROC across 9500 ClinVar loci."
    res_bad = engine.verify_claim_provenance(hallucinated_claim, ["ARXIV:2601.001"], corpus)
    assert res_bad.numeric_tokens_verified is False
    assert res_bad.is_grounded is False

    # Short 1- and 2-digit hallucinated numbers must also be caught (not stripped by token length filter)
    short_num_corpus = {
        "ARXIV:2601.002": "The pipeline reduces latency by 12% across 2 benchmark datasets."
    }
    short_num_hallucinated = "The pipeline reduces latency by 95% across 8 benchmark datasets."
    res_short_bad = engine.verify_claim_provenance(
        short_num_hallucinated, ["ARXIV:2601.002"], short_num_corpus
    )
    assert res_short_bad.numeric_tokens_verified is False
    assert res_short_bad.is_grounded is False


def test_cli_benchmark_markdown_json_and_reproducibility(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    import json
    import subprocess

    repo_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo_root / "scripts"))
    import benchmark as paper_bench

    rows_1 = paper_bench.run_benchmark(seed=42)
    rows_2 = paper_bench.run_benchmark(seed=42)
    rows_3 = paper_bench.run_benchmark(seed=99)
    assert rows_1 == rows_2
    assert rows_1 != rows_3
    assert len(rows_1) == 4

    md = paper_bench.format_markdown_table(rows_1)
    assert "| benchmark | top_item | primary_metric | score |" in md
    assert "citation_personalized_pagerank" in md
    assert "hallucinated_number_rejection" in md

    out_path = tmp_path / "paper_pulse_bench.json"
    rc = paper_bench.main(["--format", "json", "--seed", "42", "--output", str(out_path)])
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["seed"] == 42
    assert data["benchmarks"] == rows_1
    assert json.loads(out_path.read_text(encoding="utf-8")) == data

    err_rc = paper_bench.main(["--format", "markdown", "--output", str(tmp_path)])
    assert err_rc == 1
    assert "Error writing output" in capsys.readouterr().err

    proc = subprocess.run(
        [sys.executable, str(repo_root / "scripts" / "benchmark.py"), "--format", "markdown"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "weighted_reciprocal_rank_fusion" in proc.stdout

    proc_main = subprocess.run(
        [sys.executable, str(repo_root / "__main__.py"), "--format", "json", "--seed", "42"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(proc_main.stdout)["seed"] == 42

    with pytest.raises(SystemExit):
        paper_bench.main(["--format", "invalid_fmt"])



