"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ExternalLink, GitBranch } from "lucide-react";

interface RelatedPaper {
	arxiv_id: string;
	title: string;
	published_date: string;
	source: string;
	url: string;
	relevance: number;
}

interface RelatedPapersProps {
	arxivId: string;
	className?: string;
}

export default function RelatedPapers({
	arxivId,
	className = "",
}: RelatedPapersProps) {
	const router = useRouter();
	const [papers, setPapers] = useState<RelatedPaper[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchRelated = async () => {
			try {
				const res = await fetch(
					`${process.env.NEXT_PUBLIC_API_URL}/graph/paper/${encodeURIComponent(arxivId)}/related?limit=5`,
				);
				if (res.ok) {
					const data = await res.json();
					setPapers(data.related || []);
				}
			} catch (error) {
				console.error("Failed to fetch related papers:", error);
			} finally {
				setLoading(false);
			}
		};

		if (arxivId) fetchRelated();
	}, [arxivId]);

	if (loading) {
		return (
			<div className={`space-y-2 ${className}`}>
				<div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
					<GitBranch className="h-3.5 w-3.5" />
					Related Papers
				</div>
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-16 w-full rounded-lg" />
				))}
			</div>
		);
	}

	if (papers.length === 0) return null;

	return (
		<div className={`space-y-2 ${className}`}>
			<div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
				<GitBranch className="h-3.5 w-3.5" />
				Related via Knowledge Graph
			</div>
			{papers.map((paper) => (
				<Card
					key={paper.arxiv_id}
					className="shadow-none border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
				>
					<CardContent className="p-3">
						<p className="text-sm font-medium leading-snug line-clamp-2 mb-1.5">
							{paper.title}
						</p>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-1.5">
								<Badge variant="outline" className="text-[10px] px-1.5 py-0">
									{paper.source || "ArXiv"}
								</Badge>
								{paper.published_date && (
									<span className="text-[10px] text-zinc-400">
										{paper.published_date}
									</span>
								)}
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-[10px] gap-1 text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950"
									onClick={() =>
										router.push(
											`/ask?paper=${encodeURIComponent(paper.arxiv_id)}`,
										)
									}
								>
									<Sparkles className="h-3 w-3" />
									Explore
								</Button>
								{paper.url && (
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-[10px] gap-1"
										asChild
									>
										<a
											href={paper.url}
											target="_blank"
											rel="noopener noreferrer"
										>
											<ExternalLink className="h-3 w-3" />
										</a>
									</Button>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
