import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API key. Check your .env file.")

# Initialize the synchronous OpenAI client
client = OpenAI(api_key=OPENAI_API_KEY)

def get_embedding(text: str) -> list[float]:
    """
    Generates a 1536-dimensional vector embedding for a given text string.
    """
    try:
        # We replace newlines to ensure better embedding quality
        clean_text = text.replace("\n", " ")
        response = client.embeddings.create(
            input=[clean_text],
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return []

def generate_paper_summary(abstract: str) -> str:
    """
    Summarizes an ArXiv abstract into exactly 3 plain English sentences.
    """
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a research assistant. Summarize the following academic abstract into exactly 3 sentences of plain, easy-to-understand English. Do not use jargon if it can be avoided."
                },
                {"role": "user", "content": abstract}
            ],
            temperature=0.3, # Keep it factual and concise
            max_tokens=150
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating summary: {e}")
        return "Summary could not be generated."

def answer_question_with_context(question: str, context_papers: list) -> dict:
    """
    Uses GPT-4o to answer a user's question based strictly on the provided paper abstracts.
    """
    # Build a single string containing all the context
    context_text = "\n\n".join([
        f"Title: {paper['title']}\nAbstract: {paper['abstract']}\nID: {paper['arxiv_id']}" 
        for paper in context_papers
    ])

    system_prompt = (
        "You are an expert academic research assistant. Answer the user's question "
        "using ONLY the provided context from their personal research corpus.\n"
        "If the answer is not contained in the context, say 'I cannot find the answer in your saved papers.'\n"
        "Always cite your sources by mentioning the paper Title or ID at the end of your claims."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {question}"}
            ],
            temperature=0.2 # Low temperature to prevent hallucinations
        )
        return {"answer": response.choices[0].message.content.strip(), "sources": context_papers}
    except Exception as e:
        print(f"Error generating answer: {e}")
        return {"answer": "Sorry, I encountered an error while analyzing your papers.", "sources": []}