import json
from app.database import supabase
from app.services.arxiv_service import fetch_daily_papers
from app.services.openai_service import get_embedding, generate_paper_summary
from datetime import datetime
from app.database import supabase

def calculate_similarity(vec1, vec2) -> float:
    if not vec1 or not vec2:
        return 0.0
        
    if isinstance(vec1, str):
        vec1 = json.loads(vec1)
    if isinstance(vec2, str):
        vec2 = json.loads(vec2)
        
    return sum(x * y for x, y in zip(vec1, vec2))

def run_daily_pipeline():
    print("Starting PaperPulse Daily Pipeline...")

    # Get all users
    users_response = supabase.table("users").select("*").execute()
    users = users_response.data
    if not users:
        print("No users found. Exiting.")
        return {"status": "success", "message": "No users to process"}

    # Gather all unique domains across all users
    all_domains = set()
    for u in users:
        all_domains.update(u.get("domains", []))
    
    # Fetch today's papers for those domains from ArXiv
    print(f"Fetching ArXiv papers for domains: {list(all_domains)}")
    # We limit to 5 here just for testing so it doesn't burn your OpenAI credits!
    # In production, change max_results to 50 or 100
    raw_papers = fetch_daily_papers(list(all_domains), max_results=5) 
    print(f"Found {len(raw_papers)} papers.")

    processed_papers = []

    # Process each paper (Embed + Summarize)
    for paper in raw_papers:
        # Check if we already processed this paper to save API costs
        existing = supabase.table("papers").select("arxiv_id").eq("arxiv_id", paper["arxiv_id"]).execute()
        if existing.data:
            print(f"Skipping {paper['arxiv_id']}, already in database.")
            # We still need it for the matching phase, so we fetch the full record
            full_existing = supabase.table("papers").select("*").eq("arxiv_id", paper["arxiv_id"]).execute()
            processed_papers.append(full_existing.data[0])
            continue

        print(f"Processing: {paper['title'][:50]}...")
        
        # Hit OpenAI
        abstract_vector = get_embedding(paper["abstract"])
        summary = generate_paper_summary(paper["abstract"])

        # Prepare DB record
        paper_record = {
            "arxiv_id": paper["arxiv_id"],
            "title": paper["title"],
            "authors": paper["authors"],
            "published_date": paper["published_date"].isoformat(),
            "abstract": paper["abstract"],
            "abstract_vector": abstract_vector,
            "summary": summary,
            "url": paper["url"]
        }

        # Save to DB
        supabase.table("papers").insert(paper_record).execute()
        processed_papers.append(paper_record)

    # Match papers to users and populate their feeds
    print("Matching papers to users...")
    feed_items_created = 0

    for user in users:
        user_id = user["id"]
        interest_vector = user.get("interest_vector")

        if not interest_vector:
            continue # Skip users who didn't provide interest text

        # Score all processed papers against this user's interests
        scored_papers = []
        for paper in processed_papers:
            if not paper.get("abstract_vector"):
                continue
            
            score = calculate_similarity(interest_vector, paper["abstract_vector"])
            scored_papers.append({"paper_id": paper["arxiv_id"], "score": score})

        # Sort by highest score first and take the top 10
        scored_papers.sort(key=lambda x: x["score"], reverse=True)
        top_matches = scored_papers[:10]

        # Save to the feed_items table
        for match in top_matches:
            feed_record = {
                "user_id": user_id,
                "paper_id": match["paper_id"],
                "relevance_score": match["score"],
                "is_saved": False
            }
            try:
                supabase.table("feed_items").insert(feed_record).execute()
                feed_items_created += 1
            except Exception as e:
                # This will catch the UNIQUE constraint if the user already has this paper in their feed
                pass 

    print(f"Pipeline complete! Created {feed_items_created} new feed items.")
    return {"status": "success", "papers_processed": len(processed_papers), "feed_items_created": feed_items_created}