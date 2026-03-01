"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Search,
	Sparkles,
	BarChart3,
	X,
	Network,
	ZoomIn,
	ZoomOut,
	Scan,
	ExternalLink,
	BookOpen,
	Users,
	Lightbulb,
	ChevronRight,
	Loader2,
	Eye,
	EyeOff,
	RotateCcw,
	MousePointerClick,
	FileText,
	Download,
	Copy,
	Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MermaidRenderer } from "@/components/mermaid-renderer";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
	ssr: false,
});

const API = process.env.NEXT_PUBLIC_API_URL;

/* ── Types ── */
interface GraphNode {
	id: string;
	label: string;
	type: "paper" | "author" | "concept";
	source?: string;
	category?: string;
	date?: string;
	x?: number;
	y?: number;
	__bckgDimRatio?: number;
}

interface GraphEdge {
	source: string | GraphNode;
	target: string | GraphNode;
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

interface NodeDetails {
	id: string;
	type: string;
	title?: string;
	name?: string;
	date?: string;
	source?: string;
	url?: string;
	category?: string;
	authors?: { name: string; institution?: string | null }[];
	concepts?: { name: string; category?: string }[];
	cites?: { id: string; title: string }[];
	cited_by?: { id: string; title: string }[];
	papers?: { id: string; title: string; date?: string }[];
	institutions?: string[];
}

interface SearchResult {
	id: string;
	label: string;
	type: string;
	source?: string;
	category?: string;
}

/* ── Constants ── */
const NODE_COLORS: Record<string, string> = {
	paper: "#3b82f6",
	author: "#a855f7",
	concept: "#10b981",
};

const NODE_COLORS_DIM: Record<string, string> = {
	paper: "#3b82f644",
	author: "#a855f744",
	concept: "#10b98144",
};

const EDGE_COLORS: Record<string, string> = {
	authored: "#a855f7",
	involves: "#10b981",
	cites: "#3b82f6",
};

const CATEGORY_ICONS: Record<string, string> = {
	method: "🔧",
	dataset: "📊",
	theory: "📐",
	task: "🎯",
	technique: "⚡",
};

const TYPE_ICONS = {
	paper: BookOpen,
	author: Users,
	concept: Lightbulb,
};

/* ── Helper ── */
const getEdgeId = (val: string | GraphNode): string =>
	typeof val === "string" ? val : val.id;

export default function GraphPage() {
	const { isLoaded } = useUser();
	const router = useRouter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const graphRef = useRef<any>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	/* ── State ── */
	const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
	const [stats, setStats] = useState<GraphStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const [nodeDetails, setNodeDetails] = useState<NodeDetails | null>(null);
	const [detailsLoading, setDetailsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set());
	const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

	const [hoveredNode, setHoveredNode] = useState<string | null>(null);
	const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
	const [showLabels, setShowLabels] = useState(true);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set());
	const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());

	/* Synthesize-mode state */
	const [selectMode, setSelectMode] = useState(false);
	const [selectedForSynthesis, setSelectedForSynthesis] = useState<Set<string>>(new Set());
	const [synthesisReport, setSynthesisReport] = useState<string | null>(null);
	const [synthesizing, setSynthesizing] = useState(false);
	const [reportOpen, setReportOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	/* ── Resize observer ── */
	useEffect(() => {
		const updateSize = () => {
			if (containerRef.current) {
				const rect = containerRef.current.getBoundingClientRect();
				setDimensions({ width: rect.width, height: Math.max(rect.height, 400) });
			}
		};
		updateSize();
		const observer = new ResizeObserver(updateSize);
		if (containerRef.current) observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [sidebarOpen]);

	/* ── Fetch graph data ── */
	useEffect(() => {
		if (!isLoaded) return;
		const fetchGraph = async () => {
			try {
				const [graphRes, statsRes] = await Promise.all([
					fetch(`${API}/graph/explore?limit=300`),
					fetch(`${API}/graph/stats`),
				]);
				if (graphRes.ok) {
					const data = await graphRes.json();
					setGraphData({ nodes: data.nodes || [], edges: data.edges || [] });
				}
				if (statsRes.ok) setStats(await statsRes.json());
			} catch (error) {
				console.error("Failed to fetch graph:", error);
			} finally {
				setLoading(false);
			}
		};
		fetchGraph();
	}, [isLoaded]);

	/* ── Search debounce ── */
	useEffect(() => {
		if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
		if (!searchQuery.trim()) {
			setSearchResults([]);
			setSearchOpen(false);
			return;
		}
		searchTimeoutRef.current = setTimeout(async () => {
			try {
				const res = await fetch(`${API}/graph/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
				if (res.ok) {
					const data = await res.json();
					setSearchResults(data.results || []);
					setSearchOpen(true);
				}
			} catch { /* ignore */ }
		}, 300);
		return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
	}, [searchQuery]);

	/* ── Node details fetch ── */
	const fetchNodeDetails = useCallback(async (node: GraphNode) => {
		setDetailsLoading(true);
		setNodeDetails(null);
		try {
			const res = await fetch(`${API}/graph/node/${encodeURIComponent(node.id)}?node_type=${node.type}`);
			if (res.ok) setNodeDetails(await res.json());
		} catch { /* ignore */ }
		setDetailsLoading(false);
	}, []);

	/* ── Highlight neighbors on hover ── */
	const getNeighborIds = useCallback((nodeId: string): Set<string> => {
		const ids = new Set<string>([nodeId]);
		graphData.edges.forEach((e) => {
			const src = getEdgeId(e.source);
			const tgt = getEdgeId(e.target);
			if (src === nodeId) ids.add(tgt);
			if (tgt === nodeId) ids.add(src);
		});
		return ids;
	}, [graphData.edges]);

	const handleNodeHover = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any) => {
			if (node) {
				setHoveredNode(node.id);
				setHighlightNodes(getNeighborIds(node.id));
			} else {
				setHoveredNode(null);
				setHighlightNodes(new Set());
			}
		},
		[getNeighborIds],
	);

	/* ── Click handlers ── */
	const handleNodeClick = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any) => {
			const gn = node as GraphNode;

			// Select-mode: toggle in selection set instead of opening detail panel
			if (selectMode) {
				setSelectedForSynthesis((prev) => {
					const next = new Set(prev);
					if (next.has(gn.id)) next.delete(gn.id);
					else next.add(gn.id);
					return next;
				});
				return;
			}

			setSelectedNode(gn);
			fetchNodeDetails(gn);
			if (graphRef.current) {
				graphRef.current.centerAt(node.x, node.y, 800);
				graphRef.current.zoom(4, 800);
			}
		},
		[fetchNodeDetails, selectMode],
	);

	const handleSearchSelect = useCallback(
		(result: SearchResult) => {
			setSearchQuery("");
			setSearchOpen(false);
			// Find the node in graph data
			const node = graphData.nodes.find((n) => n.id === result.id);
			if (node) {
				handleNodeClick(node);
			} else {
				// Node might not be in current view — create a temporary one
				setSelectedNode({
					id: result.id,
					label: result.label,
					type: result.type as "paper" | "author" | "concept",
					source: result.source,
					category: result.category,
				});
				fetchNodeDetails({
					id: result.id,
					label: result.label,
					type: result.type as "paper" | "author" | "concept",
				});
			}
		},
		[graphData.nodes, handleNodeClick, fetchNodeDetails],
	);

	/* ── Graph controls ── */
	const handleZoomIn = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 400);
	const handleZoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 400);
	const handleReset = () => {
		graphRef.current?.zoomToFit(400, 60);
		setSelectedNode(null);
		setNodeDetails(null);
	};

	/* ── Synthesize controls ── */
	const toggleSelectMode = useCallback(() => {
		setSelectMode((prev) => {
			if (prev) setSelectedForSynthesis(new Set()); // exiting: clear selection
			return !prev;
		});
	}, []);

	const handleSynthesize = useCallback(async () => {
		if (selectedForSynthesis.size === 0) return;
		setSynthesizing(true);
		setReportOpen(true);
		setSynthesisReport(null);
		try {
			const res = await fetch(`${API}/graph/synthesize`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ node_ids: Array.from(selectedForSynthesis) }),
			});
			if (res.ok) {
				const data = await res.json();
				setSynthesisReport(data.markdown);
			} else {
				setSynthesisReport("Error generating report. Please try again.");
			}
		} catch {
			setSynthesisReport("Network error. Please check your connection.");
		}
		setSynthesizing(false);
	}, [selectedForSynthesis]);

	const handleCopyReport = useCallback(() => {
		if (!synthesisReport) return;
		navigator.clipboard.writeText(synthesisReport);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [synthesisReport]);

	const handleDownloadReport = useCallback(() => {
		if (!synthesisReport) return;
		const blob = new Blob([synthesisReport], { type: "text/markdown" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "literature-review.md";
		a.click();
		URL.revokeObjectURL(url);
	}, [synthesisReport]);

	/* ── Toggle helpers ── */
	const toggleNodeType = useCallback((type: string) => {
		setHiddenNodeTypes((prev) => {
			const next = new Set(prev);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			return next;
		});
	}, []);

	const toggleEdgeType = useCallback((type: string) => {
		setHiddenEdgeTypes((prev) => {
			const next = new Set(prev);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			return next;
		});
	}, []);

	const toggleHiddenNode = useCallback((nodeId: string) => {
		setHiddenNodes((prev) => {
			const next = new Set(prev);
			if (next.has(nodeId)) next.delete(nodeId);
			else next.add(nodeId);
			return next;
		});
		// If the hidden node is currently selected, deselect it
		setSelectedNode((sel) => (sel?.id === nodeId ? null : sel));
		setNodeDetails((det) => (det?.id === nodeId ? null : det));
	}, []);

	const clearHiddenNodes = useCallback(() => setHiddenNodes(new Set()), []);

	const hasActiveFilters = hiddenNodeTypes.size > 0 || hiddenEdgeTypes.size > 0 || hiddenNodes.size > 0;

	/* ── Filtered data ── */
	const filteredData = useMemo(() => {
		let nodes = graphData.nodes;
		let edges = graphData.edges;

		// Node-type filter (multi-toggle)
		if (hiddenNodeTypes.size > 0) {
			nodes = nodes.filter((n) => !hiddenNodeTypes.has(n.type));
		}

		// Hidden individual nodes
		if (hiddenNodes.size > 0) {
			nodes = nodes.filter((n) => !hiddenNodes.has(n.id));
		}

		// Ensure edges connect visible nodes only
		const nodeIds = new Set(nodes.map((n) => n.id));
		edges = edges.filter(
			(e) => nodeIds.has(getEdgeId(e.source)) && nodeIds.has(getEdgeId(e.target)),
		);

		// Hidden edge types
		if (hiddenEdgeTypes.size > 0) {
			edges = edges.filter((e) => !hiddenEdgeTypes.has(e.type));
		}

		return { nodes, links: edges };
	}, [graphData, hiddenNodeTypes, hiddenNodes, hiddenEdgeTypes]);

	/* ── Canvas painting ── */
	const paintNode = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const n = node as GraphNode;
			const isSelected = selectedNode?.id === n.id;
			const isHovered = hoveredNode === n.id;
			const isDimmed = hoveredNode && !highlightNodes.has(n.id);
			const isMarkedForSynthesis = selectMode && selectedForSynthesis.has(n.id);

			const baseSize = n.type === "paper" ? 5 : n.type === "author" ? 4 : 3.5;
			const size = isSelected ? baseSize * 2 : isHovered ? baseSize * 1.6 : isMarkedForSynthesis ? baseSize * 1.4 : baseSize;

			// Glow effect
			if (isSelected || isHovered) {
				ctx.beginPath();
				ctx.arc(node.x!, node.y!, size + 4, 0, 2 * Math.PI);
				const gradient = ctx.createRadialGradient(
					node.x!, node.y!, size,
					node.x!, node.y!, size + 4,
				);
				const color = NODE_COLORS[n.type] || "#666";
				gradient.addColorStop(0, color + "60");
				gradient.addColorStop(1, color + "00");
				ctx.fillStyle = gradient;
				ctx.fill();
			}

			// Node circle
			ctx.beginPath();
			ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
			ctx.fillStyle = isDimmed
				? (NODE_COLORS_DIM[n.type] || "#66666644")
				: (NODE_COLORS[n.type] || "#666");
			ctx.fill();

			// Selected ring
			if (isSelected) {
				ctx.strokeStyle = "#fff";
				ctx.lineWidth = 2 / globalScale;
				ctx.stroke();
			}

			// Synthesis selection indicator — pulsing dashed ring
			if (isMarkedForSynthesis) {
				ctx.beginPath();
				ctx.arc(node.x!, node.y!, size + 3, 0, 2 * Math.PI);
				ctx.strokeStyle = "#f59e0b";
				ctx.lineWidth = 2 / globalScale;
				ctx.setLineDash([3 / globalScale, 2 / globalScale]);
				ctx.stroke();
				ctx.setLineDash([]);

				// Small checkmark dot
				ctx.beginPath();
				ctx.arc(node.x! + size + 1, node.y! - size - 1, 2.5, 0, 2 * Math.PI);
				ctx.fillStyle = "#f59e0b";
				ctx.fill();
			}

			// Labels
			if (showLabels && (globalScale > 1.5 || isSelected || isHovered)) {
				const label = n.label || n.id;
				const maxLen = isSelected || isHovered ? 50 : 25;
				const displayLabel = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
				const fontSize = Math.max((isSelected || isHovered ? 12 : 10) / globalScale, 1.5);
				ctx.font = `${isSelected || isHovered ? "600" : "400"} ${fontSize}px Inter, system-ui, sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";

				// Text background
				const textWidth = ctx.measureText(displayLabel).width;
				const padding = 2 / globalScale;
				const isDark = document.documentElement.classList.contains("dark");
				ctx.fillStyle = isDark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
				ctx.fillRect(
					node.x! - textWidth / 2 - padding,
					node.y! + size + 1,
					textWidth + padding * 2,
					fontSize + padding * 2,
				);

				ctx.fillStyle = isDimmed
					? "#99999944"
					: isDark ? "#e4e4e7" : "#27272a";
				ctx.fillText(displayLabel, node.x!, node.y! + size + 1 + padding);
			}
		},
		[selectedNode, hoveredNode, highlightNodes, showLabels, selectMode, selectedForSynthesis],
	);

	/* ── Render ── */
	if (!isLoaded) return null;

	const TypeIcon = (type: string) => TYPE_ICONS[type as keyof typeof TYPE_ICONS] || BookOpen;

	return (
		<div className="flex flex-col bg-zinc-50 dark:bg-black h-screen">
			{/* Header */}
			<header className="border-b bg-white dark:bg-zinc-950 px-4 sm:px-6 py-3 flex justify-between items-center shrink-0 z-20">
				<div className="flex items-center gap-4 sm:gap-6">
					<h1 className="text-xl font-bold tracking-tight">PaperPulse</h1>
					<nav className="hidden sm:flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
						<Link href="/feed" className="hover:text-black dark:hover:text-white transition">Daily Feed</Link>
						<Link href="/saved" className="hover:text-black dark:hover:text-white transition">Saved</Link>
						<Link href="/ask" className="hover:text-black dark:hover:text-white transition">Ask AI</Link>
						<Link href="/graph" className="text-black dark:text-white">Knowledge Graph</Link>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					{/* Search */}
					<div className="relative">
						<div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 rounded-lg px-3 py-1.5 border border-transparent focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition">
							<Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
							<input
								ref={searchInputRef}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
								placeholder="Search papers, authors, concepts…"
								className="w-48 sm:w-64 bg-transparent text-sm placeholder:text-zinc-400 focus:outline-none"
							/>
							{searchQuery && (
								<button onClick={() => { setSearchQuery(""); setSearchOpen(false); }}>
									<X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-600" />
								</button>
							)}
						</div>
						{/* Search dropdown */}
						{searchOpen && searchResults.length > 0 && (
							<div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border rounded-lg shadow-xl overflow-hidden z-50 max-h-72 overflow-y-auto">
								{searchResults.map((r) => {
									const Icon = TypeIcon(r.type);
									return (
										<button
											key={r.id}
											onClick={() => handleSearchSelect(r)}
											className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2.5 transition"
										>
											<div
												className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
												style={{ backgroundColor: NODE_COLORS[r.type] + "20" }}
											>
												<Icon className="h-3.5 w-3.5" style={{ color: NODE_COLORS[r.type] }} />
											</div>
											<div className="min-w-0">
												<p className="text-sm font-medium truncate">{r.label}</p>
												<p className="text-[10px] text-zinc-400 capitalize">{r.type}{r.category ? ` · ${r.category}` : ""}</p>
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>
					<UserButton />
				</div>
			</header>

			{/* Body */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* ── Sidebar ── */}
				{sidebarOpen && (
					<aside className="w-72 border-r bg-white dark:bg-zinc-950 flex flex-col overflow-y-auto shrink-0">
						<div className="p-4 space-y-4">
							{/* Stats */}
							{stats && (
								<div>
									<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5">
										<BarChart3 className="h-3 w-3" />
										Knowledge Graph
									</h3>
									<div className="grid grid-cols-3 gap-1.5">
										{[
											{ n: stats.papers, l: "Papers", c: NODE_COLORS.paper },
											{ n: stats.authors, l: "Authors", c: NODE_COLORS.author },
											{ n: stats.concepts, l: "Concepts", c: NODE_COLORS.concept },
										].map(({ n, l, c }) => (
											<div key={l} className="text-center p-2 rounded-lg" style={{ backgroundColor: c + "10" }}>
												<p className="text-lg font-bold" style={{ color: c }}>{n}</p>
												<p className="text-[9px] text-zinc-500">{l}</p>
											</div>
										))}
									</div>
									<div className="grid grid-cols-2 gap-1.5 mt-1.5">
										<div className="text-center p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900">
											<p className="text-sm font-bold text-zinc-600 dark:text-zinc-300">{stats.citations}</p>
											<p className="text-[9px] text-zinc-500">Citations</p>
										</div>
										<div className="text-center p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900">
											<p className="text-sm font-bold text-zinc-600 dark:text-zinc-300">{stats.authorships}</p>
											<p className="text-[9px] text-zinc-500">Authorships</p>
										</div>
									</div>
								</div>
							)}

							{/* Filter Nodes */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									Filter Nodes
								</h3>
								<div className="space-y-0.5">
									{[
										{ type: "paper", label: "Papers", count: graphData.nodes.filter((n) => n.type === "paper").length },
										{ type: "author", label: "Authors", count: graphData.nodes.filter((n) => n.type === "author").length },
										{ type: "concept", label: "Concepts", count: graphData.nodes.filter((n) => n.type === "concept").length },
									].map(({ type, label, count }) => {
										const hidden = hiddenNodeTypes.has(type);
										return (
											<button
												key={type}
												onClick={() => toggleNodeType(type)}
												className={`w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded-md transition ${
													hidden
														? "text-zinc-400 bg-zinc-50 dark:bg-zinc-900 line-through opacity-60"
														: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
												}`}
											>
												<span className={`w-3 h-3 rounded-full shrink-0 ${hidden ? "opacity-30" : ""}`} style={{ backgroundColor: NODE_COLORS[type] }} />
												<span className="flex-1 text-left">{label}</span>
												<span className="text-[10px] opacity-50">{count}</span>
												{hidden ? <EyeOff className="h-3 w-3 shrink-0" /> : <Eye className="h-3 w-3 shrink-0 opacity-40" />}
											</button>
										);
									})}
								</div>
							</div>

							{/* Filter Edges */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									Filter Edges
								</h3>
								<div className="space-y-0.5">
									{[
										{ type: "cites", label: "Citations", arrow: true },
										{ type: "authored", label: "Authorships" },
										{ type: "involves", label: "Concept links" },
									].map(({ type, label, arrow }) => {
										const hidden = hiddenEdgeTypes.has(type);
										return (
											<button
												key={type}
												onClick={() => toggleEdgeType(type)}
												className={`w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded-md transition ${
													hidden
														? "text-zinc-400 bg-zinc-50 dark:bg-zinc-900 line-through opacity-60"
														: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
												}`}
											>
												<span className={`w-4 h-0.5 inline-block rounded relative shrink-0 ${hidden ? "opacity-30" : ""}`} style={{ backgroundColor: EDGE_COLORS[type] }}>
													{arrow && <span className="absolute -right-1 top-1/2 -translate-y-1/2 w-0 h-0 border-y-[3px] border-y-transparent border-l-[4px]" style={{ borderLeftColor: EDGE_COLORS[type] }} />}
												</span>
												<span className="flex-1 text-left">{label}</span>
												{hidden ? <EyeOff className="h-3 w-3 shrink-0" /> : <Eye className="h-3 w-3 shrink-0 opacity-40" />}
											</button>
										);
									})}
								</div>
							</div>

							{/* Hidden Nodes */}
							{hiddenNodes.size > 0 && (
								<div>
									<div className="flex items-center justify-between mb-2">
										<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 flex items-center gap-1">
											<EyeOff className="h-3 w-3" />
											Hidden ({hiddenNodes.size})
										</h3>
										<button
											onClick={clearHiddenNodes}
											className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5 transition"
										>
											<RotateCcw className="h-2.5 w-2.5" />
											Show all
										</button>
									</div>
									<div className="space-y-0.5 max-h-32 overflow-y-auto">
										{Array.from(hiddenNodes).map((id) => {
											const node = graphData.nodes.find((n) => n.id === id);
											return (
												<button
													key={id}
													onClick={() => toggleHiddenNode(id)}
													className="w-full flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 py-1 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition group"
												>
													<span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[node?.type || "paper"] + "60" }} />
													<span className="truncate flex-1 text-left">{node?.label || id}</span>
													<Eye className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover:opacity-100 transition" />
												</button>
											);
										})}
									</div>
								</div>
							)}

							{/* Legend */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									Legend
								</h3>
								<div className="space-y-1">
									{(["paper", "author", "concept"] as const).map((type) => {
										const Icon = TYPE_ICONS[type];
										return (
											<div key={type} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
												<span className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS[type] }} />
												<Icon className="h-3 w-3 opacity-50" />
												<span className="capitalize">{type}</span>
											</div>
										);
									})}
								</div>
							</div>

							{/* View Options */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									View
								</h3>
								<div className="flex flex-col gap-1">
									<button
										onClick={() => setShowLabels((p) => !p)}
										className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition py-1"
									>
										{showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
										{showLabels ? "Hide" : "Show"} Labels
									</button>
								</div>
							</div>
						</div>
					</aside>
				)}

				{/* ── Graph Canvas ── */}
				<main ref={containerRef} className="flex-1 relative min-h-0 min-w-0">
					{/* Toggle sidebar */}
					<button
						onClick={() => setSidebarOpen((p) => !p)}
						className="absolute top-3 left-3 z-10 bg-white dark:bg-zinc-900 rounded-lg p-1.5 border shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
						title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
					>
						<ChevronRight className={`h-4 w-4 transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
					</button>

					{/* Graph controls — positioned to dodge the detail panel */}
					<div className={`absolute top-3 z-30 flex items-center gap-1.5 transition-all ${selectedNode ? "right-[21rem]" : "right-3"}`}>
						{/* Synthesize mode toggle */}
						<button
							onClick={toggleSelectMode}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border shadow-sm text-xs font-medium transition ${
								selectMode
									? "bg-amber-500 text-white border-amber-600 shadow-amber-200 dark:shadow-amber-900"
									: "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
							}`}
							title={selectMode ? "Exit select mode" : "Select papers to synthesize"}
						>
							<MousePointerClick className="h-3.5 w-3.5" />
							{selectMode ? "Selecting…" : "Synthesize"}
						</button>

						<div className="bg-white dark:bg-zinc-900 rounded-lg border shadow-sm flex items-center">
							<button onClick={handleZoomIn} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-l-lg transition" title="Zoom in">
								<ZoomIn className="h-4 w-4" />
							</button>
							<button onClick={handleZoomOut} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" title="Zoom out">
								<ZoomOut className="h-4 w-4" />
							</button>
							<button onClick={handleReset} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-r-lg transition" title="Fit to view">
								<Scan className="h-4 w-4" />
							</button>
						</div>
					</div>

					{loading ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<Network className="h-12 w-12 text-zinc-300 mx-auto animate-pulse" />
								<p className="text-sm text-zinc-500">Loading knowledge graph…</p>
							</div>
						</div>
					) : graphData.nodes.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<Network className="h-12 w-12 text-zinc-300 mx-auto" />
								<h3 className="text-lg font-medium">No graph data yet</h3>
								<p className="text-sm text-zinc-500 max-w-md">
									The knowledge graph populates after the pipeline runs.
									You can also trigger it manually via the API.
								</p>
							</div>
						</div>
					) : (
						<ForceGraph2D
							ref={graphRef}
							graphData={filteredData}
							width={dimensions.width}
							height={dimensions.height}
							nodeCanvasObject={paintNode}
							nodePointerAreaPaint={(
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								node: any,
								color: string,
								ctx: CanvasRenderingContext2D,
							) => {
								const size = (node as GraphNode).type === "paper" ? 8 : 6;
								ctx.beginPath();
								ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
								ctx.fillStyle = color;
								ctx.fill();
							}}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							linkColor={(link: any) => {
								if (!hoveredNode) return EDGE_COLORS[link.type as string] || "#ddd";
								const src = getEdgeId(link.source);
								const tgt = getEdgeId(link.target);
								if (highlightNodes.has(src) && highlightNodes.has(tgt)) {
									return EDGE_COLORS[link.type as string] || "#ddd";
								}
								return "#33333322";
							}}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							linkWidth={(link: any) => {
								if (!hoveredNode) return 0.5;
								const src = getEdgeId(link.source);
								const tgt = getEdgeId(link.target);
								return (highlightNodes.has(src) && highlightNodes.has(tgt)) ? 1.5 : 0.2;
							}}
							linkDirectionalArrowLength={3}
							linkDirectionalArrowRelPos={1}
							linkDirectionalParticles={hoveredNode ? 2 : 0}
							linkDirectionalParticleWidth={2}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							linkDirectionalParticleColor={(link: any) => EDGE_COLORS[link.type as string] || "#999"}
							onNodeClick={handleNodeClick}
							onNodeHover={handleNodeHover}
							onBackgroundClick={() => {
								setSelectedNode(null);
								setNodeDetails(null);
								setHoveredNode(null);
								setHighlightNodes(new Set());
							}}
							cooldownTicks={150}
							d3AlphaDecay={0.015}
							d3VelocityDecay={0.25}
							backgroundColor="transparent"
							enableNodeDrag={true}
						/>
					)}

					{/* Node count */}
					{!loading && graphData.nodes.length > 0 && (
						<div className="absolute bottom-3 left-3 bg-white/90 dark:bg-zinc-900/90 backdrop-blur rounded-full px-3 py-1.5 shadow border text-xs text-zinc-500 flex items-center gap-2">
							<Network className="h-3 w-3" />
							{filteredData.nodes.length} nodes · {filteredData.links.length} edges
							{hasActiveFilters && (
								<button
									onClick={() => { setHiddenNodes(new Set()); setHiddenEdgeTypes(new Set()); setHiddenNodeTypes(new Set()); }}
									className="ml-1 flex items-center gap-0.5 text-blue-500 hover:text-blue-600 transition"
									title="Clear all filters"
								>
									<RotateCcw className="h-2.5 w-2.5" />
									Reset
								</button>
							)}
						</div>
					)}

					{/* ── Synthesis selection bar ── */}
					{selectMode && (
						<div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-2.5 shadow-lg shadow-amber-100 dark:shadow-amber-900/20">
							<div className="flex items-center gap-2">
								<div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
									<MousePointerClick className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
								</div>
								<p className="text-sm font-medium">
									{selectedForSynthesis.size === 0
										? "Click nodes to select"
										: <><span className="text-amber-600 dark:text-amber-400 font-bold">{selectedForSynthesis.size}</span> selected</>}
								</p>
							</div>

							{selectedForSynthesis.size > 0 && (
								<>
									<button
										onClick={() => setSelectedForSynthesis(new Set())}
										className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
									>
										Clear
									</button>
									<Button
										onClick={handleSynthesize}
										disabled={synthesizing}
										size="sm"
										className="h-8 bg-amber-500 hover:bg-amber-600 text-white gap-1.5 rounded-lg shadow-sm"
									>
										{synthesizing ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<FileText className="h-3.5 w-3.5" />
										)}
										Synthesize Report
									</Button>
								</>
							)}

							<button onClick={toggleSelectMode} className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" title="Exit select mode">
								<X className="h-4 w-4 text-zinc-400" />
							</button>
						</div>
					)}

					{/* ── Detail Panel ── */}
					{selectedNode && (
						<div className="absolute top-0 right-0 w-80 h-full bg-white dark:bg-zinc-950 border-l shadow-xl overflow-y-auto z-20">
							<div className="p-4 space-y-4">
								{/* Header */}
								<div className="flex items-start justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<div
											className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
											style={{ backgroundColor: NODE_COLORS[selectedNode.type] + "20" }}
										>
											{(() => {
												const Icon = TypeIcon(selectedNode.type);
												return <Icon className="h-4 w-4" style={{ color: NODE_COLORS[selectedNode.type] }} />;
											})()}
										</div>
										<div className="min-w-0">
											<Badge
												className="text-[9px] px-1.5 py-0 mb-1"
												style={{ backgroundColor: NODE_COLORS[selectedNode.type], color: "#fff" }}
											>
												{selectedNode.type}
												{selectedNode.category && ` · ${selectedNode.category}`}
											</Badge>
										</div>
									</div>
<div className="flex items-center gap-0.5 shrink-0">
									<button
										onClick={() => toggleHiddenNode(selectedNode.id)}
										className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
										title="Hide this node"
									>
										<EyeOff className="h-3.5 w-3.5 text-zinc-400" />
									</button>
									<button
										onClick={() => { setSelectedNode(null); setNodeDetails(null); }}
										className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
									>
										<X className="h-4 w-4 text-zinc-400" />
									</button>
								</div>
								</div>

								<h3 className="text-sm font-semibold leading-snug">
									{selectedNode.label}
								</h3>

								{detailsLoading && (
									<div className="flex items-center gap-2 py-4 text-zinc-400 text-sm">
										<Loader2 className="h-4 w-4 animate-spin" />
										Loading details…
									</div>
								)}

								{nodeDetails && (
									<>
										{/* Paper details */}
										{nodeDetails.type === "paper" && (
											<div className="space-y-3">
												{nodeDetails.date && (
													<p className="text-xs text-zinc-500">
														Published {new Date(nodeDetails.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
														{nodeDetails.source && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 text-[10px]">{nodeDetails.source}</span>}
													</p>
												)}

												{/* Actions */}
												<div className="flex gap-1.5">
													<Button
														variant="outline"
														size="sm"
														className="h-7 text-xs gap-1 text-purple-600"
														onClick={() => router.push(`/ask?paper=${encodeURIComponent(nodeDetails.id)}`)}
													>
														<Sparkles className="h-3 w-3" />
														Explore with AI
													</Button>
													{nodeDetails.url && (
														<a href={nodeDetails.url} target="_blank" rel="noopener noreferrer">
															<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
																<ExternalLink className="h-3 w-3" />
																Paper
															</Button>
														</a>
													)}
												</div>

												{/* Authors */}
												{nodeDetails.authors && nodeDetails.authors.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															Authors ({nodeDetails.authors.length})
														</p>
														<div className="space-y-1">
															{nodeDetails.authors.map((a, i) => (
																<div key={i} className="flex items-center gap-1.5 text-xs">
																	<Users className="h-3 w-3 shrink-0" style={{ color: NODE_COLORS.author }} />
																	<span className="font-medium">{a.name}</span>
																	{a.institution && <span className="text-zinc-400 text-[10px]">· {a.institution}</span>}
																</div>
															))}
														</div>
													</div>
												)}

												{/* Concepts */}
												{nodeDetails.concepts && nodeDetails.concepts.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															Concepts ({nodeDetails.concepts.length})
														</p>
														<div className="flex flex-wrap gap-1">
															{nodeDetails.concepts.map((c, i) => (
																<span
																	key={i}
																	className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
																>
																	{c.category && <span>{CATEGORY_ICONS[c.category]}</span>}
																	<span>{c.name}</span>
																</span>
															))}
														</div>
													</div>
												)}

												{/* Citations */}
												{nodeDetails.cites && nodeDetails.cites.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															References ({nodeDetails.cites.length})
														</p>
														<div className="space-y-1 max-h-32 overflow-y-auto">
															{nodeDetails.cites.map((c, i) => (
																<div key={i} className="flex items-center gap-1 group/ref">
																	<button
																		onClick={() => {
																			const node = graphData.nodes.find((n) => n.id === c.id);
																			if (node) handleNodeClick(node);
																		}}
																		className="flex-1 text-left text-xs text-blue-600 hover:text-blue-700 hover:underline line-clamp-1"
																	>
																		{c.title || c.id}
																	</button>
																	<button
																		onClick={(e) => { e.stopPropagation(); toggleHiddenNode(c.id); }}
																		className="opacity-0 group-hover/ref:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition shrink-0"
																		title="Hide this paper"
																	>
																		<EyeOff className="h-2.5 w-2.5 text-zinc-400" />
																	</button>
																</div>
															))}
														</div>
													</div>
												)}

												{/* Cited by */}
												{nodeDetails.cited_by && nodeDetails.cited_by.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															Cited By ({nodeDetails.cited_by.length})
														</p>
														<div className="space-y-1 max-h-32 overflow-y-auto">
															{nodeDetails.cited_by.map((c, i) => (
																<div key={i} className="flex items-center gap-1 group/citedby">
																	<button
																		onClick={() => {
																			const node = graphData.nodes.find((n) => n.id === c.id);
																			if (node) handleNodeClick(node);
																		}}
																		className="flex-1 text-left text-xs text-blue-600 hover:text-blue-700 hover:underline line-clamp-1"
																	>
																		{c.title || c.id}
																	</button>
																	<button
																		onClick={(e) => { e.stopPropagation(); toggleHiddenNode(c.id); }}
																		className="opacity-0 group-hover/citedby:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition shrink-0"
																		title="Hide this paper"
																	>
																		<EyeOff className="h-2.5 w-2.5 text-zinc-400" />
																	</button>
																</div>
															))}
														</div>
													</div>
												)}
											</div>
										)}

										{/* Author details */}
										{nodeDetails.type === "author" && (
											<div className="space-y-3">
												{nodeDetails.institutions && nodeDetails.institutions.length > 0 && (
													<div className="flex flex-wrap gap-1">
														{nodeDetails.institutions.map((inst, i) => (
															<span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
																🏛️ {inst}
															</span>
														))}
													</div>
												)}
												{nodeDetails.papers && nodeDetails.papers.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															Papers ({nodeDetails.papers.length})
														</p>
														<div className="space-y-1.5 max-h-64 overflow-y-auto">
															{nodeDetails.papers.map((p, i) => (
																<div key={i} className="relative group/apaper">
																	<button
																		onClick={() => {
																			const node = graphData.nodes.find((n) => n.id === p.id);
																			if (node) handleNodeClick(node);
																		}}
																		className="w-full text-left p-2 rounded-md bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
																	>
																		<p className="text-xs font-medium line-clamp-2 pr-5">{p.title || p.id}</p>
																		{p.date && <p className="text-[10px] text-zinc-400 mt-0.5">{p.date}</p>}
																	</button>
																	<button
																		onClick={(e) => { e.stopPropagation(); toggleHiddenNode(p.id); }}
																		className="absolute top-2 right-2 opacity-0 group-hover/apaper:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
																		title="Hide this paper"
																	>
																		<EyeOff className="h-2.5 w-2.5 text-zinc-400" />
																	</button>
																</div>
															))}
														</div>
													</div>
												)}
											</div>
										)}

										{/* Concept details */}
										{nodeDetails.type === "concept" && (
											<div className="space-y-3">
												{nodeDetails.category && (
													<div className="flex items-center gap-2">
														<span className="text-sm">{CATEGORY_ICONS[nodeDetails.category] || "📌"}</span>
														<span className="text-xs text-zinc-500 capitalize">{nodeDetails.category}</span>
													</div>
												)}
												{nodeDetails.papers && nodeDetails.papers.length > 0 && (
													<div>
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
															Papers using this concept ({nodeDetails.papers.length})
														</p>
														<div className="space-y-1.5 max-h-80 overflow-y-auto">
															{nodeDetails.papers.map((p, i) => (
																<div key={i} className="relative group/cpaper">
																	<button
																		onClick={() => {
																			const node = graphData.nodes.find((n) => n.id === p.id);
																			if (node) handleNodeClick(node);
																		}}
																		className="w-full text-left p-2 rounded-md bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
																	>
																		<p className="text-xs font-medium line-clamp-2 pr-5">{p.title || p.id}</p>
																		{p.date && <p className="text-[10px] text-zinc-400 mt-0.5">{p.date}</p>}
																	</button>
																	<button
																		onClick={(e) => { e.stopPropagation(); toggleHiddenNode(p.id); }}
																		className="absolute top-2 right-2 opacity-0 group-hover/cpaper:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
																		title="Hide this paper"
																	>
																		<EyeOff className="h-2.5 w-2.5 text-zinc-400" />
																	</button>
																</div>
															))}
														</div>
													</div>
												)}
											</div>
										)}
									</>
								)}
							</div>
						</div>
					)}
				</main>

				{/* ── Synthesis Report Panel ── */}
				{reportOpen && (
					<div className="fixed inset-0 z-50 flex justify-end">
						{/* Backdrop */}
						<div
							className="absolute inset-0 bg-black/30 backdrop-blur-sm"
							onClick={() => setReportOpen(false)}
						/>
						{/* Panel */}
						<div className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 h-full shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-300">
							{/* Panel header */}
							<div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
								<div className="flex items-center gap-3">
									<div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
										<FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
									</div>
									<div>
										<h2 className="text-lg font-semibold">Literature Review</h2>
										<p className="text-xs text-zinc-500">
											{selectedForSynthesis.size} papers analyzed
										</p>
									</div>
								</div>
								<div className="flex items-center gap-1.5">
									{synthesisReport && (
										<>
											<button
												onClick={handleCopyReport}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
												title="Copy as Markdown"
											>
												{copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
												{copied ? "Copied" : "Copy"}
											</button>
											<button
												onClick={handleDownloadReport}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
												title="Download as .md file"
											>
												<Download className="h-3.5 w-3.5" />
												Download
											</button>
										</>
									)}
									<button
										onClick={() => setReportOpen(false)}
										className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
									>
										<X className="h-4 w-4" />
									</button>
								</div>
							</div>

							{/* Panel content */}
							<div className="flex-1 overflow-y-auto">
								{synthesizing ? (
									<div className="p-8 space-y-6">
										<div className="flex items-center gap-3 text-zinc-500">
											<Loader2 className="h-5 w-5 animate-spin text-amber-500" />
											<p className="text-sm font-medium">Analyzing papers and generating review…</p>
										</div>
										{/* Skeleton shimmer */}
										<div className="space-y-4 animate-pulse">
											<div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3" />
											<div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded-lg w-full mt-6" />
											<div className="h-32 bg-zinc-100 dark:bg-zinc-900 rounded-lg w-full border" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full mt-4" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-4/5" />
											<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
										</div>
									</div>
								) : synthesisReport ? (
									<div className="p-6">
										<article className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
											<ReactMarkdown
												components={{
													code({ className, children, ...props }) {
														const match = /language-(\w+)/.exec(className || "");
														const codeStr = String(children).replace(/\n$/, "");

														if (match?.[1] === "mermaid") {
															return <MermaidRenderer code={codeStr} />;
														}

														// Inline code
														if (!match) {
															return (
																<code className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono" {...props}>
																	{children}
																</code>
															);
														}

														// Block code (non-mermaid)
														return (
															<pre className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-4 overflow-x-auto">
																<code className={`${className} text-xs font-mono`} {...props}>
																	{children}
																</code>
															</pre>
														);
													},
												}}
											>
												{synthesisReport}
											</ReactMarkdown>
										</article>
									</div>
								) : null}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
