"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

// Initialize mermaid with a clean config
mermaid.initialize({
	startOnLoad: false,
	theme: "neutral",
	flowchart: {
		useMaxWidth: true,
		htmlLabels: true,
		curve: "basis",
		padding: 12,
	},
	themeVariables: {
		primaryColor: "#e0e7ff",
		primaryTextColor: "#1e1b4b",
		primaryBorderColor: "#818cf8",
		lineColor: "#94a3b8",
		secondaryColor: "#f0fdf4",
		tertiaryColor: "#fefce8",
		fontFamily: "Inter, system-ui, sans-serif",
		fontSize: "12px",
	},
});

let mermaidIdCounter = 0;

export function MermaidRenderer({ code }: { code: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const idRef = useRef(`mermaid-${++mermaidIdCounter}`);

	useEffect(() => {
		if (!code.trim()) return;

		let cancelled = false;

		async function render() {
			try {
				const { svg: renderedSvg } = await mermaid.render(
					idRef.current,
					code.trim(),
				);
				if (!cancelled) {
					setSvg(renderedSvg);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError("Could not render diagram");
					console.warn("Mermaid render error:", err);
				}
			}
		}

		render();
		return () => {
			cancelled = true;
		};
	}, [code]);

	if (error) {
		return (
			<div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 text-xs text-amber-700 dark:text-amber-400">
				<p className="font-medium mb-1">Diagram Preview</p>
				<pre className="whitespace-pre-wrap opacity-70 text-[11px]">{code}</pre>
			</div>
		);
	}

	if (!svg) {
		return (
			<div className="rounded-lg border bg-zinc-50 dark:bg-zinc-900 p-6 flex items-center justify-center">
				<div className="h-5 w-5 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin" />
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="rounded-lg border bg-white dark:bg-zinc-950 p-4 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
