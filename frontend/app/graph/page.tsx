"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	GitBranch,
	Search,
	Sparkles,
	BarChart3,
	X,
	Network,
} from "lucide-react";

// Dynamic import to avoid SSR issues with canvas
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
	ssr: false,
});

interface GraphNode {
	id: string;
	label: string;
	type: "paper" | "author" | "concept";
	source?: string;
	category?: string;
	x?: number;
	y?: number;
}

interface GraphEdge {
	source: string;
	target: string;
	type: "authored" | "involves" | "cites";
}

interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

interface GraphStats {
	papers: number;
	authors: number;
	concepts: number;
	institutions: number;
	citations: number;
	authorships: number;
}

const NODE_COLORS: Record<string, string> = {
	paper: "#3b82f6",
	author: "#8b5cf6",
	concept: "#10b981",
	institution: "#f59e0b",
};

const EDGE_COLORS: Record<string, string> = {
	authored: "#8b5cf6",
	involves: "#10b981",
	cites: "#3b82f6",
};

export default function GraphPage() {
	const { isLoaded } = useUser();
	const router = useRouter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const graphRef = useRef<any>(null);

	const [graphData, setGraphData] = useState<GraphData>({
		nodes: [],
		edges: [],
	});
	const [stats, setStats] = useState<GraphStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [filterType, setFilterType] = useState<string | null>(null);
	const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

	// Track container size
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const updateSize = () => {
			if (containerRef.current) {
				const rect = containerRef.current.getBoundingClientRect();
				setDimensions({
					width: rect.width,
					height: Math.max(rect.height, 500),
				});
			}
		};
		updateSize();
		window.addEventListener("resize", updateSize);
		return () => window.removeEventListener("resize", updateSize);
	}, []);

	// Fetch graph data
	useEffect(() => {
		const fetchGraph = async () => {
			try {
				const [graphRes, statsRes] = await Promise.all([
					fetch(`${process.env.NEXT_PUBLIC_API_URL}/graph/explore?limit=200`),
					fetch(`${process.env.NEXT_PUBLIC_API_URL}/graph/stats`),
				]);

				if (graphRes.ok) {
					const data = await graphRes.json();
					setGraphData({
						nodes: data.nodes || [],
						edges: data.edges || [],
					});
				}
				if (statsRes.ok) {
					const data = await statsRes.json();
					setStats(data);
				}
			} catch (error) {
				console.error("Failed to fetch graph:", error);
			} finally {
				setLoading(false);
			}
		};

		if (isLoaded) fetchGraph();
	}, [isLoaded]);

	// Filter graph data
	const getEdgeId = (val: string | { id: string }): string =>
		typeof val === "string" ? val : val.id;

	const filteredData = useCallback(() => {
		let nodes = graphData.nodes;
		let edges = graphData.edges;

		if (filterType) {
			nodes = nodes.filter((n) => n.type === filterType);
			const nodeIds = new Set(nodes.map((n) => n.id));
			edges = edges.filter(
				(e) =>
					nodeIds.has(getEdgeId(e.source as string | { id: string })) &&
					nodeIds.has(getEdgeId(e.target as string | { id: string })),
			);
		}

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			const matchingIds = new Set(
				nodes
					.filter((n) => n.label?.toLowerCase().includes(q))
					.map((n) => n.id),
			);
			const neighborIds = new Set<string>();
			edges.forEach((e) => {
				const srcId = getEdgeId(e.source as string | { id: string });
				const tgtId = getEdgeId(e.target as string | { id: string });
				if (matchingIds.has(srcId)) neighborIds.add(tgtId);
				if (matchingIds.has(tgtId)) neighborIds.add(srcId);
			});
			const visibleIds = new Set([...matchingIds, ...neighborIds]);
			nodes = nodes.filter((n) => visibleIds.has(n.id));
			edges = edges.filter((e) => {
				const srcId = getEdgeId(e.source as string | { id: string });
				const tgtId = getEdgeId(e.target as string | { id: string });
				return visibleIds.has(srcId) && visibleIds.has(tgtId);
			});
		}

		return { nodes, links: edges };
	}, [graphData, filterType, searchQuery]);

	const handleNodeClick = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any) => {
			setSelectedNode(node as GraphNode);
			// Zoom to node
			if (graphRef.current) {
				graphRef.current.centerAt(node.x, node.y, 500);
				graphRef.current.zoom(3, 500);
			}
		},
		[],
	);

	const paintNode = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const n = node as GraphNode;
			const isSelected = selectedNode?.id === n.id;
			const size = n.type === "paper" ? 6 : n.type === "author" ? 4 : 3;
			const finalSize = isSelected ? size * 1.5 : size;

			// Draw node circle
			ctx.beginPath();
			ctx.arc(node.x!, node.y!, finalSize, 0, 2 * Math.PI);
			ctx.fillStyle = NODE_COLORS[n.type] || "#666";
			ctx.fill();

			if (isSelected) {
				ctx.strokeStyle = "#fff";
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			// Draw label when zoomed in
			if (globalScale > 2) {
				const label = n.label || n.id;
				const displayLabel =
					label.length > 30 ? label.slice(0, 30) + "…" : label;
				ctx.font = `${Math.max(10 / globalScale, 2)}px Inter, sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.fillStyle = document.documentElement.classList.contains("dark")
					? "#ccc"
					: "#333";
				ctx.fillText(displayLabel, node.x!, node.y! + finalSize + 2);
			}
		},
		[selectedNode],
	);

	if (!isLoaded) return null;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-black">
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
						<Link href="/graph" className="text-black dark:text-white">
							Knowledge Graph
						</Link>
					</nav>
				</div>
				<UserButton />
			</header>

			<div className="flex h-[calc(100vh-65px)]">
				{/* Sidebar */}
				<aside className="w-72 border-r bg-white dark:bg-zinc-950 p-4 flex flex-col gap-4 overflow-y-auto">
					{/* Stats */}
					{stats && (
						<Card className="shadow-none">
							<CardHeader className="pb-2 pt-3 px-3">
								<CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
									<BarChart3 className="h-3.5 w-3.5" />
									Graph Stats
								</CardTitle>
							</CardHeader>
							<CardContent className="px-3 pb-3 grid grid-cols-2 gap-2">
								<div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950">
									<p className="text-lg font-bold text-blue-600">
										{stats.papers}
									</p>
									<p className="text-[10px] text-zinc-500">Papers</p>
								</div>
								<div className="text-center p-2 rounded-lg bg-purple-50 dark:bg-purple-950">
									<p className="text-lg font-bold text-purple-600">
										{stats.authors}
									</p>
									<p className="text-[10px] text-zinc-500">Authors</p>
								</div>
								<div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950">
									<p className="text-lg font-bold text-emerald-600">
										{stats.concepts}
									</p>
									<p className="text-[10px] text-zinc-500">Concepts</p>
								</div>
								<div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950">
									<p className="text-lg font-bold text-amber-600">
										{stats.institutions}
									</p>
									<p className="text-[10px] text-zinc-500">Institutions</p>
								</div>
								<div className="text-center p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 col-span-2">
									<p className="text-lg font-bold text-zinc-600 dark:text-zinc-300">
										{stats.citations + stats.authorships}
									</p>
									<p className="text-[10px] text-zinc-500">Relationships</p>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Search */}
					<div className="relative">
						<Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
						<Input
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search nodes…"
							className="pl-8 h-9 text-sm"
						/>
						{searchQuery && (
							<button
								onClick={() => setSearchQuery("")}
								className="absolute right-2.5 top-2.5"
							>
								<X className="h-3.5 w-3.5 text-zinc-400" />
							</button>
						)}
					</div>

					{/* Filter buttons */}
					<div className="space-y-1.5">
						<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
							Filter by Type
						</p>
						<div className="flex flex-wrap gap-1.5">
							{[
								{ type: null, label: "All" },
								{ type: "paper", label: "Papers" },
								{ type: "author", label: "Authors" },
								{ type: "concept", label: "Concepts" },
							].map(({ type, label }) => (
								<Button
									key={label}
									variant={filterType === type ? "default" : "outline"}
									size="sm"
									className="h-7 text-xs"
									onClick={() => setFilterType(type)}
								>
									{type && (
										<span
											className="w-2 h-2 rounded-full mr-1.5 inline-block"
											style={{
												backgroundColor: NODE_COLORS[type] || "#666",
											}}
										/>
									)}
									{label}
								</Button>
							))}
						</div>
					</div>

					{/* Legend */}
					<div className="space-y-1.5">
						<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
							Legend
						</p>
						<div className="space-y-1">
							{[
								{ color: NODE_COLORS.paper, label: "Paper", shape: "●" },
								{ color: NODE_COLORS.author, label: "Author", shape: "●" },
								{ color: NODE_COLORS.concept, label: "Concept", shape: "●" },
							].map(({ color, label, shape }) => (
								<div
									key={label}
									className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
								>
									<span style={{ color }}>{shape}</span>
									{label}
								</div>
							))}
							<div className="pt-1 border-t border-zinc-200 dark:border-zinc-800 mt-1">
								{[
									{ color: EDGE_COLORS.cites, label: "Cites" },
									{ color: EDGE_COLORS.authored, label: "Authored" },
									{ color: EDGE_COLORS.involves, label: "Uses concept" },
								].map(({ color, label }) => (
									<div
										key={label}
										className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
									>
										<span
											className="w-4 h-0.5 inline-block rounded"
											style={{ backgroundColor: color }}
										/>
										{label}
									</div>
								))}
							</div>
						</div>
					</div>

					{/* Selected node details */}
					{selectedNode && (
						<Card className="shadow-none border-zinc-200 dark:border-zinc-800">
							<CardHeader className="pb-2 pt-3 px-3">
								<div className="flex items-center justify-between">
									<Badge
										style={{
											backgroundColor: NODE_COLORS[selectedNode.type],
											color: "#fff",
										}}
										className="text-[10px]"
									>
										{selectedNode.type}
									</Badge>
									<button onClick={() => setSelectedNode(null)}>
										<X className="h-3.5 w-3.5 text-zinc-400" />
									</button>
								</div>
							</CardHeader>
							<CardContent className="px-3 pb-3">
								<p className="text-sm font-medium leading-snug mb-2">
									{selectedNode.label}
								</p>
								{selectedNode.type === "paper" && (
									<div className="flex gap-1.5">
										<Button
											variant="outline"
											size="sm"
											className="h-7 text-xs gap-1 text-purple-600"
											onClick={() =>
												router.push(
													`/ask?paper=${encodeURIComponent(selectedNode.id)}`,
												)
											}
										>
											<Sparkles className="h-3 w-3" />
											Explore
										</Button>
									</div>
								)}
							</CardContent>
						</Card>
					)}
				</aside>

				{/* Graph canvas */}
				<main ref={containerRef} className="flex-1 relative">
					{loading ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<Network className="h-12 w-12 text-zinc-300 mx-auto animate-pulse" />
								<p className="text-sm text-zinc-500">
									Loading knowledge graph…
								</p>
							</div>
						</div>
					) : graphData.nodes.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<GitBranch className="h-12 w-12 text-zinc-300 mx-auto" />
								<h3 className="text-lg font-medium">No graph data yet</h3>
								<p className="text-sm text-zinc-500 max-w-md">
									The knowledge graph populates automatically after the nightly
									pipeline runs. You can also trigger it manually from the API.
								</p>
							</div>
						</div>
					) : (
						<ForceGraph2D
							ref={graphRef}
							graphData={filteredData()}
							width={dimensions.width}
							height={dimensions.height}
							nodeCanvasObject={paintNode}
							nodePointerAreaPaint={(
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								node: any,
								color: string,
								ctx: CanvasRenderingContext2D,
							) => {
								const n = node as GraphNode;
								const size = n.type === "paper" ? 8 : 6;
								ctx.beginPath();
								ctx.arc(n.x!, n.y!, size, 0, 2 * Math.PI);
								ctx.fillStyle = color;
								ctx.fill();
							}}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							linkColor={(link: any) =>
								EDGE_COLORS[link.type as string] || "#ddd"
							}
							linkWidth={0.5}
							linkDirectionalArrowLength={3}
							linkDirectionalArrowRelPos={1}
							onNodeClick={handleNodeClick}
							cooldownTicks={100}
							d3AlphaDecay={0.02}
							d3VelocityDecay={0.3}
							backgroundColor="transparent"
						/>
					)}

					{/* Node count badge */}
					{!loading && graphData.nodes.length > 0 && (
						<div className="absolute bottom-4 right-4 bg-white dark:bg-zinc-900 rounded-full px-3 py-1.5 shadow-md border text-xs text-zinc-500">
							{filteredData().nodes.length} nodes ·{" "}
							{filteredData().links.length} edges
						</div>
					)}
				</main>
			</div>
		</div>
	);
}
