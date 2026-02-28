"use client";

import { useEffect, useState } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Bookmark,
	BookmarkCheck,
	ExternalLink,
	BrainCircuit,
	Sparkles,
} from "lucide-react";

// TypeScript interface based on our FastAPI backend response
interface FeedItem {
	id: string;
	relevance_score: number;
	is_saved: boolean;
	paper: {
		arxiv_id: string;
		title: string;
		authors: string[];
		published_date: string;
		abstract: string;
		summary: string;
		url: string;
		source?: string;
	};
}

/** Map source IDs to human-readable labels */
function getSourceLabel(source?: string): string {
	switch (source) {
		case "semantic_scholar":
			return "Semantic Scholar";
		case "openalex":
			return "OpenAlex";
		case "pubmed":
			return "PubMed";
		case "arxiv":
		default:
			return "ArXiv";
	}
}

/** Map source IDs to link text */
function getSourceLinkText(source?: string): string {
	switch (source) {
		case "semantic_scholar":
			return "View Paper";
		case "openalex":
			return "View Paper";
		case "pubmed":
			return "View on PubMed";
		case "arxiv":
		default:
			return "Read on ArXiv";
	}
}

export default function FeedPage() {
	const { user, isLoaded } = useUser();
	const router = useRouter();
	const [feed, setFeed] = useState<FeedItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const fetchFeed = async () => {
			if (!user) return;
			try {
				const res = await fetch(
					`${process.env.NEXT_PUBLIC_API_URL}/feed/${user.id}`,
				);
				if (res.ok) {
					const data = await res.json();
					setFeed(data);
				}
			} catch (error) {
				console.error("Failed to fetch feed:", error);
			} finally {
				setIsLoading(false);
			}
		};

		if (isLoaded) {
			fetchFeed();
		}
	}, [user, isLoaded]);

	const toggleSave = async (feedItemId: string, currentStatus: boolean) => {
		// Optimistic UI update for immediate feedback
		setFeed(
			feed.map((item) =>
				item.id === feedItemId ? { ...item, is_saved: !currentStatus } : item,
			),
		);

		try {
			await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feed/${feedItemId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ is_saved: !currentStatus }),
			});
		} catch (error) {
			console.error("Failed to update saved status:", error);
			// Revert on failure (optional, but good practice)
			setFeed(
				feed.map((item) =>
					item.id === feedItemId ? { ...item, is_saved: currentStatus } : item,
				),
			);
		}
	};

	if (!isLoaded) return null;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-black">
			{/* Simple Navigation Bar */}
			<header className="border-b bg-white dark:bg-zinc-950 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight">PaperPulse</h1>
					<nav className="hidden sm:flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
						<Link href="/feed" className="text-black dark:text-white">
							Daily Feed
						</Link>
						<Link
							href="/saved"
							className="hover:text-black dark:hover:text-white transition"
						>
							Saved
						</Link>
						<Link
							href="/ask"
							className="hover:text-black dark:hover:text-white transition"
						>
							Ask AI
						</Link>
					</nav>
				</div>
				<UserButton />
			</header>

			<main className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
				<div className="mb-8">
					<h2 className="text-3xl font-semibold tracking-tight">
						Your Daily Digest
					</h2>
					<p className="text-zinc-500 mt-2">
						AI-curated from ArXiv, Semantic Scholar, PubMed &amp; OpenAlex —
						ranked by your research interests.
					</p>
				</div>

				{/* Loading State */}
				{isLoading && (
					<div className="space-y-6">
						{[1, 2, 3].map((i) => (
							<Card key={i} className="w-full">
								<CardHeader>
									<Skeleton className="h-6 w-3/4 mb-2" />
									<Skeleton className="h-4 w-1/4" />
								</CardHeader>
								<CardContent>
									<Skeleton className="h-20 w-full" />
								</CardContent>
							</Card>
						))}
					</div>
				)}

				{/* Empty State */}
				{!isLoading && feed.length === 0 && (
					<div className="text-center py-24 border-2 border-dashed rounded-xl">
						<BrainCircuit className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
						<h3 className="text-lg font-medium">
							No papers match your interests today.
						</h3>
						<p className="text-zinc-500">
							Check back tomorrow after the nightly pipeline runs!
						</p>
					</div>
				)}

				{/* Feed List */}
				{!isLoading && feed.length > 0 && (
					<div className="space-y-6">
						{feed.map((item) => (
							<Card
								key={item.id}
								className="w-full shadow-sm hover:shadow-md transition-shadow"
							>
								<CardHeader className="pb-3">
									<div className="flex justify-between items-start gap-4">
										<div>
											<CardTitle className="text-xl leading-tight mb-2">
												{item.paper.title}
											</CardTitle>
											<p className="text-sm text-zinc-500">
												{item.paper.authors.slice(0, 3).join(", ")}
												{item.paper.authors.length > 3 ? " et al." : ""} •{" "}
												{item.paper.published_date}
											</p>
										</div>
										<div className="flex flex-col gap-1 items-end shrink-0">
											<Badge
												variant={
													item.relevance_score > 0.8 ? "default" : "secondary"
												}
												className="whitespace-nowrap"
											>
												{(item.relevance_score * 100).toFixed(0)}% Match
											</Badge>
											<Badge
												variant="outline"
												className="whitespace-nowrap text-xs"
											>
												{getSourceLabel(item.paper.source)}
											</Badge>
										</div>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="bg-zinc-100 dark:bg-zinc-900 p-4 rounded-md border-l-4 border-blue-500">
										<p className="text-sm font-medium mb-1 flex items-center gap-2">
											<BrainCircuit className="h-4 w-4" /> AI Summary
										</p>
										<p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
											{item.paper.summary}
										</p>
									</div>
								</CardContent>
								<CardFooter className="flex justify-between border-t pt-4">
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											className="gap-2"
											onClick={() => toggleSave(item.id, item.is_saved)}
										>
											{item.is_saved ? (
												<>
													<BookmarkCheck className="h-4 w-4 text-blue-600" />{" "}
													Saved
												</>
											) : (
												<>
													<Bookmark className="h-4 w-4" /> Save Paper
												</>
											)}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="gap-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950"
											onClick={() => router.push(`/ask?paper=${encodeURIComponent(item.paper.arxiv_id)}`)}
										>
											<Sparkles className="h-4 w-4" /> Explore with AI
										</Button>
									</div>
									<Button variant="outline" size="sm" asChild className="gap-2">
										<a
											href={item.paper.url}
											target="_blank"
											rel="noopener noreferrer"
										>
											{getSourceLinkText(item.paper.source)}{" "}
											<ExternalLink className="h-4 w-4" />
										</a>
									</Button>
								</CardFooter>
							</Card>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
