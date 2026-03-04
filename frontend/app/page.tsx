"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import UserMenu from "@/components/user-menu";
import Logo from "@/components/logo";
import {
	Newspaper,
	Brain,
	Network,
	MessageSquareText,
	Sun,
	Moon,
} from "lucide-react";

const FEATURES = [
	{
		icon: Newspaper,
		title: "Daily Research Feed",
		description:
			"Papers from ArXiv, Semantic Scholar, PubMed & OpenAlex, ranked by relevance to your interests.",
	},
	{
		icon: Brain,
		title: "AI Summaries & Q&A",
		description:
			"Three-sentence summaries for every paper. Ask questions and get cited answers from full-text content.",
	},
	{
		icon: Network,
		title: "Knowledge Graph",
		description:
			"Explore how papers, authors, concepts, and institutions connect in an interactive graph.",
	},
	{
		icon: MessageSquareText,
		title: "Literature Synthesis",
		description:
			"Generate structured literature reviews with citation diagrams from selected papers.",
	},
];

export default function Home() {
	const { user, isLoaded } = useAuth();
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		const id = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950 font-sans">
			{/* Top bar */}
			<header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
				<Logo size="md" />
				<div className="flex items-center gap-3">
					{mounted && (
						<button
							onClick={() =>
								setTheme(theme === "dark" ? "light" : "dark")
							}
							className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
							title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
						>
							{theme === "dark" ? (
								<Sun className="h-4 w-4" />
							) : (
								<Moon className="h-4 w-4" />
							)}
						</button>
					)}
					{isLoaded && user && <UserMenu />}
				</div>
			</header>

			{/* Hero */}
			<main className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
				<div className="flex flex-col items-center gap-6 text-center max-w-2xl">
					{/* Headline */}
					<h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl lg:text-6xl">
						Your AI Research
						<br />
						<span className="text-indigo-600 dark:text-indigo-400">
							Assistant
						</span>
					</h1>

					{/* Subtitle */}
					<p className="max-w-lg text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
						PaperPulse reads thousands of papers daily across four major
						databases, ranks them for your interests, and lets you explore
						research like never before.
					</p>

					{/* CTA */}
					<div className="flex flex-col gap-3 sm:flex-row items-center mt-2">
						{isLoaded && !user && (
							<>
								<Link
									href="/sign-up"
									className="flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md active:scale-[0.98]"
								>
									Get Started Free
								</Link>
								<Link
									href="/sign-in"
									className="flex h-11 w-full sm:w-auto items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700 px-6 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
								>
									Sign In
								</Link>
							</>
						)}
						{isLoaded && user && (
							<Link
								href="/feed"
								className="flex h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md active:scale-[0.98]"
							>
								Go to my Feed
							</Link>
						)}
					</div>
				</div>

				{/* Feature cards */}
				<div className="mt-20 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl w-full">
					{FEATURES.map((feature) => (
						<div
							key={feature.title}
							className="group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 transition-all hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm"
						>
							<div className="flex items-start gap-3">
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 transition-colors group-hover:bg-indigo-200 dark:group-hover:bg-indigo-900/60">
									<feature.icon className="h-4.5 w-4.5" />
								</div>
								<div>
									<h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
										{feature.title}
									</h3>
									<p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
										{feature.description}
									</p>
								</div>
							</div>
						</div>
					))}
				</div>

				{/* Source badges */}
				<div className="mt-16 flex flex-col items-center gap-3">
					<p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
						Papers from
					</p>
					<div className="flex flex-wrap justify-center gap-2">
						{["ArXiv", "Semantic Scholar", "PubMed", "OpenAlex"].map(
							(source) => (
								<span
									key={source}
									className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400"
								>
									{source}
								</span>
							),
						)}
					</div>
				</div>
			</main>

			{/* Footer */}
			<footer className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-6">
				<div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400 dark:text-zinc-500">
					<span>&copy; {new Date().getFullYear()} PaperPulse</span>
					<span>Built with Next.js, FastAPI, Neo4j &amp; OpenAI</span>
				</div>
			</footer>
		</div>
	);
}
