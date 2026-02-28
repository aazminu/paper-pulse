"use client";

import { useEffect, useState } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
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
import { Input } from "@/components/ui/input";
import {
	BookmarkCheck,
	ExternalLink,
	BrainCircuit,
	BookmarkX,
	Search,
} from "lucide-react";

interface SavedItem {
	id: string;
	relevance_score: number;
	is_saved: boolean;
	created_at: string;
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

export default function SavedPage() {
	const { user, isLoaded } = useUser();
	const [saved, setSaved] = useState<SavedItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");

	useEffect(() => {
		const fetchSaved = async () => {
			if (!user) return;
			try {
				const res = await fetch(
					`${process.env.NEXT_PUBLIC_API_URL}/feed/${user.id}/saved`,
				);
				if (res.ok) {
					const data = await res.json();
					setSaved(data);
				}
			} catch (error) {
				console.error("Failed to fetch saved papers:", error);
			} finally {
				setIsLoading(false);
			}
		};

		if (isLoaded) {
			fetchSaved();
		}
	}, [user, isLoaded]);

	const unsave = async (feedItemId: string) => {
		setSaved(saved.filter((item) => item.id !== feedItemId));
		try {
			await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feed/${feedItemId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ is_saved: false }),
			});
		} catch (error) {
			console.error("Failed to unsave paper:", error);
		}
	};

	const filtered = saved.filter(
		(item) =>
			!searchQuery ||
			item.paper.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			item.paper.authors.some((a) =>
				a.toLowerCase().includes(searchQuery.toLowerCase()),
			) ||
			(item.paper.summary ?? "")
				.toLowerCase()
				.includes(searchQuery.toLowerCase()),
	);

	if (!isLoaded) return null;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-black">
			{/* Navigation Bar */}
			<header className="border-b bg-white dark:bg-zinc-950 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight">PaperPulse</h1>
					<nav className="hidden sm:flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
						<Link
							href="/feed"
							className="hover:text-black dark:hover:text-white transition"
						>
							Daily Feed
						</Link>
						<Link href="/saved" className="text-black dark:text-white">
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
				<div className="mb-8 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
					<div>
						<h2 className="text-3xl font-semibold tracking-tight">
							Saved Articles
						</h2>
						<p className="text-zinc-500 mt-2">
							Your bookmarked research papers — {saved.length} saved.
						</p>
					</div>
					{saved.length > 0 && (
						<div className="relative w-full sm:w-64">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
							<Input
								placeholder="Search saved papers…"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
					)}
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
				{!isLoading && saved.length === 0 && (
					<div className="text-center py-24 border-2 border-dashed rounded-xl">
						<BookmarkCheck className="mx-auto h-12 w-12 text-zinc-300 mb-4" />
						<h3 className="text-lg font-medium">No saved papers yet.</h3>
						<p className="text-zinc-500 mt-1">
							Bookmark papers from your{" "}
							<Link href="/feed" className="text-blue-600 underline">
								Daily Feed
							</Link>{" "}
							to see them here.
						</p>
					</div>
				)}

				{/* No search results */}
				{!isLoading && saved.length > 0 && filtered.length === 0 && (
					<div className="text-center py-16 border-2 border-dashed rounded-xl">
						<Search className="mx-auto h-10 w-10 text-zinc-300 mb-3" />
						<h3 className="text-lg font-medium">No matching papers.</h3>
						<p className="text-zinc-500 mt-1">
							Try a different search term.
						</p>
					</div>
				)}

				{/* Saved List */}
				{!isLoading && filtered.length > 0 && (
					<div className="space-y-6">
						{filtered.map((item) => (
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
									<Button
										variant="ghost"
										size="sm"
										className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
										onClick={() => unsave(item.id)}
									>
										<BookmarkX className="h-4 w-4" /> Unsave
									</Button>
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
