import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API key. Check your .env file.")

# Initialize the synchronous OpenAI client
client = OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# Embedding Configuration
# ---------------------------------------------------------------------------
# text-embedding-3-large is OpenAI's highest-fidelity embedding model.
# Even at 1536 dimensions it significantly outperforms text-embedding-ada-002
# on every MTEB/BEIR benchmark. We use 1536 to stay within Supabase's
# pgvector column limit.
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1536


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
    using gpt-5-mini — OpenAI's latest cost-efficient reasoning model (400K context).
    """
    try:
        response = client.chat.completions.create(
            model="gpt-5-mini",
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
            temperature=1,
            max_completion_tokens=1024,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating summary: {e}")
        return "Summary could not be generated."


def answer_question_with_context(question: str, context_papers: list) -> dict:
    """
    Uses gpt-5.2 — OpenAI's flagship model (400K context, advanced reasoning,
    best coding/agentic model) — to answer a user's question based strictly
    on the provided papers.  With 400K tokens we can comfortably pass full
    abstracts (or full text when available) from 25+ papers.
    """
    # Use full_text when available (PDF-extracted), fall back to abstract
    context_text = "\n\n".join([
        f"Title: {paper['title']}\n"
        f"{'Full Text' if paper.get('full_text') else 'Abstract'}: "
        f"{paper.get('full_text') or paper['abstract']}\n"
        f"ID: {paper.get('arxiv_id', paper.get('paper_id', 'N/A'))}"
        for paper in context_papers
    ])

    system_prompt = (
        "You are a brilliant research assistant who genuinely understands the papers in the "
        "user's library. Your job is to help them actually understand what they're reading, "
        "not just parrot back what's written.\n\n"
        "HOW TO ANSWER:\n"
        "- Think about what the user is really asking and what they need to understand.\n"
        "- Explain concepts in your own words. Use analogies, intuition, and plain language.\n"
        "- If the user asks to explain something simply or like they're 5, genuinely simplify "
        "the ideas, not just the vocabulary. Build up from first principles.\n"
        "- Add your own insight: why does this matter? What's the key intuition? "
        "What would be lost if you skipped this idea?\n"
        "- Don't just list what the paper says. Digest it and re-explain it.\n"
        "- Only use information from the provided context papers. If you can't answer, say so.\n"
        "- Refer to papers naturally by name in italics, like *Modular RADAR*. "
        "Never write \"(Source: ...)\" or \"(ID: ...)\" since the UI shows sources separately.\n\n"
        "FORMATTING:\n"
        "- The frontend renders full Markdown and LaTeX. Use whatever formatting makes "
        "the answer clearest: paragraphs, headings, bold, lists, blockquotes, etc.\n"
        "- Write naturally. Don't force a rigid template. Let the content dictate the structure.\n"
        "- Keep paragraphs short (2-4 sentences) with blank lines between them for readability.\n\n"
        "MATH (critical, follow exactly):\n"
        "- Every single math expression MUST be wrapped in LaTeX dollar-sign delimiters.\n"
        "- Inline math: $E = mc^2$, $O(\\log^2 n)$, $V_{LN} \\propto M^{3/7}$\n"
        "- Display math on its own line:\n\n"
        "$$\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}$$\n\n"
        "- This includes ALL variables ($w$, $k$, $n$), ALL formulas, ALL equations.\n"
        "- NEVER write math as plain text. NEVER use Unicode superscripts/subscripts "
        "(², ³, ₁). NEVER use Unicode symbols like ∝ or →. Always use LaTeX equivalents.\n"
        "- Single variables count as math: write $w^{(k)}$ not w(k)."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {question}"},
            ],
            temperature=0.4,
        )
        return {"answer": response.choices[0].message.content.strip(), "sources": context_papers}
    except Exception as e:
        print(f"Error generating answer: {e}")
        return {"answer": "Sorry, I encountered an error while analyzing your papers.", "sources": []}