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
        "You are an expert academic research assistant with deep expertise across all "
        "scientific domains. Answer the user's question using ONLY the provided context "
        "from their personal research corpus.\n"
        "If the answer is not contained in the context, say 'I cannot find the answer "
        "in your saved papers.'\n"
        "Always cite your sources by mentioning the paper Title or ID.\n"
        "Synthesize information across multiple papers when relevant.\n"
        "Provide structured, thorough answers with clear reasoning."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {question}"},
            ],
            temperature=0.2,  # Low temperature to prevent hallucinations
        )
        return {"answer": response.choices[0].message.content.strip(), "sources": context_papers}
    except Exception as e:
        print(f"Error generating answer: {e}")
        return {"answer": "Sorry, I encountered an error while analyzing your papers.", "sources": []}