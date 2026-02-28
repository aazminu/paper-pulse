import os
import tiktoken
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API key. Check your .env file.")

# Initialize the synchronous OpenAI client
client = OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# Model Configuration — research-optimised stack
# ---------------------------------------------------------------------------
# EMBEDDINGS:  text-embedding-3-large @ 1536-dim
#   Highest-fidelity OpenAI embedding model.  1536 dims for pgvector compat.
#
# Q&A (ASK):   gpt-4.1
#   OpenAI's best GPT-class model for instruction following and long context.
#   1M token context window, very high rate limits (no TPM issues), and
#   superb at following formatting/math instructions precisely.
#
# SUMMARIES:   o4-mini  (reasoning_effort="low")
#   Cost-efficient reasoning model for faithful 3-sentence summaries.
#
# RERANKER:    Cohere rerank-v4.0-pro  (configured in rerank_service.py)
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1536
QA_MODEL = "gpt-4.1"
SUMMARY_MODEL = "o4-mini"
MAX_COMPLETION_TOKENS = 16384     # gpt-4.1 has generous rate limits
MAX_CONTEXT_TOKENS = 32000        # gpt-4.1 supports up to 1M tokens
_enc = tiktoken.get_encoding("cl100k_base")


def get_embedding(text: str) -> list[float]:
    """
    Generates a high-dimensional vector embedding using text-embedding-3-large.
    Defaults to 3072 dimensions (best recall); configurable via EMBEDDING_DIMENSIONS.
    """
    try:
        clean_text = text.replace("\n", " ")
        response = client.embeddings.create(
            input=[clean_text],
            model=EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return []


def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """
    Batch-embed up to 2048 texts in a single API call for efficiency.
    Returns a list of vectors in the same order as the input texts.
    """
    if not texts:
        return []
    try:
        clean = [t.replace("\n", " ") for t in texts]
        response = client.embeddings.create(
            input=clean,
            model=EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        # The API may return embeddings out of order; sort by index
        sorted_data = sorted(response.data, key=lambda d: d.index)
        return [d.embedding for d in sorted_data]
    except Exception as e:
        print(f"Error batch-embedding: {e}")
        return [[] for _ in texts]


def generate_paper_summary(abstract: str) -> str:
    """
    Summarizes an academic abstract into exactly 3 plain English sentences
    using o4-mini at low reasoning effort — fast, cheap, and more faithful
    than GPT-class models for distilling key findings.
    """
    try:
        response = client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a world-class research assistant. "
                        "Summarize the following academic abstract into exactly 3 sentences "
                        "of plain, easy-to-understand English. Preserve key quantitative results "
                        "and findings. Do not use unnecessary jargon."
                    ),
                },
                {"role": "user", "content": abstract},
            ],
            reasoning_effort="low",
            max_completion_tokens=1024,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating summary: {e}")
        return "Summary could not be generated."


def classify_query_intent(question: str, has_history: bool) -> str:
    """Decide whether a user question needs paper retrieval.

    Returns one of:
      - "retrieval"  — question asks about a specific paper / research topic
      - "follow_up"  — references the previous conversation; reuse earlier context
      - "general"    — no papers needed (math, greetings, chitchat, etc.)
    """
    try:
        system = (
            "You classify questions for a research-paper Q&A system.\n"
            "Respond with EXACTLY one word — no punctuation, no explanation:\n"
            "RETRIEVAL — the question asks about a specific paper, research topic, "
            "or explicitly requests a search of the paper library\n"
            "FOLLOW_UP — conversation history exists AND this is a follow-up or "
            "continuation of the previous discussion (e.g. 'tell me more', "
            "'what about X', 'can you simplify that')\n"
            "GENERAL — a general question unrelated to research papers "
            "(e.g. math, greetings, jokes, definitions)"
        )
        user_msg = (
            f"Conversation history exists: {has_history}\n"
            f"Question: {question}"
        )
        response = client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            reasoning_effort="low",
            max_completion_tokens=10,
        )
        result = response.choices[0].message.content.strip().upper()
        if "RETRIEVAL" in result:
            return "retrieval"
        if "FOLLOW" in result:
            return "follow_up"
        return "general"
    except Exception:
        # Safe default: retrieve if no history, follow-up if there is
        return "retrieval" if not has_history else "follow_up"


def generate_chat_title(first_message: str) -> str:
    """Generate a short chat title (3-6 words) from the first user message."""
    try:
        response = client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Generate a concise chat title (3-6 words) for a conversation "
                        "that starts with the user message below. "
                        "Return ONLY the title — no quotes, no punctuation at the end, "
                        "no explanation. Make it descriptive and specific."
                    ),
                },
                {"role": "user", "content": first_message[:500]},
            ],
            reasoning_effort="low",
            max_completion_tokens=30,
        )
        title = response.choices[0].message.content.strip().strip('"\'')
        return title[:80] if title else "New Chat"
    except Exception as e:
        print(f"Error generating chat title: {e}")
        # Fall back to truncating the first message
        return first_message[:50].strip() or "New Chat"


# ── Shared system prompt for Q&A ──────────────────────────────────────────
_QA_SYSTEM_PROMPT = (
    "You are a brilliant, concise research assistant with deep access to the "
    "user's paper library.\n\n"
    "ANSWERING:\n"
    "- Jump straight into the answer. NEVER start with meta-commentary headings "
    "like \"Why this paper?\", \"Overview\", \"What I found\", etc.\n"
    "- Explain concepts in your own words. Use analogies, intuition, and plain language.\n"
    "- If you only have an abstract or summary (not full text), STILL explain the paper "
    "as thoroughly as you can — abstracts contain core contributions, methods, and results.\n"
    "- If the user asks to explain something simply, genuinely simplify the ideas. "
    "Build from first principles.\n"
    "- Add insight: why does this matter? What is the key intuition?\n"
    "- Be direct. Answer the question, then stop. No preambles, no \"I would need more info\".\n"
    "- NEVER guess or hallucinate paper metadata (authors, dates, venues). "
    "Only state what is explicitly in the provided context. If authors aren't listed, say so.\n"
    "- If the question is completely unrelated to every provided paper, say so in one sentence.\n"
    "- Refer to papers naturally by name in italics, like *Modular RADAR*. "
    "Never write \"(Source: ...)\" or \"(ID: ...)\" — the UI shows sources separately.\n\n"
    "CONVERSATION CONTEXT:\n"
    "- Previous messages from the conversation may be included. Use them naturally "
    "for follow-up questions.\n"
    "- If a follow-up references something you already explained, USE your previous "
    "answer — do not say you lack information or need more context.\n"
    "- Maintain continuity: remember paper names, results, and details from earlier "
    "in the conversation.\n\n"
    "FORMATTING:\n"
    "- Full Markdown is rendered. Use rich formatting to make answers scannable:\n"
    "  - ## and ### subheadings for clear sections (but NOT as the very first line).\n"
    "  - **Bold** key terms and important takeaways.\n"
    "  - *Italics* for paper titles.\n"
    "  - Bullet lists for comparisons, steps, or multiple points.\n"
    "  - > blockquotes for key definitions or quotes from papers.\n"
    "- Keep paragraphs short (2-4 sentences).\n\n"
    "MATH (critical — follow exactly):\n"
    "- Inline math: use single dollar signs with NO spaces after/before: $x^2 + y^2$\n"
    "- Display math: use double dollar signs on their OWN lines, with blank lines around them:\n"
    "\n"
    "  (blank line)\n"
    "  $$\n"
    "  E = mc^2\n"
    "  $$\n"
    "  (blank line)\n"
    "\n"
    "- NEVER put $$ on the same line as regular text.\n"
    "- NEVER mix $ and $$ in one expression.\n"
    "- ALL variables must be wrapped: $x$, $k$, $n$ — never as plain text.\n"
    "- NEVER use Unicode math symbols (², ∝, →, ≤). Always use LaTeX equivalents.\n"
    "- Keep LaTeX simple. Prefer \\\\text{} over \\\\mathrm{} for words inside math.\n"
    "- If unsure about complex notation, write it in words rather than risk broken LaTeX."
)


def _count_tokens(text: str) -> int:
    """Fast approximate token count using cl100k_base."""
    return len(_enc.encode(text, disallowed_special=()))


def _build_context_text(context_papers: list, max_tokens: int = MAX_CONTEXT_TOKENS) -> str:
    """Build the context block that is sent to the model.

    For each paper we include the best available content:
      - full_text (from PDF extraction / chunks) if it exists
      - otherwise abstract, plus the GPT-generated summary when available

    Text is truncated per-paper and globally so the total stays under
    *max_tokens*, preventing rate-limit errors.
    """
    # Per-paper token budget: spread evenly, min 800 per paper
    n_papers = max(len(context_papers), 1)
    per_paper_budget = max(max_tokens // n_papers, 800)

    parts: list[str] = []
    running_tokens = 0

    for paper in context_papers:
        lines = [f"Title: {paper['title']}"]
        if paper.get("authors"):
            authors = paper["authors"]
            if isinstance(authors, list):
                authors = ", ".join(authors)
            lines.append(f"Authors: {authors}")
        if paper.get("published_date"):
            lines.append(f"Published: {paper['published_date']}")
        if paper.get("source"):
            lines.append(f"Source: {paper['source']}")
        if paper.get("doi"):
            lines.append(f"DOI: {paper['doi']}")
        if paper.get("url"):
            lines.append(f"URL: {paper['url']}")

        if paper.get("full_text"):
            ft = paper["full_text"]
            ft_tokens = _count_tokens(ft)
            if ft_tokens > per_paper_budget - 50:  # reserve room for title+ID
                # Truncate by decoding back from token list
                tokens = _enc.encode(ft, disallowed_special=())
                ft = _enc.decode(tokens[: per_paper_budget - 50])
                ft += "\n[...truncated for length]"
            lines.append(f"Full Text: {ft}")
        else:
            lines.append(f"Abstract: {paper.get('abstract', '')}")
            if paper.get("summary"):
                lines.append(f"Summary: {paper['summary']}")

        lines.append(
            f"ID: {paper.get('arxiv_id', paper.get('paper_id', 'N/A'))}"
        )
        block = "\n".join(lines)
        block_tokens = _count_tokens(block)

        if running_tokens + block_tokens > max_tokens:
            remaining = max_tokens - running_tokens
            if remaining > 200:  # still worth including a truncated version
                tokens = _enc.encode(block, disallowed_special=())
                block = _enc.decode(tokens[:remaining])
                parts.append(block + "\n[...truncated]")
            break

        parts.append(block)
        running_tokens += block_tokens

    return "\n\n".join(parts)


def _build_messages(
    system_prompt: str,
    history: list[dict] | None,
    user_content,
) -> list[dict]:
    """Build the OpenAI messages array with optional conversation history."""
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    if history:
        for msg in history[-10:]:            # keep last 10 turns
            role = "assistant" if msg.get("role") == "assistant" else "user"
            content = msg.get("content", "")
            if len(content) > 3000:
                content = content[:3000] + "\n[...truncated]"
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_content})
    return messages


def answer_question_with_context(
    question: str,
    context_papers: list,
    history: list[dict] | None = None,
) -> dict:
    """
    Uses gpt-4.1 to answer a user's question based on the provided papers.
    Supports conversation history for follow-up questions.
    """
    context_text = _build_context_text(context_papers)

    # Only include the context block when there are papers
    if context_text:
        user_msg = f"Context:\n{context_text}\n\nQuestion: {question}"
    else:
        user_msg = question

    messages = _build_messages(_QA_SYSTEM_PROMPT, history, user_msg)

    try:
        response = client.chat.completions.create(
            model=QA_MODEL,
            messages=messages,
            temperature=0.4,
            max_tokens=MAX_COMPLETION_TOKENS,
        )
        return {"answer": response.choices[0].message.content.strip(), "sources": context_papers}
    except Exception as e:
        print(f"Error generating answer: {e}")
        return {"answer": "Sorry, I encountered an error while analyzing your papers.", "sources": []}


def answer_question_multimodal(
    question: str,
    context_papers: list,
    attachments: list[dict] | None = None,
    history: list[dict] | None = None,
) -> dict:
    """
    Multimodal Q&A using gpt-4.1 vision.
    Supports conversation history for follow-up questions.

    Accepts text question + optional attachments:
      - Images (as base64 data URLs) are passed directly as image_url content parts
      - Extracted text from PDFs/docs/audio/video is prepended to the context
    """
    attachments = attachments or []

    # Build paper context (uses shared helper)
    context_text = _build_context_text(context_papers)

    # Build extra context from non-image attachments
    file_context_parts = []
    for att in attachments:
        if att["type"] == "text" and att.get("content"):
            label = att.get("label", "Attached File")
            file_context_parts.append(f"--- {label} ---\n{att['content']}")

    file_context = "\n\n".join(file_context_parts)

    system_prompt = (
        _QA_SYSTEM_PROMPT + "\n\n"
        "ATTACHMENTS:\n"
        "The user may attach files (images, PDFs, documents, audio/video transcripts). "
        "Analyze all attached content carefully and incorporate it into your answer. "
        "If they share an image (screenshot, diagram, photo of notes, etc.), describe what "
        "you see and connect it to the relevant papers in their library."
    )

    # Build message content parts (text + images)
    user_content: list[dict] = []

    # Text part: question + paper context + file context
    text_parts = []
    if context_text:
        text_parts.append(f"Paper Context:\n{context_text}")
    if file_context:
        text_parts.append(f"Attached Files:\n{file_context}")
    text_parts.append(f"Question: {question}")

    user_content.append({"type": "text", "text": "\n\n".join(text_parts)})

    # Image parts
    for att in attachments:
        if att["type"] == "image" and att.get("data_url"):
            user_content.append({
                "type": "image_url",
                "image_url": {"url": att["data_url"], "detail": "high"},
            })

    messages = _build_messages(system_prompt, history, user_content)

    try:
        response = client.chat.completions.create(
            model=QA_MODEL,
            messages=messages,
            temperature=0.4,
            max_tokens=MAX_COMPLETION_TOKENS,
        )
        return {"answer": response.choices[0].message.content.strip(), "sources": context_papers}
    except Exception as e:
        print(f"Error in multimodal answer: {e}")
        return {"answer": "Sorry, I encountered an error while analyzing your files.", "sources": []}