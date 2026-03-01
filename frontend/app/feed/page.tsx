"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
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
	CalendarDays,
} from "lucide-react";

interface FeedItem {
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

interface DateGroup {
	label: string;
	date: string;
	items: FeedItem[];
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

function formatDateLabel(dateStr: string): string {
	const date = new Date(dateStr + "T00:00:00");
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const diffDays = Math.round(
		(today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24),
	);

	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7)
		return date.toLocaleDateString("en-US", { weekday: "long" });
	return date.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: today.getFullYear() !== date.getFullYear() ? "numeric" : undefined,
	});
}

export default function FeedPage() {
	const { user, isLoaded } = useUser();
	const router = useRouter();
	const [feed, setFeed] = useState<FeedItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [activeDate, setActiveDate] = useState<string | null>(null);
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

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

	const dateGroups = useMemo<DateGroup[]>(() => {
		const groups: Record<string, FeedItem[]> = {};
		for (const item of feed) {
			const dateKey = (item.created_at || "").slice(0, 10);
			if (!groups[dateKey]) groups[dateKey] = [];
			groups[dateKey].push(item);
		}
		return Object.entries(groups)
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([date, items]) => ({
				label: formatDateLabel(date),
				date,
				items: items.sort((a, b) => b.relevance_score - a.relevance_score),
			}));
	}, [feed]);

	/* ── Track which section is in view ──────────────────────────────── */
	useEffect(() => {
		if (dateGroups.length === 0) return;

		// Set first date as active by default
		if (!activeDate && dateGroups.length > 0) {
			setActiveDate(dateGroups[0].date);
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveDate(entry.target.id.replace("section-", ""));
					}
				}
			},
			{ rootMargin: "-80px 0px -60% 0px", threshold: 0 },
		);

		for (const group of dateGroups) {
			const el = sectionRefs.current[group.date];
			if (el) observer.observe(el);
		}

		return () => observer.disconnect();
	}, [dateGroups, activeDate]);

	const scrollToSection = useCallback((date: string) => {
		const el = sectionRefs.current[date];
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, []);

	const toggleSave = async (feedItemId: string, currentStatus: boolean) => {
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
						<Link
							href="/graph"
							className="hover:text-black dark:hover:text-white transition"
						>
							Graph
						</Link>
					</nav>
				</div>
				<UserButton />
			</header>

			<div className="max-w-6xl mx-auto flex gap-12 py-8 px-4 sm:px-6">
				{/* Main content */}
				<main className="flex-1 min-w-0 max-w-4xl">
					<div className="mb-8">
						<h2 className="text-3xl font-semibold tracking-tight">
							Your Research Feed
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
								No papers in your feed yet.
							</h3>
							<p className="text-zinc-500">
								Check back after the nightly pipeline runs!
							</p>
						</div>
					)}

					{/* Date-grouped Feed */}
					{!isLoading && dateGroups.length > 0 && (
						<div className="space-y-10">
							{dateGroups.map((group) => (
								<section
									key={group.date}
									id={`section-${group.date}`}
									ref={(el) => {
										sectionRefs.current[group.date] = el;
									}}
									className="scroll-mt-20"
								>
									<div className="flex items-center gap-3 mb-5">
										<div className="bg-zinc-200 dark:bg-zinc-800 rounded-full px-3 py-1 flex items-center gap-2">
											<CalendarDays className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
											<h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
												{group.label}
											</h3>
										</div>
										<span className="text-xs text-zinc-400">
											{group.items.length} paper
											{group.items.length !== 1 ? "s" : ""}
										</span>
										<div className="flex-1 border-t border-zinc-200 dark:border-zinc-800" />
									</div>
									<div className="space-y-6">
										{group.items.map((item) => (
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
																{item.paper.authors.length > 3
																	? " et al."
																	: ""}{" "}
																• {item.paper.published_date}
															</p>
														</div>
														<div className="flex flex-col gap-1 items-end shrink-0">
															<Badge
																variant={
																	item.relevance_score > 0.8
																		? "default"
																		: "secondary"
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
															onClick={() =>
																router.push(
																	`/ask?paper=${encodeURIComponent(item.paper.arxiv_id)}`,
																)
															}
														>
															<Sparkles className="h-4 w-4" /> Explore with AI
														</Button>
													</div>
													<Button
														variant="outline"
														size="sm"
														asChild
														className="gap-2"
													>
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
								</section>
							))}
						</div>
					)}
				</main>

				{/* Right side date navigation */}
				{!isLoading && dateGroups.length > 0 && (
					<aside className="hidden md:block w-44 shrink-0">
						<nav className="sticky top-20">
							<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-3">
								Jump to
							</p>
							<div className="space-y-0.5">
								{dateGroups.map((group) => (
									<button
										key={group.date}
										onClick={() => scrollToSection(group.date)}
										className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-all ${
											activeDate === group.date
												? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
												: "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
										}`}
									>
										<span className="block">{group.label}</span>
										<span className="block text-[10px] text-zinc-400 font-normal">
											{group.items.length} paper
											{group.items.length !== 1 ? "s" : ""}
										</span>
									</button>
								))}
							</div>
						</nav>
					</aside>
				)}
			</div>
		</div>
	);
}
