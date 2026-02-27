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