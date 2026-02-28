"use client";

import { useState } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User as UserIcon, BookOpen } from "lucide-react";

interface Source {
	arxiv_id: string;
	title: string;
	abstract: string;
}

interface Message {
	role: "user" | "ai";
	content: string;
	sources?: Source[];
}

export default function AskPage() {
	const { user, isLoaded } = useUser();
	const [query, setQuery] = useState("");
	const [messages, setMessages] = useState<Message[]>([
		{
			role: "ai",
			content:
				"Hello! I am your research assistant. Ask me anything about the papers in your personal database.",
		},
	]);
	const [isLoading, setIsLoading] = useState(false);

	const handleAsk = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim() || !user) return;

		const userMessage = query.trim();
		setQuery("");
		setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
		setIsLoading(true);

		try {
			const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ask/`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					user_id: user.id,
					question: userMessage,
				}),
			});

			if (res.ok) {
				const data = await res.json();
				setMessages((prev) => [
					...prev,
					{ role: "ai", content: data.answer, sources: data.sources },
				]);
			} else {
				setMessages((prev) => [
					...prev,
					{
						role: "ai",
						content:
							"Sorry, I encountered an error connecting to the database.",
					},
				]);
			}
		} catch (error) {
			console.error("Error asking question:", error);
			setMessages((prev) => [
				...prev,
				{ role: "ai", content: "Network error. Is the backend running?" },
			]);
		} finally {
			setIsLoading(false);
		}
	};

	if (!isLoaded) return null;

	return (
		<div className="flex flex-col min-h-screen bg-zinc-50 dark:bg-black">
			{/* Navigation Header */}
			<header className="border-b bg-white dark:bg-zinc-950 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shrink-0">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight">PaperPulse</h1>
					<nav className="hidden sm:flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
						<Link
							href="/feed"
							className="hover:text-black dark:hover:text-white transition"
						>
							Daily Feed
						</Link>
						<Link href="/ask" className="text-black dark:text-white">
							Ask AI
						</Link>
					</nav>
				</div>
				<UserButton />
			</header>

			{/* Chat Area */}
			<main className="grow flex flex-col max-w-4xl w-full mx-auto p-4 sm:p-6 overflow-hidden">
				<div className="grow overflow-y-auto space-y-6 pb-6 pr-2">
					{messages.map((msg, index) => (
						<div
							key={index}
							className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
						>
							{/* AI Avatar */}
							{msg.role === "ai" && (
								<div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0 mt-1">
									<Bot className="h-5 w-5 text-blue-600 dark:text-blue-400" />
								</div>
							)}

							{/* Message Bubble */}
							<div
								className={`max-w-[85%] rounded-2xl p-4 ${
									msg.role === "user"
										? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black rounded-tr-sm"
										: "bg-white dark:bg-zinc-900 border shadow-sm rounded-tl-sm text-zinc-800 dark:text-zinc-200"
								}`}
							>
								<p className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
									{msg.content}
								</p>

								{/* Sources List */}
								{msg.sources && msg.sources.length > 0 && (
									<div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
										<p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
											Sources Referenced
										</p>
										{msg.sources.map((source, idx) => (
											<div
												key={idx}
												className="flex gap-2 items-start bg-zinc-50 dark:bg-zinc-950 p-2 rounded-md border text-xs"
											>
												<BookOpen className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
												<div>
													<p className="font-medium line-clamp-1">
														{source.title}
													</p>
													<a
														href={`https://arxiv.org/abs/${source.arxiv_id}`}
														target="_blank"
														rel="noopener noreferrer"
														className="text-blue-600 hover:underline mt-1 inline-block"
													>
														arxiv.org/abs/{source.arxiv_id}
													</a>
												</div>
											</div>
										))}
									</div>
								)}
							</div>

							{/* User Avatar */}
							{msg.role === "user" && (
								<div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-1">
									<UserIcon className="h-5 w-5 text-zinc-500" />
								</div>
							)}
						</div>
					))}

					{isLoading && (
						<div className="flex gap-4 justify-start">
							<div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0 mt-1">
								<Bot className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
							</div>
							<div className="bg-white dark:bg-zinc-900 border shadow-sm rounded-2xl rounded-tl-sm p-4 text-zinc-500 text-sm">
								Searching your database and thinking...
							</div>
						</div>
					)}
				</div>

				{/* Input Area */}
				<div className="pt-4 shrink-0 mt-auto bg-zinc-50 dark:bg-black">
					<form onSubmit={handleAsk} className="flex gap-2 relative">
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Ask a question about your papers..."
							className="pr-12 py-6 rounded-xl shadow-sm bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-800 focus-visible:ring-blue-500"
							disabled={isLoading}
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!query.trim() || isLoading}
							className="absolute right-1.5 top-1.5 h-9 w-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
						>
							<Send className="h-4 w-4" />
						</Button>
					</form>
					<p className="text-center text-xs text-zinc-400 mt-3">
						AI can make mistakes. Verify information from the cited sources.
					</p>
				</div>
			</main>
		</div>
	);
}
