"""
LangGraph-style Agent Traversal Service for PaperPulse

Implements an iterative graph-exploration agent using GPT-4.1 function-calling.
The agent starts from seed papers, strategically traverses the Neo4j knowledge
graph via tool calls, records findings, and produces a comprehensive synthesis.

Each step is yielded as an SSE-friendly dict so the endpoint can stream
real-time progress to the frontend.
"""

import json
from typing import Generator

from app.services.openai_service import client, QA_MODEL
from app.services.neo4j_service import (
    get_node_neighborhood,
    get_related_papers,
    get_concept_papers,
    get_citation_neighbors,
    get_shared_concepts,
    get_subgraph_for_synthesis,
)

MAX_AGENT_STEPS = 15

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_paper_details",
            "description": (
                "Get full details about a paper including its authors, key concepts, "
                "citation relationships (papers it cites and papers that cite it). "
                "Use this to deeply examine a single paper."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arxiv_id": {
                        "type": "string",
                        "description": "The arXiv ID of the paper",
                    }
                },
                "required": ["arxiv_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_related_papers",
            "description": (
                "Find papers related to a given paper through shared concepts, "
                "citations, or shared authors. Returns a relevance-scored list. "
                "Use this to discover new papers worth investigating."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arxiv_id": {
                        "type": "string",
                        "description": "The arXiv ID of the paper to find related papers for",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of related papers to return (default 5)",
                        "default": 5,
                    },
                },
                "required": ["arxiv_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explore_concept",
            "description": (
                "Find papers that involve a specific research concept or topic. "
                "Use this to understand how a concept is covered across the literature "
                "and to discover papers in a thematic cluster."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "concept_name": {
                        "type": "string",
                        "description": "The concept name to explore",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of papers to return (default 5)",
                        "default": 5,
                    },
                },
                "required": ["concept_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_citations",
            "description": (
                "Get papers that a paper cites or that cite it. "
                "Use this to trace research lineage, influence chains, and "
                "identify foundational or derivative works."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arxiv_id": {
                        "type": "string",
                        "description": "The arXiv ID of the paper",
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["cites", "cited_by", "both"],
                        "description": "Direction of citations to explore",
                        "default": "both",
                    },
                },
                "required": ["arxiv_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_common_concepts",
            "description": (
                "Find concepts shared between two papers. Use this to understand "
                "thematic overlap and how specific papers are connected."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arxiv_id_1": {
                        "type": "string",
                        "description": "arXiv ID of the first paper",
                    },
                    "arxiv_id_2": {
                        "type": "string",
                        "description": "arXiv ID of the second paper",
                    },
                },
                "required": ["arxiv_id_1", "arxiv_id_2"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_finding",
            "description": (
                "Record an important finding, pattern, or insight discovered "
                "during graph traversal. Call this whenever you identify something "
                "noteworthy - a research theme, gap, methodological pattern, "
                "emerging trend, surprising connection, or contradiction."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": [
                            "theme",
                            "gap",
                            "method",
                            "trend",
                            "connection",
                            "contradiction",
                        ],
                        "description": "The type of finding",
                    },
                    "description": {
                        "type": "string",
                        "description": "A detailed description of the finding",
                    },
                    "papers_involved": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "arXiv IDs of papers relevant to this finding (optional)",
                    },
                },
                "required": ["category", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish_exploration",
            "description": (
                "Signal that you have gathered enough information and are ready "
                "to write the final synthesis. Call this when your exploration is "
                "complete. Summarise what you explored and the key threads found."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Brief summary of what was explored and key findings",
                    },
                },
                "required": ["summary"],
            },
        },
    },
]

_AGENT_SYSTEM_PROMPT = """\
You are a research agent systematically exploring an academic knowledge graph.
Your goal is to traverse the graph starting from seed papers, discover
connections, patterns, and research themes, and then synthesize your findings
into a comprehensive literature review.

EXPLORATION STRATEGY:
1. Start by examining each seed paper's details (authors, concepts, citations).
2. Follow the most interesting citation chains and concept connections.
3. Look for shared concepts between papers to identify themes.
4. Record important findings (themes, gaps, methods, trends, connections,
   contradictions) as you discover them using record_finding.
5. When you have explored enough (aim for 8-12 tool calls), call
   finish_exploration with a summary.

GUIDELINES:
- Be strategic: focus on the most promising research threads rather than
  exploring every path. Quality over breadth.
- Record findings frequently - at least 3-4 findings before finishing.
- Follow 2-3 research threads deeply rather than skimming everything.
- When you find a shared concept, investigate which papers involve it.
- When you find a citation chain, trace it to understand influence.
- Note methodological patterns, thematic clusters, and research gaps.
- You have a maximum of {max_steps} tool calls - plan accordingly.
"""

_SYNTHESIS_FROM_EXPLORATION_PROMPT = """\
You just finished exploring an academic knowledge graph. Based on the papers
you examined and the findings you recorded, write a comprehensive literature
review.

EXPLORATION LOG:
{exploration_log}

RECORDED FINDINGS:
{findings}

PAPERS EXAMINED:
{papers_examined}

Write the review with these sections:

# <Descriptive Title for the Review>

## Overview
A 2-3 paragraph overview of the exploration scope, the research landscape
discovered, and the key themes that emerged.

## Research Themes
Discuss the main research themes discovered during traversal. For each theme,
describe which papers contribute and how they relate.

## Methodological Landscape
Compare and contrast the methodologies and approaches found across papers.

## Research Connections
Describe how the papers connect - citation chains, shared concepts,
collaborating authors. Include a Mermaid diagram showing key connections:

```mermaid
flowchart TD
    A["Paper A"] -->|"relationship"| B["Paper B"]
```

## Gaps & Future Directions
Highlight research gaps, contradictions, and promising future directions
identified during exploration.

## Conclusion
A concise synthesis tying everything together with implications for the field.

RULES:
- Use **bold** for key terms on first use
- Reference specific papers by their titles
- Use flowing academic prose, not bullet lists in main sections
- Target 1200-1800 words
- Use Mermaid diagrams where helpful (short node labels, max 40 chars)
- Mermaid node IDs must be single letters (A, B, C...)
"""


def _execute_tool(name: str, arguments: dict) -> str:
    """Execute a graph-query tool and return the result as a JSON string."""
    try:
        if name == "get_paper_details":
            result = get_node_neighborhood(arguments["arxiv_id"], "paper")
            if not result:
                return json.dumps({"error": "Paper not found in graph"})
            return json.dumps(result, default=str)

        elif name == "find_related_papers":
            limit = arguments.get("limit", 5)
            results = get_related_papers(arguments["arxiv_id"], limit=limit)
            return json.dumps(results[:limit], default=str)

        elif name == "explore_concept":
            limit = arguments.get("limit", 5)
            results = get_concept_papers(arguments["concept_name"], limit=limit)
            return json.dumps(results[:limit], default=str)

        elif name == "get_citations":
            direction = arguments.get("direction", "both")
            results = get_citation_neighbors(
                arguments["arxiv_id"], direction=direction
            )
            return json.dumps(results, default=str)

        elif name == "find_common_concepts":
            results = get_shared_concepts(
                arguments["arxiv_id_1"], arguments["arxiv_id_2"]
            )
            return json.dumps(results, default=str)

        elif name == "record_finding":
            return json.dumps({"status": "recorded", "category": arguments["category"]})

        elif name == "finish_exploration":
            return json.dumps({"status": "finished"})

        else:
            return json.dumps({"error": f"Unknown tool: {name}"})

    except Exception as e:
        return json.dumps({"error": str(e)})


_TOOL_DESCRIPTIONS = {
    "get_paper_details": "Examining paper details",
    "find_related_papers": "Discovering related papers",
    "explore_concept": "Exploring concept",
    "get_citations": "Tracing citation chain",
    "find_common_concepts": "Finding shared concepts",
    "record_finding": "Recording finding",
    "finish_exploration": "Finishing exploration",
}


def _describe_tool_call(name: str, arguments: dict) -> str:
    """Generate a human-readable description of a tool call."""
    base = _TOOL_DESCRIPTIONS.get(name, name)
    if name == "get_paper_details":
        return f"{base}: {arguments.get('arxiv_id', '')}"
    elif name == "find_related_papers":
        return f"{base} for {arguments.get('arxiv_id', '')}"
    elif name == "explore_concept":
        return f"{base}: {arguments.get('concept_name', '')}"
    elif name == "get_citations":
        direction = arguments.get("direction", "both")
        return f"{base} ({direction}) for {arguments.get('arxiv_id', '')}"
    elif name == "find_common_concepts":
        return f"{base} between {arguments.get('arxiv_id_1', '')} and {arguments.get('arxiv_id_2', '')}"
    elif name == "record_finding":
        return f"{base}: [{arguments.get('category', '')}] {arguments.get('description', '')[:80]}"
    elif name == "finish_exploration":
        return f"{base}"
    return base


def run_agent_traversal(
    node_ids: list[str],
) -> Generator[dict, None, None]:
    """
    Run the graph-exploration agent.

    Yields dicts with the structure:
      {"event": "step",      "data": {"step": int, "action": str, "detail": str}}
      {"event": "finding",   "data": {"category": str, "description": str, ...}}
      {"event": "thought",   "data": {"content": str}}
      {"event": "token",     "data": {"t": str}}
      {"event": "done",      "data": {"markdown": str}}
      {"event": "error",     "data": {"message": str}}
    """
    yield {"event": "step", "data": {
        "step": 0, "action": "Initializing",
        "detail": f"Loading {len(node_ids)} seed nodes from graph...",
    }}

    subgraph = get_subgraph_for_synthesis(node_ids)
    seed_papers = subgraph.get("papers", [])
    if not seed_papers:
        yield {"event": "error", "data": {"message": "No papers found for selected nodes."}}
        return

    seed_descriptions = []
    for p in seed_papers:
        desc = f"- {p['title']} (ID: {p['arxiv_id']})"
        if p.get("authors"):
            desc += f"  Authors: {', '.join(p['authors'][:5])}"
        if p.get("concepts"):
            concept_names = [c["name"] for c in p["concepts"] if c.get("name")]
            if concept_names:
                desc += f"  Concepts: {', '.join(concept_names[:6])}"
        seed_descriptions.append(desc)

    system_prompt = _AGENT_SYSTEM_PROMPT.format(max_steps=MAX_AGENT_STEPS)
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Here are the {len(seed_papers)} seed papers to start your "
                f"exploration from:\n\n"
                + "\n".join(seed_descriptions)
                + "\n\nBegin your systematic exploration of the knowledge graph. "
                "Examine each seed paper, follow promising connections, and "
                "record findings as you discover them."
            ),
        },
    ]

    findings: list[dict] = []
    exploration_log: list[str] = []
    papers_examined: set[str] = set()
    step_count = 0
    finished = False

    while step_count < MAX_AGENT_STEPS and not finished:
        try:
            response = client.chat.completions.create(
                model=QA_MODEL,
                messages=messages,
                tools=AGENT_TOOLS,
                temperature=0.2,
                max_tokens=1024,
            )
        except Exception as e:
            yield {"event": "error", "data": {"message": f"LLM error: {e}"}}
            return

        choice = response.choices[0]

        if choice.message.content:
            yield {"event": "thought", "data": {"content": choice.message.content}}
            exploration_log.append(f"[Thought] {choice.message.content}")

        if choice.message.tool_calls:
            messages.append(choice.message)

            for tool_call in choice.message.tool_calls:
                step_count += 1
                fn_name = tool_call.function.name
                try:
                    fn_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    fn_args = {}

                description = _describe_tool_call(fn_name, fn_args)
                yield {"event": "step", "data": {
                    "step": step_count,
                    "action": fn_name,
                    "detail": description,
                }}
                exploration_log.append(f"[Step {step_count}] {description}")

                if fn_name == "get_paper_details":
                    papers_examined.add(fn_args.get("arxiv_id", ""))
                elif fn_name == "find_related_papers":
                    papers_examined.add(fn_args.get("arxiv_id", ""))

                if fn_name == "record_finding":
                    finding = {
                        "category": fn_args.get("category", "theme"),
                        "description": fn_args.get("description", ""),
                        "papers": fn_args.get("papers_involved", []),
                    }
                    findings.append(finding)
                    yield {"event": "finding", "data": finding}

                if fn_name == "finish_exploration":
                    finished = True

                tool_result = _execute_tool(fn_name, fn_args)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result,
                })

        elif choice.finish_reason == "stop":
            finished = True

    yield {"event": "step", "data": {
        "step": step_count + 1,
        "action": "Synthesizing",
        "detail": f"Writing synthesis from {len(findings)} findings across {len(papers_examined)} papers...",
    }}

    findings_text = ""
    for i, f in enumerate(findings):
        findings_text += f"\n{i+1}. [{f['category'].upper()}] {f['description']}"
        if f.get("papers"):
            findings_text += f"\n   Papers: {', '.join(f['papers'])}"

    all_paper_ids = list(papers_examined | {p["arxiv_id"] for p in seed_papers})
    papers_info = get_subgraph_for_synthesis(all_paper_ids)
    papers_text = ""
    for p in papers_info.get("papers", []):
        concepts = ", ".join(c["name"] for c in p.get("concepts", []) if c.get("name"))
        papers_text += f"\n- {p['title']} ({p['arxiv_id']})"
        if concepts:
            papers_text += f"  Concepts: {concepts}"

    synthesis_prompt = _SYNTHESIS_FROM_EXPLORATION_PROMPT.format(
        exploration_log="\n".join(exploration_log),
        findings=findings_text or "No specific findings recorded.",
        papers_examined=papers_text,
    )

    try:
        synth_response = client.chat.completions.create(
            model=QA_MODEL,
            messages=[
                {"role": "system", "content": synthesis_prompt},
                {
                    "role": "user",
                    "content": (
                        "Based on your exploration above, write the comprehensive "
                        "literature review now. Follow the format specified."
                    ),
                },
            ],
            temperature=0.3,
            max_tokens=6144,
            stream=True,
        )

        full_text = ""
        for chunk in synth_response:
            delta = chunk.choices[0].delta
            if delta.content:
                full_text += delta.content
                yield {"event": "token", "data": {"t": delta.content}}

        yield {"event": "done", "data": {
            "markdown": full_text,
            "findings": findings,
            "steps": step_count,
            "papers_examined": len(papers_examined | {p["arxiv_id"] for p in seed_papers}),
        }}

    except Exception as e:
        yield {"event": "error", "data": {"message": f"Synthesis error: {e}"}}
