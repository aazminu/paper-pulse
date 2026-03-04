"use client";

import {
	useEffect,
	useState,
	useRef,
	useCallback,
	useMemo,
	Suspense,
} from "react";
import { useAuth } from "@/components/auth-provider";
import Navbar from "@/components/navbar";
import { useRouter, useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/api";
import { PageLoader, RedirectLoader } from "@/components/page-loader";
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
	Camera,
	Layers,
	Trash2,
	Clock,
	ChevronDown,
	BookMarked,
	Save,
	GraduationCap,
	List,
	Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MermaidRenderer } from "@/components/mermaid-renderer";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
	ssr: false,
});

const API = process.env.NEXT_PUBLIC_API_URL;

/* Types */
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

interface Cluster {
	id: number;
	label: string;
	paper_ids: string[];
	size: number;
	top_concepts: string[];
}

interface SavedReport {
	id: string;
	title: string;
	markdown: string;
	node_ids: string[];
	paper_count: number;
	citation_count: number;
	created_at: string;
}

/* Constants */
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

/* Helper */
const getEdgeId = (val: string | GraphNode): string =>
	typeof val === "string" ? val : val.id;

export default function GraphPage() {
	return (
		<Suspense>
			<GraphPageContent />
		</Suspense>
	);
}

function GraphPageContent() {
	const { isLoaded, user } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const graphRef = useRef<any>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const deepLinkHandled = useRef(false);

	/* State */
	const [graphData, setGraphData] = useState<GraphData>({
		nodes: [],
		edges: [],
	});
	const [stats, setStats] = useState<GraphStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const [nodeDetails, setNodeDetails] = useState<NodeDetails | null>(null);
	const [detailsLoading, setDetailsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(
		new Set(),
	);
	const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

	const [hoveredNode, setHoveredNode] = useState<string | null>(null);
	const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
	const [showLabels, setShowLabels] = useState(true);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(
		new Set(),
	);
	const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());

	/* Synthesize-mode state */
	const [selectMode, setSelectMode] = useState(false);
	const [selectedForSynthesis, setSelectedForSynthesis] = useState<Set<string>>(
		new Set(),
	);
	const [synthesisReport, setSynthesisReport] = useState<string | null>(null);
	const [synthesizing, setSynthesizing] = useState(false);
	const [reportOpen, setReportOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [reportMode, setReportMode] = useState<
		"quick" | "publication" | "agent"
	>("quick");
	const [bibtexData, setBibtexData] = useState<string | null>(null);
	const [tocOpen, setTocOpen] = useState(false);

	/* Agent traversal state */
	const [agentSteps, setAgentSteps] = useState<
		{ step: number; action: string; detail: string }[]
	>([]);
	const [agentFindings, setAgentFindings] = useState<
		{ category: string; description: string }[]
	>([]);
	const [agentThought, setAgentThought] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");

	/* Cluster state */
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [clustersLoading, setClustersLoading] = useState(false);
	const [clustersExpanded, setClustersExpanded] = useState(false);
	const [highlightCluster, setHighlightCluster] = useState<Set<string> | null>(
		null,
	);

	/* Saved reports state */
	const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
	const [reportsOpen, setReportsOpen] = useState(false);
	const [viewingReport, setViewingReport] = useState<SavedReport | null>(null);
	const [savingReport, setSavingReport] = useState(false);
	const [reportSaved, setReportSaved] = useState(false);

	const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	/* Resize observer */
	useEffect(() => {
		if (!containerRef.current) return;
		const el = containerRef.current;
		const updateSize = () => {
			const rect = el.getBoundingClientRect();
			setDimensions({ width: rect.width, height: Math.max(rect.height, 400) });
		};
		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(el);
		return () => observer.disconnect();
	}, [isLoaded]);

	/* Fetch graph data */
	useEffect(() => {
		if (!isLoaded) return;
		const fetchGraph = async () => {
			try {
				const [graphRes, statsRes] = await Promise.all([
					authFetch(`${API}/graph/explore?limit=300`),
					authFetch(`${API}/graph/stats`),
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

	/* Fetch clusters */
	useEffect(() => {
		if (loading || graphData.nodes.length === 0) return;
		const fetchClusters = async () => {
			setClustersLoading(true);
			try {
				const res = await authFetch(`${API}/graph/clusters?limit=300`);
				if (res.ok) {
					const data = await res.json();
					setClusters(data.clusters || []);
				}
			} catch {
				/* ignore */
			}
			setClustersLoading(false);
		};
		fetchClusters();
	}, [loading, graphData.nodes.length]);

	/* Fetch saved reports */
	useEffect(() => {
		if (!user?.id) return;
		const fetchReports = async () => {
			try {
				const res = await authFetch(
					`${API}/graph/reports?user_id=${encodeURIComponent(user.id)}`,
				);
				if (res.ok) setSavedReports(await res.json());
			} catch {
				/* ignore */
			}
		};
		fetchReports();
	}, [user?.id]);

	/* Search debounce */
	useEffect(() => {
		if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
		if (!searchQuery.trim()) {
			setSearchResults([]);
			setSearchOpen(false);
			return;
		}
		searchTimeoutRef.current = setTimeout(async () => {
			try {
				const res = await authFetch(
					`${API}/graph/search?q=${encodeURIComponent(searchQuery)}&limit=10`,
				);
				if (res.ok) {
					const data = await res.json();
					setSearchResults(data.results || []);
					setSearchOpen(true);
				}
			} catch {
				/* ignore */
			}
		}, 300);
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
		};
	}, [searchQuery]);

	/* Node details fetch */
	const fetchNodeDetails = useCallback(async (node: GraphNode) => {
		setDetailsLoading(true);
		setNodeDetails(null);
		try {
			const res = await authFetch(
				`${API}/graph/node/${encodeURIComponent(node.id)}?node_type=${node.type}`,
			);
			if (res.ok) setNodeDetails(await res.json());
		} catch {
			/* ignore */
		}
		setDetailsLoading(false);
	}, []);

	useEffect(() => {
		if (loading || deepLinkHandled.current) return;
		const paperId = searchParams.get("paper");
		if (!paperId) return;
		deepLinkHandled.current = true;

		const node = graphData.nodes.find(
			(n) => n.id === paperId && n.type === "paper",
		);

		if (node) {
			setSelectedNode(node);
			fetchNodeDetails(node);
			setTimeout(() => {
				if (graphRef.current && node.x !== undefined && node.y !== undefined) {
					graphRef.current.centerAt(node.x, node.y, 800);
					graphRef.current.zoom(4, 800);
				}
			}, 600);
		} else {
			(async () => {
				const addFallbackNode = () => {
					const fallbackNode: GraphNode = {
						id: paperId,
						label: paperId,
						type: "paper",
					};
					setGraphData((prev) => {
						if (prev.nodes.some((n) => n.id === paperId)) return prev;
						return { nodes: [...prev.nodes, fallbackNode], edges: prev.edges };
					});
					setSelectedNode(fallbackNode);
					fetchNodeDetails(fallbackNode);
					setTimeout(() => {
						if (graphRef.current) {
							graphRef.current.centerAt(0, 0, 800);
							graphRef.current.zoom(3, 800);
						}
					}, 800);
				};

				try {
					const res = await authFetch(
						`${API}/graph/paper/${encodeURIComponent(paperId)}`,
					);
					if (res.ok) {
						const data = await res.json();
						setGraphData((prev) => {
							const existingIds = new Set(prev.nodes.map((n) => n.id));
							const newNodes = (data.nodes || []).filter(
								(n: GraphNode) => !existingIds.has(n.id),
							);
							const newEdges = data.edges || [];
							return {
								nodes: [...prev.nodes, ...newNodes],
								edges: [...prev.edges, ...newEdges],
							};
						});
						const paperNode: GraphNode = (data.nodes || []).find(
							(n: GraphNode) => n.id === paperId && n.type === "paper",
						) || {
							id: paperId,
							label: paperId,
							type: "paper" as const,
						};
						setSelectedNode(paperNode);
						fetchNodeDetails(paperNode);
						setTimeout(() => {
							if (graphRef.current) {
								graphRef.current.centerAt(0, 0, 800);
								graphRef.current.zoom(3, 800);
							}
						}, 800);
					} else {
						addFallbackNode();
					}
				} catch {
					addFallbackNode();
				}
			})();
		}
	}, [loading, searchParams, graphData.nodes, fetchNodeDetails]);

	/* Highlight neighbors on hover */
	const getNeighborIds = useCallback(
		(nodeId: string): Set<string> => {
			const ids = new Set<string>([nodeId]);
			graphData.edges.forEach((e) => {
				const src = getEdgeId(e.source);
				const tgt = getEdgeId(e.target);
				if (src === nodeId) ids.add(tgt);
				if (tgt === nodeId) ids.add(src);
			});
			return ids;
		},
		[graphData.edges],
	);

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

	/* Click handlers */
	const handleNodeClick = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any) => {
			const gn = node as GraphNode;

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
			const node = graphData.nodes.find((n) => n.id === result.id);
			if (node) {
				handleNodeClick(node);
			} else {
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

	/* Graph controls */
	const handleZoomIn = () =>
		graphRef.current?.zoom(graphRef.current.zoom() * 1.5, 400);
	const handleZoomOut = () =>
		graphRef.current?.zoom(graphRef.current.zoom() / 1.5, 400);
	const handleReset = () => {
		graphRef.current?.zoomToFit(400, 60);
		setSelectedNode(null);
		setNodeDetails(null);
	};

	/* Synthesize controls */
	const toggleSelectMode = useCallback(() => {
		setSelectMode((prev) => {
			if (prev) setSelectedForSynthesis(new Set());
			return !prev;
		});
	}, []);

	const handleSynthesize = useCallback(async () => {
		if (selectedForSynthesis.size === 0) return;
		setSelectMode(false);
		setSynthesizing(true);
		setReportOpen(true);
		setSynthesisReport(null);
		setBibtexData(null);
		setTocOpen(false);
		setAgentSteps([]);
		setAgentFindings([]);
		setAgentThought(null);
		setStreamingText("");

		if (reportMode === "agent") {
			try {
				const res = await authFetch(`${API}/graph/agent-synthesize`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ node_ids: Array.from(selectedForSynthesis) }),
				});
				if (!res.ok) {
					setSynthesisReport(
						"Something went wrong starting the deep analysis. Please try again.",
					);
					setSynthesizing(false);
					return;
				}
				const reader = res.body?.getReader();
				if (!reader) {
					setSynthesisReport("No response received. Please try again.");
					setSynthesizing(false);
					return;
				}
				const decoder = new TextDecoder();
				let buf = "";
				let fullText = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					const parts = buf.split("\n\n");
					buf = parts.pop() || "";
					for (const part of parts) {
						const lines = part.split("\n");
						let eventType = "";
						let dataStr = "";
						for (const line of lines) {
							if (line.startsWith("event: ")) eventType = line.slice(7);
							else if (line.startsWith("data: ")) dataStr = line.slice(6);
						}
						if (!eventType || !dataStr) continue;
						try {
							const data = JSON.parse(dataStr);
							switch (eventType) {
								case "step":
									setAgentSteps((prev) => [...prev, data]);
									break;
								case "finding":
									setAgentFindings((prev) => [...prev, data]);
									break;
								case "thought":
									setAgentThought(data.content);
									break;
								case "token":
									fullText += data.t;
									setStreamingText(fullText);
									break;
								case "done":
									setSynthesisReport(data.markdown);
									break;
								case "error":
									setSynthesisReport(`Error: ${data.message}`);
									break;
							}
						} catch {
							/* ignore parse errors */
						}
					}
				}
			} catch {
				setSynthesisReport("Network error. Please check your connection.");
			}
			setSynthesizing(false);
			return;
		}

		const endpoint =
			reportMode === "publication" ? "synthesize-publication" : "synthesize";
		try {
			const res = await authFetch(`${API}/graph/${endpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ node_ids: Array.from(selectedForSynthesis) }),
			});
			if (res.ok) {
				const data = await res.json();
				setSynthesisReport(data.markdown);
				if (data.bibtex) setBibtexData(data.bibtex);
			} else {
				setSynthesisReport("Error generating report. Please try again.");
			}
		} catch {
			setSynthesisReport("Network error. Please check your connection.");
		}
		setSynthesizing(false);
	}, [selectedForSynthesis, reportMode]);

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

	const handleDownloadBibtex = useCallback(() => {
		if (!bibtexData) return;
		const blob = new Blob([bibtexData], { type: "application/x-bibtex" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "references.bib";
		a.click();
		URL.revokeObjectURL(url);
	}, [bibtexData]);

	/* Export graph as PNG */
	const handleExportImage = useCallback(() => {
		if (!graphRef.current) return;
		const canvas =
			(containerRef.current?.querySelector("canvas") as HTMLCanvasElement) ||
			null;
		if (!canvas) return;
		const url = canvas.toDataURL("image/png");
		const a = document.createElement("a");
		a.href = url;
		a.download = "knowledge-graph.png";
		a.click();
	}, []);

	/* Save report */
	const handleSaveReport = useCallback(async () => {
		if (!synthesisReport || !user?.id) return;
		setSavingReport(true);
		try {
			const titleMatch = synthesisReport.match(/^#\s+(.+)$/m);
			const title =
				titleMatch?.[1] || `Report - ${selectedForSynthesis.size} papers`;
			const res = await authFetch(`${API}/graph/reports`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					user_id: user.id,
					title,
					markdown: synthesisReport,
					node_ids: Array.from(selectedForSynthesis),
					paper_count: selectedForSynthesis.size,
					citation_count: 0,
				}),
			});
			if (res.ok) {
				const saved = await res.json();
				setSavedReports((prev) => [saved, ...prev]);
				setReportSaved(true);
				setTimeout(() => setReportSaved(false), 2500);
			}
		} catch {
			/* ignore */
		}
		setSavingReport(false);
	}, [synthesisReport, user?.id, selectedForSynthesis]);

	/* Delete saved report */
	const handleDeleteReport = useCallback(async (reportId: string) => {
		try {
			await authFetch(`${API}/graph/reports/${reportId}`, { method: "DELETE" });
			setSavedReports((prev) => prev.filter((r) => r.id !== reportId));
		} catch {
			/* ignore */
		}
	}, []);

	/* Re-save a viewed report */
	const handleResaveReport = useCallback(async () => {
		if (!viewingReport || !user?.id) return;
		setSavingReport(true);
		try {
			const res = await authFetch(`${API}/graph/reports`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					user_id: user.id,
					title: viewingReport.title,
					markdown: viewingReport.markdown,
					node_ids: viewingReport.node_ids,
					paper_count: viewingReport.paper_count,
					citation_count: viewingReport.citation_count ?? 0,
				}),
			});
			if (res.ok) {
				const saved = await res.json();
				setSavedReports((prev) => [saved, ...prev]);
				setViewingReport(saved);
			}
		} catch {
			/* ignore */
		}
		setSavingReport(false);
	}, [viewingReport, user?.id]);

	/* Synthesize a cluster */
	const handleSynthesizeCluster = useCallback(
		(cluster: Cluster) => {
			setSelectedForSynthesis(new Set(cluster.paper_ids));
			setSelectMode(false);
			setHighlightCluster(null);
			setSynthesizing(true);
			setReportOpen(true);
			setSynthesisReport(null);
			setBibtexData(null);
			setAgentSteps([]);
			setAgentFindings([]);
			setAgentThought(null);
			setStreamingText("");

			if (reportMode === "agent") {
				(async () => {
					try {
						const res = await authFetch(`${API}/graph/agent-synthesize`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ node_ids: cluster.paper_ids }),
						});
						if (!res.ok) {
							setSynthesisReport(
								"Something went wrong starting the deep analysis. Please try again.",
							);
							setSynthesizing(false);
							return;
						}
						const reader = res.body?.getReader();
						if (!reader) {
							setSynthesisReport("No response received. Please try again.");
							setSynthesizing(false);
							return;
						}
						const decoder = new TextDecoder();
						let buf = "";
						let fullText = "";
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value, { stream: true });
							const parts = buf.split("\n\n");
							buf = parts.pop() || "";
							for (const part of parts) {
								const lines = part.split("\n");
								let eventType = "";
								let dataStr = "";
								for (const line of lines) {
									if (line.startsWith("event: ")) eventType = line.slice(7);
									else if (line.startsWith("data: ")) dataStr = line.slice(6);
								}
								if (!eventType || !dataStr) continue;
								try {
									const data = JSON.parse(dataStr);
									switch (eventType) {
										case "step":
											setAgentSteps((prev) => [...prev, data]);
											break;
										case "finding":
											setAgentFindings((prev) => [...prev, data]);
											break;
										case "thought":
											setAgentThought(data.content);
											break;
										case "token":
											fullText += data.t;
											setStreamingText(fullText);
											break;
										case "done":
											setSynthesisReport(data.markdown);
											break;
										case "error":
											setSynthesisReport(`Error: ${data.message}`);
											break;
									}
								} catch {
									/* ignore */
								}
							}
						}
					} catch {
						setSynthesisReport("Network error. Please check your connection.");
					}
					setSynthesizing(false);
				})();
				return;
			}

			const endpoint =
				reportMode === "publication" ? "synthesize-publication" : "synthesize";
			authFetch(`${API}/graph/${endpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ node_ids: cluster.paper_ids }),
			})
				.then(async (res) => {
					if (res.ok) {
						const data = await res.json();
						setSynthesisReport(data.markdown);
						if (data.bibtex) setBibtexData(data.bibtex);
					} else {
						setSynthesisReport("Error generating report. Please try again.");
					}
				})
				.catch(() =>
					setSynthesisReport("Network error. Please check your connection."),
				)
				.finally(() => setSynthesizing(false));
		},
		[reportMode],
	);

	/* Toggle helpers */
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
		setSelectedNode((sel) => (sel?.id === nodeId ? null : sel));
		setNodeDetails((det) => (det?.id === nodeId ? null : det));
	}, []);

	const clearHiddenNodes = useCallback(() => setHiddenNodes(new Set()), []);

	const hasActiveFilters =
		hiddenNodeTypes.size > 0 ||
		hiddenEdgeTypes.size > 0 ||
		hiddenNodes.size > 0;

	/* Filtered data */
	const filteredData = useMemo(() => {
		let nodes = graphData.nodes;
		let edges = graphData.edges;

		if (hiddenNodeTypes.size > 0) {
			nodes = nodes.filter((n) => !hiddenNodeTypes.has(n.type));
		}

		if (hiddenNodes.size > 0) {
			nodes = nodes.filter((n) => !hiddenNodes.has(n.id));
		}

		const nodeIds = new Set(nodes.map((n) => n.id));
		edges = edges.filter(
			(e) =>
				nodeIds.has(getEdgeId(e.source)) && nodeIds.has(getEdgeId(e.target)),
		);

		if (hiddenEdgeTypes.size > 0) {
			edges = edges.filter((e) => !hiddenEdgeTypes.has(e.type));
		}

		return { nodes, links: edges };
	}, [graphData, hiddenNodeTypes, hiddenNodes, hiddenEdgeTypes]);

	/* Canvas painting */
	const paintNode = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const n = node as GraphNode;
			const isSelected = selectedNode?.id === n.id;
			const isHovered = hoveredNode === n.id;
			const isClusterDimmed = highlightCluster && !highlightCluster.has(n.id);
			const isDimmed =
				(hoveredNode && !highlightNodes.has(n.id)) || isClusterDimmed;
			const isMarkedForSynthesis = selectMode && selectedForSynthesis.has(n.id);
			const isClusterHighlighted =
				highlightCluster && highlightCluster.has(n.id);

			const baseSize = n.type === "paper" ? 5 : n.type === "author" ? 4 : 3.5;
			const size = isSelected
				? baseSize * 2
				: isHovered
					? baseSize * 1.6
					: isClusterHighlighted
						? baseSize * 1.3
						: isMarkedForSynthesis
							? baseSize * 1.4
							: baseSize;

			if (isSelected || isHovered) {
				ctx.beginPath();
				ctx.arc(node.x!, node.y!, size + 4, 0, 2 * Math.PI);
				const gradient = ctx.createRadialGradient(
					node.x!,
					node.y!,
					size,
					node.x!,
					node.y!,
					size + 4,
				);
				const color = NODE_COLORS[n.type] || "#666";
				gradient.addColorStop(0, color + "60");
				gradient.addColorStop(1, color + "00");
				ctx.fillStyle = gradient;
				ctx.fill();
			}

			ctx.beginPath();
			ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
			ctx.fillStyle = isDimmed
				? NODE_COLORS_DIM[n.type] || "#66666644"
				: NODE_COLORS[n.type] || "#666";
			ctx.fill();

			if (isSelected) {
				ctx.strokeStyle = "#fff";
				ctx.lineWidth = 2 / globalScale;
				ctx.stroke();
			}

			if (isMarkedForSynthesis) {
				ctx.beginPath();
				ctx.arc(node.x!, node.y!, size + 3, 0, 2 * Math.PI);
				ctx.strokeStyle = "#f59e0b";
				ctx.lineWidth = 2 / globalScale;
				ctx.setLineDash([3 / globalScale, 2 / globalScale]);
				ctx.stroke();
				ctx.setLineDash([]);

				ctx.beginPath();
				ctx.arc(node.x! + size + 1, node.y! - size - 1, 2.5, 0, 2 * Math.PI);
				ctx.fillStyle = "#f59e0b";
				ctx.fill();
			}

			if (showLabels && (globalScale > 1.5 || isSelected || isHovered)) {
				const label = n.label || n.id;
				const maxLen = isSelected || isHovered ? 50 : 25;
				const displayLabel =
					label.length > maxLen ? label.slice(0, maxLen) + "..." : label;
				const fontSize = Math.max(
					(isSelected || isHovered ? 12 : 10) / globalScale,
					1.5,
				);
				ctx.font = `${isSelected || isHovered ? "600" : "400"} ${fontSize}px Inter, system-ui, sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";

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

				ctx.fillStyle = isDimmed ? "#99999944" : isDark ? "#e4e4e7" : "#27272a";
				ctx.fillText(displayLabel, node.x!, node.y! + size + 1 + padding);
			}
		},
		[
			selectedNode,
			hoveredNode,
			highlightNodes,
			highlightCluster,
			showLabels,
			selectMode,
			selectedForSynthesis,
		],
	);

	/* Render */
	if (!isLoaded) return <PageLoader />;
	if (!user) {
		return <RedirectLoader to="/sign-in" />;
	}

	const TypeIcon = (type: string) =>
		TYPE_ICONS[type as keyof typeof TYPE_ICONS] || BookOpen;

	return (
		<div className="flex flex-col bg-zinc-50/50 dark:bg-zinc-950 h-screen w-full overflow-hidden">
			{/* Header */}
			<Navbar
				rightContent={
					<div className="relative">
						<div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 rounded-lg px-3 py-1.5 border border-transparent focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition">
							<Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
							<input
								ref={searchInputRef}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
								placeholder="Search papers, authors, concepts..."
								className="w-48 sm:w-64 bg-transparent text-sm placeholder:text-zinc-400 focus:outline-none"
							/>
							{searchQuery && (
								<button
									onClick={() => {
										setSearchQuery("");
										setSearchOpen(false);
									}}
								>
									<X className="h-3.5 w-3.5 text-zinc-400 hover:text-zinc-600" />
								</button>
							)}
						</div>
						{/* Search dropdown */}
						{searchOpen && searchResults.length > 0 && (
							<div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden z-50 max-h-72 overflow-y-auto">
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
												<Icon
													className="h-3.5 w-3.5"
													style={{ color: NODE_COLORS[r.type] }}
												/>
											</div>
											<div className="min-w-0">
												<p className="text-sm font-medium truncate">
													{r.label}
												</p>
												<p className="text-[10px] text-zinc-400 capitalize">
													{r.type}
													{r.category ? ` · ${r.category}` : ""}
												</p>
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>
				}
			/>

			{/* Body */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{/* Sidebar */}
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
											{
												n: stats.concepts,
												l: "Concepts",
												c: NODE_COLORS.concept,
											},
										].map(({ n, l, c }) => (
											<div
												key={l}
												className="text-center p-2 rounded-lg"
												style={{ backgroundColor: c + "10" }}
											>
												<p className="text-lg font-bold" style={{ color: c }}>
													{n}
												</p>
												<p className="text-[9px] text-zinc-500">{l}</p>
											</div>
										))}
									</div>
									<div className="grid grid-cols-2 gap-1.5 mt-1.5">
										<div className="text-center p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900">
											<p className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
												{stats.citations}
											</p>
											<p className="text-[9px] text-zinc-500">Citations</p>
										</div>
										<div className="text-center p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-900">
											<p className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
												{stats.authorships}
											</p>
											<p className="text-[9px] text-zinc-500">Authorships</p>
										</div>
									</div>
								</div>
							)}

							{/* Show / Hide */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									Show / Hide
								</h3>
								<div className="space-y-0.5">
									{[
										{
											type: "paper",
											label: "Papers",
											count: graphData.nodes.filter((n) => n.type === "paper")
												.length,
										},
										{
											type: "author",
											label: "Authors",
											count: graphData.nodes.filter((n) => n.type === "author")
												.length,
										},
										{
											type: "concept",
											label: "Concepts",
											count: graphData.nodes.filter((n) => n.type === "concept")
												.length,
										},
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
												<span
													className={`w-3 h-3 rounded-full shrink-0 ${hidden ? "opacity-30" : ""}`}
													style={{ backgroundColor: NODE_COLORS[type] }}
												/>
												<span className="flex-1 text-left">{label}</span>
												<span className="text-[10px] opacity-50">{count}</span>
												{hidden ? (
													<EyeOff className="h-3 w-3 shrink-0" />
												) : (
													<Eye className="h-3 w-3 shrink-0 opacity-40" />
												)}
											</button>
										);
									})}
								</div>
							</div>

							{/* Connections */}
							<div>
								<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
									Connections
								</h3>
								<div className="space-y-0.5">
									{[
										{ type: "cites", label: "Citations", arrow: true },
										{ type: "authored", label: "Authorships" },
										{ type: "involves", label: "Topics" },
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
												<span
													className={`w-4 h-0.5 inline-block rounded relative shrink-0 ${hidden ? "opacity-30" : ""}`}
													style={{ backgroundColor: EDGE_COLORS[type] }}
												>
													{arrow && (
														<span
															className="absolute -right-1 top-1/2 -translate-y-1/2 w-0 h-0 border-y-[3px] border-y-transparent border-l-4"
															style={{ borderLeftColor: EDGE_COLORS[type] }}
														/>
													)}
												</span>
												<span className="flex-1 text-left">{label}</span>
												{hidden ? (
													<EyeOff className="h-3 w-3 shrink-0" />
												) : (
													<Eye className="h-3 w-3 shrink-0 opacity-40" />
												)}
											</button>
										);
									})}
								</div>
							</div>

							{/* Clusters */}
							<div>
								<button
									onClick={() => setClustersExpanded((p) => !p)}
									className="flex items-center justify-between w-full mb-2 group"
								>
									<h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
										<Layers className="h-3 w-3" />
										Research Groups{" "}
										{clusters.length > 0 && `(${clusters.length})`}
									</h3>
									<ChevronDown
										className={`h-3 w-3 text-zinc-400 transition-transform ${clustersExpanded ? "" : "-rotate-90"}`}
									/>
								</button>
								{clustersExpanded && (
									<div className="space-y-1.5 max-h-64 overflow-y-auto">
										{clustersLoading ? (
											<div className="flex items-center gap-2 py-2 text-zinc-400 text-xs">
												<Loader2 className="h-3 w-3 animate-spin" />
												Finding related paper groups...
											</div>
										) : clusters.length === 0 ? (
											<p className="text-[10px] text-zinc-400 py-1">
												No paper groups found
											</p>
										) : (
											clusters.map((cluster) => (
												<div
													key={cluster.id}
													className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-2 space-y-1.5 hover:border-blue-300 dark:hover:border-blue-700 transition cursor-pointer"
													onClick={() => {
														setHighlightCluster(new Set(cluster.paper_ids));
														const ids = new Set(cluster.paper_ids);
														graphRef.current?.zoomToFit(
															800,
															60,
															(node: { id: string }) => ids.has(node.id),
														);
													}}
													onMouseEnter={() =>
														setHighlightCluster(new Set(cluster.paper_ids))
													}
													onMouseLeave={() => setHighlightCluster(null)}
												>
													<div className="flex items-center justify-between">
														<p className="text-xs font-medium truncate flex-1">
															{cluster.label}
														</p>
														<Badge className="text-[9px] px-1.5 py-0 shrink-0 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
															{cluster.size}
														</Badge>
													</div>
													<div className="flex flex-wrap gap-1">
														{cluster.top_concepts.slice(0, 3).map((c, i) => (
															<span
																key={i}
																className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
															>
																{c}
															</span>
														))}
													</div>
													<Button
														size="sm"
														variant="ghost"
														className="h-6 w-full text-[10px] text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950 gap-1"
														onClick={() => handleSynthesizeCluster(cluster)}
													>
														<Sparkles className="h-3 w-3" />
														Summarize Group
													</Button>
												</div>
											))
										)}
									</div>
								)}
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
													<span
														className="w-2 h-2 rounded-full shrink-0"
														style={{
															backgroundColor:
																NODE_COLORS[node?.type || "paper"] + "60",
														}}
													/>
													<span className="truncate flex-1 text-left">
														{node?.label || id}
													</span>
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
											<div
												key={type}
												className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
											>
												<span
													className="w-3 h-3 rounded-full"
													style={{ backgroundColor: NODE_COLORS[type] }}
												/>
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
										{showLabels ? (
											<Eye className="h-3.5 w-3.5" />
										) : (
											<EyeOff className="h-3.5 w-3.5" />
										)}
										{showLabels ? "Hide" : "Show"} Labels
									</button>
								</div>
							</div>
						</div>
					</aside>
				)}

				{/* Graph Canvas */}
				<main
					ref={containerRef}
					className="flex-1 relative min-h-0 min-w-0 overflow-hidden"
				>
					{/* Toggle sidebar */}
					<button
						onClick={() => setSidebarOpen((p) => !p)}
						className="absolute top-3 left-3 z-10 bg-white dark:bg-zinc-900 rounded-lg p-1.5 border shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
						title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
					>
						<ChevronRight
							className={`h-4 w-4 transition-transform ${sidebarOpen ? "rotate-180" : ""}`}
						/>
					</button>

					{/* Graph controls - positioned to dodge the detail panel */}
					<div
						className={`absolute top-3 z-30 flex items-center gap-1.5 transition-all ${selectedNode ? "right-84" : "right-3"}`}
					>
						{/* Saved reports */}
						<button
							onClick={() => setReportsOpen(true)}
							className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border shadow-sm text-xs font-medium bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-700 transition"
							title="Saved reports"
						>
							<BookMarked className="h-3.5 w-3.5" />
							Reports
							{savedReports.length > 0 && (
								<span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 flex items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold px-1">
									{savedReports.length}
								</span>
							)}
						</button>

						{/* Review mode toggle */}
						<button
							onClick={toggleSelectMode}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border shadow-sm text-xs font-medium transition ${
								selectMode
									? "bg-amber-500 text-white border-amber-600 shadow-amber-200 dark:shadow-amber-900"
									: "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
							}`}
							title={
								selectMode
									? "Done selecting"
									: "Select papers to generate a review"
							}
						>
							<MousePointerClick className="h-3.5 w-3.5" />
							{selectMode ? "Selecting..." : "Generate Review"}
						</button>

						<div className="bg-white dark:bg-zinc-900 rounded-lg border shadow-sm flex items-center">
							<button
								onClick={handleZoomIn}
								className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-l-lg transition"
								title="Zoom in"
							>
								<ZoomIn className="h-4 w-4" />
							</button>
							<button
								onClick={handleZoomOut}
								className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
								title="Zoom out"
							>
								<ZoomOut className="h-4 w-4" />
							</button>
							<button
								onClick={handleReset}
								className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
								title="Fit to view"
							>
								<Scan className="h-4 w-4" />
							</button>
							<button
								onClick={handleExportImage}
								className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-r-lg transition"
								title="Export as PNG"
							>
								<Camera className="h-4 w-4" />
							</button>
						</div>
					</div>

					{loading ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<Network className="h-12 w-12 text-zinc-300 mx-auto animate-pulse" />
								<p className="text-sm text-zinc-500">
									Loading knowledge graph...
								</p>
							</div>
						</div>
					) : graphData.nodes.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center space-y-3">
								<Network className="h-12 w-12 text-zinc-300 mx-auto" />
								<h3 className="text-lg font-medium">No graph data yet</h3>
								<p className="text-sm text-zinc-500 max-w-md">
									Your knowledge graph will appear here once papers are fetched.
									Check your feed to get started.
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
								if (!hoveredNode)
									return EDGE_COLORS[link.type as string] || "#ddd";
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
								return highlightNodes.has(src) && highlightNodes.has(tgt)
									? 1.5
									: 0.2;
							}}
							linkDirectionalArrowLength={3}
							linkDirectionalArrowRelPos={1}
							linkDirectionalParticles={hoveredNode ? 2 : 0}
							linkDirectionalParticleWidth={2}
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							linkDirectionalParticleColor={(link: any) =>
								EDGE_COLORS[link.type as string] || "#999"
							}
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
							{filteredData.nodes.length} nodes · {filteredData.links.length}{" "}
							edges
							{hasActiveFilters && (
								<button
									onClick={() => {
										setHiddenNodes(new Set());
										setHiddenEdgeTypes(new Set());
										setHiddenNodeTypes(new Set());
									}}
									className="ml-1 flex items-center gap-0.5 text-blue-500 hover:text-blue-600 transition"
									title="Clear all filters"
								>
									<RotateCcw className="h-2.5 w-2.5" />
									Reset
								</button>
							)}
						</div>
					)}

					{/* Synthesis selection bar */}
					{selectMode && (
						<div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-2.5 shadow-lg shadow-amber-100 dark:shadow-amber-900/20">
							<div className="flex items-center gap-2">
								<div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
									<MousePointerClick className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
								</div>
								<p className="text-sm font-medium">
									{selectedForSynthesis.size === 0 ? (
										"Click nodes to select"
									) : (
										<>
											<span className="text-amber-600 dark:text-amber-400 font-bold">
												{selectedForSynthesis.size}
											</span>{" "}
											selected
										</>
									)}
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

									{/* Mode toggle */}
									<div className="flex items-center rounded-lg border overflow-hidden text-xs">
										<button
											onClick={() => setReportMode("quick")}
											className={`flex items-center gap-1 px-2.5 py-1.5 transition ${reportMode === "quick" ? "bg-amber-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
											title="Quick overview with key themes"
										>
											<FileText className="h-3 w-3" />
											Quick
										</button>
										<button
											onClick={() => setReportMode("publication")}
											className={`flex items-center gap-1 px-2.5 py-1.5 transition ${reportMode === "publication" ? "bg-amber-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
											title="Detailed academic review with citations, ready for papers"
										>
											<GraduationCap className="h-3 w-3" />
											Academic
										</button>
										<button
											onClick={() => setReportMode("agent")}
											className={`flex items-center gap-1 px-2.5 py-1.5 transition ${reportMode === "agent" ? "bg-violet-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
											title="AI explores connections across papers for an in-depth review"
										>
											<Brain className="h-3 w-3" />
											Deep
										</button>
									</div>

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
										Generate
									</Button>
								</>
							)}

							<button
								onClick={toggleSelectMode}
								className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
								title="Cancel selection"
							>
								<X className="h-4 w-4 text-zinc-400" />
							</button>
						</div>
					)}

					{/* Detail Panel */}
					{selectedNode && (
						<div className="absolute top-0 right-0 w-80 h-full bg-white dark:bg-zinc-950 border-l shadow-xl overflow-y-auto z-20">
							<div className="p-4 space-y-4">
								{/* Header */}
								<div className="flex items-start justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<div
											className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
											style={{
												backgroundColor: NODE_COLORS[selectedNode.type] + "20",
											}}
										>
											{(() => {
												const Icon = TypeIcon(selectedNode.type);
												return (
													<Icon
														className="h-4 w-4"
														style={{ color: NODE_COLORS[selectedNode.type] }}
													/>
												);
											})()}
										</div>
										<div className="min-w-0">
											<Badge
												className="text-[9px] px-1.5 py-0 mb-1"
												style={{
													backgroundColor: NODE_COLORS[selectedNode.type],
													color: "#fff",
												}}
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
											onClick={() => {
												setSelectedNode(null);
												setNodeDetails(null);
											}}
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
										Loading details...
									</div>
								)}

								{nodeDetails && (
									<>
										{/* Paper details */}
										{nodeDetails.type === "paper" && (
											<div className="space-y-3">
												{nodeDetails.date && (
													<p className="text-xs text-zinc-500">
														Published{" "}
														{new Date(nodeDetails.date).toLocaleDateString(
															"en-US",
															{
																year: "numeric",
																month: "long",
																day: "numeric",
															},
														)}
														{nodeDetails.source && (
															<span className="ml-1.5 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 text-[10px]">
																{nodeDetails.source}
															</span>
														)}
													</p>
												)}

												{/* Actions */}
												<div className="flex gap-1.5">
													<Button
														variant="outline"
														size="sm"
														className="h-7 text-xs gap-1 text-purple-600"
														onClick={() =>
															router.push(
																`/ask?paper=${encodeURIComponent(nodeDetails.id)}`,
															)
														}
													>
														<Sparkles className="h-3 w-3" />
														Explore with AI
													</Button>
													{nodeDetails.url && (
														<a
															href={nodeDetails.url}
															target="_blank"
															rel="noopener noreferrer"
														>
															<Button
																variant="outline"
																size="sm"
																className="h-7 text-xs gap-1"
															>
																<ExternalLink className="h-3 w-3" />
																Paper
															</Button>
														</a>
													)}
												</div>

												{/* Authors */}
												{nodeDetails.authors &&
													nodeDetails.authors.length > 0 && (
														<div>
															<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
																Authors ({nodeDetails.authors.length})
															</p>
															<div className="space-y-1">
																{nodeDetails.authors.map((a, i) => (
																	<div
																		key={i}
																		className="flex items-center gap-1.5 text-xs"
																	>
																		<Users
																			className="h-3 w-3 shrink-0"
																			style={{ color: NODE_COLORS.author }}
																		/>
																		<span className="font-medium">
																			{a.name}
																		</span>
																		{a.institution && (
																			<span className="text-zinc-400 text-[10px]">
																				· {a.institution}
																			</span>
																		)}
																	</div>
																))}
															</div>
														</div>
													)}

												{/* Concepts */}
												{nodeDetails.concepts &&
													nodeDetails.concepts.length > 0 && (
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
																		{c.category && (
																			<span>{CATEGORY_ICONS[c.category]}</span>
																		)}
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
																<div
																	key={i}
																	className="flex items-center gap-1 group/ref"
																>
																	<button
																		onClick={() => {
																			const node = graphData.nodes.find(
																				(n) => n.id === c.id,
																			);
																			if (node) handleNodeClick(node);
																		}}
																		className="flex-1 text-left text-xs text-blue-600 hover:text-blue-700 hover:underline line-clamp-1"
																	>
																		{c.title || c.id}
																	</button>
																	<button
																		onClick={(e) => {
																			e.stopPropagation();
																			toggleHiddenNode(c.id);
																		}}
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
												{nodeDetails.cited_by &&
													nodeDetails.cited_by.length > 0 && (
														<div>
															<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
																Cited By ({nodeDetails.cited_by.length})
															</p>
															<div className="space-y-1 max-h-32 overflow-y-auto">
																{nodeDetails.cited_by.map((c, i) => (
																	<div
																		key={i}
																		className="flex items-center gap-1 group/citedby"
																	>
																		<button
																			onClick={() => {
																				const node = graphData.nodes.find(
																					(n) => n.id === c.id,
																				);
																				if (node) handleNodeClick(node);
																			}}
																			className="flex-1 text-left text-xs text-blue-600 hover:text-blue-700 hover:underline line-clamp-1"
																		>
																			{c.title || c.id}
																		</button>
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				toggleHiddenNode(c.id);
																			}}
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
												{nodeDetails.institutions &&
													nodeDetails.institutions.length > 0 && (
														<div className="flex flex-wrap gap-1">
															{nodeDetails.institutions.map((inst, i) => (
																<span
																	key={i}
																	className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
																>
																	🏛️ {inst}
																</span>
															))}
														</div>
													)}
												{nodeDetails.papers &&
													nodeDetails.papers.length > 0 && (
														<div>
															<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
																Papers ({nodeDetails.papers.length})
															</p>
															<div className="space-y-1.5 max-h-64 overflow-y-auto">
																{nodeDetails.papers.map((p, i) => (
																	<div
																		key={i}
																		className="relative group/apaper"
																	>
																		<button
																			onClick={() => {
																				const node = graphData.nodes.find(
																					(n) => n.id === p.id,
																				);
																				if (node) handleNodeClick(node);
																			}}
																			className="w-full text-left p-2 rounded-md bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
																		>
																			<p className="text-xs font-medium line-clamp-2 pr-5">
																				{p.title || p.id}
																			</p>
																			{p.date && (
																				<p className="text-[10px] text-zinc-400 mt-0.5">
																					{p.date}
																				</p>
																			)}
																		</button>
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				toggleHiddenNode(p.id);
																			}}
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
														<span className="text-sm">
															{CATEGORY_ICONS[nodeDetails.category] || "📌"}
														</span>
														<span className="text-xs text-zinc-500 capitalize">
															{nodeDetails.category}
														</span>
													</div>
												)}
												{nodeDetails.papers &&
													nodeDetails.papers.length > 0 && (
														<div>
															<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">
																Papers using this concept (
																{nodeDetails.papers.length})
															</p>
															<div className="space-y-1.5 max-h-80 overflow-y-auto">
																{nodeDetails.papers.map((p, i) => (
																	<div
																		key={i}
																		className="relative group/cpaper"
																	>
																		<button
																			onClick={() => {
																				const node = graphData.nodes.find(
																					(n) => n.id === p.id,
																				);
																				if (node) handleNodeClick(node);
																			}}
																			className="w-full text-left p-2 rounded-md bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
																		>
																			<p className="text-xs font-medium line-clamp-2 pr-5">
																				{p.title || p.id}
																			</p>
																			{p.date && (
																				<p className="text-[10px] text-zinc-400 mt-0.5">
																					{p.date}
																				</p>
																			)}
																		</button>
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				toggleHiddenNode(p.id);
																			}}
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

				{/* Synthesis Report Panel */}
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
									<div
										className={`h-9 w-9 rounded-lg flex items-center justify-center ${reportMode === "agent" ? "bg-violet-100 dark:bg-violet-900" : reportMode === "publication" ? "bg-purple-100 dark:bg-purple-900" : "bg-amber-100 dark:bg-amber-900"}`}
									>
										{reportMode === "agent" ? (
											<Brain className="h-5 w-5 text-violet-600 dark:text-violet-400" />
										) : reportMode === "publication" ? (
											<GraduationCap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
										) : (
											<FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
										)}
									</div>
									<div>
										<h2 className="text-lg font-semibold">
											{reportMode === "agent"
												? "Deep Analysis"
												: reportMode === "publication"
													? "Academic Review"
													: "Literature Review"}
										</h2>
										<p className="text-xs text-zinc-500">
											{selectedForSynthesis.size} papers analyzed
											{reportMode === "agent" &&
												" · AI-powered deep exploration"}
											{reportMode === "publication" && " · citation-ready"}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-1.5">
									{synthesisReport && (
										<>
											{/* Section nav toggle (publication mode) */}
											{reportMode === "publication" && (
												<button
													onClick={() => setTocOpen((p) => !p)}
													className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${tocOpen ? "bg-purple-50 dark:bg-purple-950 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
													title="Table of contents"
												>
													<List className="h-3.5 w-3.5" />
													Sections
												</button>
											)}
											<button
												onClick={handleSaveReport}
												disabled={savingReport || reportSaved}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border disabled:opacity-50"
												title="Save report"
											>
												{reportSaved ? (
													<Check className="h-3.5 w-3.5 text-emerald-500" />
												) : savingReport ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
												) : (
													<Save className="h-3.5 w-3.5" />
												)}
												{reportSaved ? "Saved" : "Save"}
											</button>
											<button
												onClick={handleCopyReport}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
												title="Copy as Markdown"
											>
												{copied ? (
													<Check className="h-3.5 w-3.5 text-emerald-500" />
												) : (
													<Copy className="h-3.5 w-3.5" />
												)}
												{copied ? "Copied" : "Copy"}
											</button>
											<button
												onClick={handleDownloadReport}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
												title="Download as .md file"
											>
												<Download className="h-3.5 w-3.5" />
												.md
											</button>
											{bibtexData && (
												<button
													onClick={handleDownloadBibtex}
													className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
													title="Download BibTeX references"
												>
													<Download className="h-3.5 w-3.5" />
													.bib
												</button>
											)}
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
							<div className="flex-1 overflow-hidden flex">
								{/* Section nav sidebar (publication mode) */}
								{tocOpen && synthesisReport && reportMode === "publication" && (
									<nav className="w-48 border-r shrink-0 overflow-y-auto py-3 px-2 space-y-0.5">
										<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 px-2 mb-2">
											Contents
										</p>
										{synthesisReport
											.split("\n")
											.filter((l) => /^#{1,3}\s/.test(l))
											.map((heading, i) => {
												const level = heading.match(/^(#+)/)?.[1].length || 1;
												const text = heading
													.replace(/^#+\s*/, "")
													.replace(/\*\*/g, "");
												const id = text
													.toLowerCase()
													.replace(/[^a-z0-9]+/g, "-")
													.replace(/(^-|-$)/g, "");
												return (
													<button
														key={i}
														onClick={() => {
															const el = document.getElementById(id);
															if (el)
																el.scrollIntoView({
																	behavior: "smooth",
																	block: "start",
																});
														}}
														className={`block w-full text-left text-[11px] rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition truncate ${level === 1 ? "font-semibold" : level === 2 ? "pl-4 text-zinc-600 dark:text-zinc-400" : "pl-6 text-zinc-500 dark:text-zinc-500 text-[10px]"}`}
													>
														{text}
													</button>
												);
											})}
									</nav>
								)}

								<div className="flex-1 overflow-y-auto">
									{synthesizing ? (
										reportMode === "agent" ? (
											/* Agent traversal live progress */
											<div className="p-6 space-y-4">
												{/* Header */}
												<div className="flex items-center gap-3 text-violet-600 dark:text-violet-400">
													<Brain className="h-5 w-5 animate-pulse" />
													<p className="text-sm font-semibold">
														AI is analyzing connections between papers...
													</p>
												</div>

												{/* Traversal steps log */}
												{agentSteps.length > 0 && (
													<div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900">
														{agentSteps.map((s, i) => (
															<div
																key={i}
																className="flex items-start gap-2 text-xs"
															>
																<span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
																	{s.step}
																</span>
																<span className="text-zinc-600 dark:text-zinc-400">
																	{s.detail}
																</span>
															</div>
														))}
													</div>
												)}

												{/* Agent thought */}
												{agentThought && (
													<div className="border rounded-lg p-3 bg-violet-50 dark:bg-violet-950 text-xs text-violet-700 dark:text-violet-300 italic">
														<p className="font-semibold text-[10px] uppercase tracking-widest text-violet-500 mb-1">
															AI thinking
														</p>
														{agentThought.slice(0, 200)}
														{agentThought.length > 200 ? "..." : ""}
													</div>
												)}

												{/* Findings */}
												{agentFindings.length > 0 && (
													<div className="space-y-1.5">
														<p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
															Discoveries ({agentFindings.length})
														</p>
														{agentFindings.map((f, i) => (
															<div
																key={i}
																className="flex items-start gap-2 text-xs p-2 rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800"
															>
																<Badge
																	variant="outline"
																	className="shrink-0 text-[9px] capitalize"
																>
																	{f.category}
																</Badge>
																<span className="text-zinc-700 dark:text-zinc-300">
																	{f.description}
																</span>
															</div>
														))}
													</div>
												)}

												{/* Streaming synthesis text */}
												{streamingText && (
													<div className="border-t pt-4 mt-2">
														<div className="flex items-center gap-2 mb-3">
															<Loader2 className="h-4 w-4 animate-spin text-violet-500" />
															<p className="text-xs font-semibold text-zinc-500">
																Writing review...
															</p>
														</div>
														<article className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
															<ReactMarkdown
																components={{
																	h1({ children, ...props }) {
																		const text = String(children).replace(
																			/\*\*/g,
																			"",
																		);
																		const id = text
																			.toLowerCase()
																			.replace(/[^a-z0-9]+/g, "-")
																			.replace(/(^-|-$)/g, "");
																		return (
																			<h1 id={id} {...props}>
																				{children}
																			</h1>
																		);
																	},
																	h2({ children, ...props }) {
																		const text = String(children).replace(
																			/\*\*/g,
																			"",
																		);
																		const id = text
																			.toLowerCase()
																			.replace(/[^a-z0-9]+/g, "-")
																			.replace(/(^-|-$)/g, "");
																		return (
																			<h2 id={id} {...props}>
																				{children}
																			</h2>
																		);
																	},
																	h3({ children, ...props }) {
																		const text = String(children).replace(
																			/\*\*/g,
																			"",
																		);
																		const id = text
																			.toLowerCase()
																			.replace(/[^a-z0-9]+/g, "-")
																			.replace(/(^-|-$)/g, "");
																		return (
																			<h3 id={id} {...props}>
																				{children}
																			</h3>
																		);
																	},
																	code({ className, children, ...props }) {
																		const match = /language-(\w+)/.exec(
																			className || "",
																		);
																		const codeStr = String(children).replace(
																			/\n$/,
																			"",
																		);
																		if (match?.[1] === "mermaid")
																			return <MermaidRenderer code={codeStr} />;
																		if (!match)
																			return (
																				<code
																					className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono"
																					{...props}
																				>
																					{children}
																				</code>
																			);
																		return (
																			<pre className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-4 overflow-x-auto">
																				<code
																					className={`${className} text-xs font-mono`}
																					{...props}
																				>
																					{children}
																				</code>
																			</pre>
																		);
																	},
																}}
															>
																{streamingText}
															</ReactMarkdown>
														</article>
													</div>
												)}

												{/* Skeleton when no steps yet */}
												{agentSteps.length === 0 && !streamingText && (
													<div className="space-y-3 animate-pulse mt-4">
														<div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
														<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
														<div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3" />
													</div>
												)}
											</div>
										) : (
											<div className="p-8 space-y-6">
												<div className="flex items-center gap-3 text-zinc-500">
													<Loader2 className="h-5 w-5 animate-spin text-amber-500" />
													<p className="text-sm font-medium">
														{reportMode === "publication"
															? "Generating a detailed academic review - this may take a moment..."
															: "Reading your papers and writing a review..."}
													</p>
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
										)
									) : synthesisReport ? (
										<div className="p-6">
											{/* Agent traversal summary (when finished) */}
											{reportMode === "agent" &&
												(agentSteps.length > 0 || agentFindings.length > 0) && (
													<div className="mb-6 space-y-3">
														<div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400">
															<Brain className="h-3.5 w-3.5" />
															<span className="font-semibold">
																AI explored{" "}
																{
																	agentSteps.filter(
																		(s) =>
																			s.action !== "Initializing" &&
																			s.action !== "Synthesizing",
																	).length
																}{" "}
																steps
															</span>
															{agentFindings.length > 0 && (
																<span>· {agentFindings.length} findings</span>
															)}
														</div>
														{agentFindings.length > 0 && (
															<details className="border rounded-lg bg-zinc-50 dark:bg-zinc-900 text-xs">
																<summary className="px-3 py-2 cursor-pointer font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition">
																	View key findings
																</summary>
																<div className="px-3 pb-3 space-y-1.5">
																	{agentFindings.map((f, i) => (
																		<div
																			key={i}
																			className="flex items-start gap-2 p-1.5"
																		>
																			<Badge
																				variant="outline"
																				className="shrink-0 text-[9px] capitalize"
																			>
																				{f.category}
																			</Badge>
																			<span className="text-zinc-600 dark:text-zinc-400">
																				{f.description}
																			</span>
																		</div>
																	))}
																</div>
															</details>
														)}
													</div>
												)}
											<article className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
												<ReactMarkdown
													components={{
														h1({ children, ...props }) {
															const text = String(children).replace(
																/\*\*/g,
																"",
															);
															const id = text
																.toLowerCase()
																.replace(/[^a-z0-9]+/g, "-")
																.replace(/(^-|-$)/g, "");
															return (
																<h1 id={id} {...props}>
																	{children}
																</h1>
															);
														},
														h2({ children, ...props }) {
															const text = String(children).replace(
																/\*\*/g,
																"",
															);
															const id = text
																.toLowerCase()
																.replace(/[^a-z0-9]+/g, "-")
																.replace(/(^-|-$)/g, "");
															return (
																<h2 id={id} {...props}>
																	{children}
																</h2>
															);
														},
														h3({ children, ...props }) {
															const text = String(children).replace(
																/\*\*/g,
																"",
															);
															const id = text
																.toLowerCase()
																.replace(/[^a-z0-9]+/g, "-")
																.replace(/(^-|-$)/g, "");
															return (
																<h3 id={id} {...props}>
																	{children}
																</h3>
															);
														},
														code({ className, children, ...props }) {
															const match = /language-(\w+)/.exec(
																className || "",
															);
															const codeStr = String(children).replace(
																/\n$/,
																"",
															);

															if (match?.[1] === "mermaid") {
																return <MermaidRenderer code={codeStr} />;
															}

															if (!match) {
																return (
																	<code
																		className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono"
																		{...props}
																	>
																		{children}
																	</code>
																);
															}

															return (
																<pre className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-4 overflow-x-auto">
																	<code
																		className={`${className} text-xs font-mono`}
																		{...props}
																	>
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
					</div>
				)}
			</div>

			{/* Saved Reports Drawer */}
			{reportsOpen && (
				<div className="fixed inset-0 z-50 flex justify-end">
					<div
						className="absolute inset-0 bg-black/30 backdrop-blur-sm"
						onClick={() => setReportsOpen(false)}
					/>
					<div className="relative w-full max-w-md bg-white dark:bg-zinc-950 h-full shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-300">
						<div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
							<div className="flex items-center gap-3">
								<div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
									<BookMarked className="h-5 w-5 text-blue-600 dark:text-blue-400" />
								</div>
								<div>
									<h2 className="text-lg font-semibold">Saved Reports</h2>
									<p className="text-xs text-zinc-500">
										{savedReports.length} report
										{savedReports.length !== 1 ? "s" : ""}
									</p>
								</div>
							</div>
							<button
								onClick={() => setReportsOpen(false)}
								className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
							>
								<X className="h-4 w-4" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto">
							{savedReports.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-64 text-zinc-400 space-y-2">
									<BookMarked className="h-10 w-10 opacity-30" />
									<p className="text-sm">No saved reports yet</p>
									<p className="text-xs text-center max-w-xs">
										Select papers and synthesize a report, then save it for
										later.
									</p>
								</div>
							) : (
								<div className="p-4 space-y-2">
									{savedReports.map((report) => (
										<div
											key={report.id}
											className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-3 hover:border-blue-300 dark:hover:border-blue-700 transition group"
										>
											<div className="flex items-start justify-between gap-2">
												<button
													onClick={() => {
														setViewingReport(report);
														setReportsOpen(false);
													}}
													className="flex-1 text-left space-y-1"
												>
													<p className="text-sm font-medium line-clamp-2">
														{report.title}
													</p>
													<div className="flex items-center gap-2 text-[10px] text-zinc-400">
														<span className="flex items-center gap-1">
															<Clock className="h-2.5 w-2.5" />
															{new Date(report.created_at).toLocaleDateString(
																"en-US",
																{
																	month: "short",
																	day: "numeric",
																	year: "numeric",
																},
															)}
														</span>
														<span>{report.paper_count} papers</span>
													</div>
												</button>
												<button
													onClick={() => handleDeleteReport(report.id)}
													className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950 opacity-0 group-hover:opacity-100 transition"
													title="Delete report"
												>
													<Trash2 className="h-3.5 w-3.5 text-red-500" />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Viewing a Saved Report */}
			{viewingReport && (
				<div className="fixed inset-0 z-50 flex justify-end">
					<div
						className="absolute inset-0 bg-black/30 backdrop-blur-sm"
						onClick={() => setViewingReport(null)}
					/>
					<div className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 h-full shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-300">
						<div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
							<div className="flex items-center gap-3">
								<div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
									<FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
								</div>
								<div>
									<h2 className="text-lg font-semibold line-clamp-1">
										{viewingReport.title}
									</h2>
									<p className="text-xs text-zinc-500">
										{viewingReport.paper_count} papers ·{" "}
										{new Date(viewingReport.created_at).toLocaleDateString(
											"en-US",
											{ month: "long", day: "numeric", year: "numeric" },
										)}
									</p>
								</div>
							</div>
							<div className="flex items-center gap-1.5">
								<button
									onClick={() => {
										navigator.clipboard.writeText(viewingReport.markdown);
										setCopied(true);
										setTimeout(() => setCopied(false), 2000);
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
								>
									{copied ? (
										<Check className="h-3.5 w-3.5 text-emerald-500" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
									{copied ? "Copied" : "Copy"}
								</button>
								<button
									onClick={() => {
										const blob = new Blob([viewingReport.markdown], {
											type: "text/markdown",
										});
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = `${viewingReport.title
											.replace(/[^a-zA-Z0-9 ]/g, "")
											.replace(/\s+/g, "-")
											.toLowerCase()}.md`;
										a.click();
										URL.revokeObjectURL(url);
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
									title="Download as .md file"
								>
									<Download className="h-3.5 w-3.5" />
									Download
								</button>
								{savedReports.some((r) => r.id === viewingReport.id) ? (
									<button
										onClick={() => handleDeleteReport(viewingReport.id)}
										className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border"
										title="Remove from saved reports"
									>
										<BookMarked className="h-3.5 w-3.5" />
										Unsave
									</button>
								) : (
									<button
										onClick={handleResaveReport}
										disabled={savingReport}
										className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition border disabled:opacity-50"
										title="Save report"
									>
										{savingReport ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<Save className="h-3.5 w-3.5" />
										)}
										Save
									</button>
								)}
								<button
									onClick={() => setViewingReport(null)}
									className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							<article className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
								<ReactMarkdown
									components={{
										code({ className, children, ...props }) {
											const match = /language-(\w+)/.exec(className || "");
											const codeStr = String(children).replace(/\n$/, "");
											if (match?.[1] === "mermaid") {
												return <MermaidRenderer code={codeStr} />;
											}
											if (!match) {
												return (
													<code
														className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono"
														{...props}
													>
														{children}
													</code>
												);
											}
											return (
												<pre className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-4 overflow-x-auto">
													<code
														className={`${className} text-xs font-mono`}
														{...props}
													>
														{children}
													</code>
												</pre>
											);
										},
									}}
								>
									{viewingReport.markdown}
								</ReactMarkdown>
							</article>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
