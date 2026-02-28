"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
	Send,
	Bot,
	User as UserIcon,
	BookOpen,
	Paperclip,
	Mic,
	Square,
	X,
	FileText,
	Image as ImageIcon,
	Film,
	Music,
} from "lucide-react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface Source {
	arxiv_id: string;
	title: string;
	abstract: string;
}

interface AttachedFile {
	file: File;
	preview?: string; // data URL for image previews
	type: "image" | "pdf" | "word" | "audio" | "video" | "text";
}

interface Message {
	role: "user" | "ai";
	content: string;
	sources?: Source[];
	attachments?: { name: string; type: string }[];
}

// Custom renderers to ensure proper spacing
const markdownComponents: Components = {
	p: ({ children }) => (
		<p className="mb-3 leading-relaxed last:mb-0">{children}</p>
	),
	h2: ({ children }) => (
		<h2 className="text-lg font-bold mt-6 mb-3 pb-1 border-b border-zinc-200 dark:border-zinc-700">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-base font-semibold mt-5 mb-2 text-zinc-900 dark:text-zinc-100">
			{children}
		</h3>
	),
	h4: ({ children }) => (
		<h4 className="text-sm font-semibold mt-4 mb-1.5 text-zinc-800 dark:text-zinc-200">
			{children}
		</h4>
	),
	ul: ({ children }) => (
		<ul className="my-3 pl-5 space-y-2 list-disc">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="my-3 pl-5 space-y-2 list-decimal">{children}</ol>
	),
	li: ({ children }) => (
		<li className="leading-relaxed pl-1 [&>p]:inline [&>p]:mb-0">{children}</li>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-4 pl-4 border-l-2 border-blue-400 dark:border-blue-600 text-zinc-600 dark:text-zinc-400 italic">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-5 border-zinc-200 dark:border-zinc-700" />,
	pre: ({ children }) => (
		<pre className="my-4 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto text-sm">
			{children}
		</pre>
	),
	code: ({ children, className }) => {
		const isBlock = className?.includes("language-");
		if (isBlock) return <code className={className}>{children}</code>;
		return (
			<code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 rounded text-sm">
				{children}
			</code>
		);
	},
	strong: ({ children }) => (
		<strong className="font-semibold text-zinc-900 dark:text-zinc-100">
			{children}
		</strong>
	),
	em: ({ children }) => (
		<em className="italic text-zinc-700 dark:text-zinc-300">{children}</em>
	),
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-blue-600 dark:text-blue-400 hover:underline"
		>
			{children}
		</a>
	),
};

const ACCEPTED_TYPES: Record<string, string> = {
	"image/png": "image",
	"image/jpeg": "image",
	"image/gif": "image",
	"image/webp": "image",
	"application/pdf": "pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		"word",
	"application/msword": "word",
	"audio/mpeg": "audio",
	"audio/mp3": "audio",
	"audio/wav": "audio",
	"audio/x-wav": "audio",
	"audio/m4a": "audio",
	"audio/mp4": "audio",
	"audio/webm": "audio",
	"audio/ogg": "audio",
	"video/mp4": "video",
	"video/quicktime": "video",
	"video/webm": "video",
	"video/x-matroska": "video",
	"text/plain": "text",
	"text/csv": "text",
	"text/markdown": "text",
	"application/json": "text",
};

function getFileIcon(type: string) {
	switch (type) {
		case "image":
			return <ImageIcon className="h-4 w-4" />;
		case "pdf":
		case "word":
		case "text":
			return <FileText className="h-4 w-4" />;
		case "audio":
			return <Music className="h-4 w-4" />;
		case "video":
			return <Film className="h-4 w-4" />;
		default:
			return <FileText className="h-4 w-4" />;
	}
}

function classifyFile(file: File): string {
	return ACCEPTED_TYPES[file.type] || "text";
}

export default function AskPage() {
	const { user, isLoaded } = useUser();
	const [query, setQuery] = useState("");
	const [messages, setMessages] = useState<Message[]>([
		{
			role: "ai",
			content:
				"Hello! I'm your research assistant. Ask me anything about your papers, or attach images, PDFs, audio, video, and documents for me to analyze.",
		},
	]);
	const [isLoading, setIsLoading] = useState(false);
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [recordingTime, setRecordingTime] = useState(0);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const chatEndRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom on new messages
	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading]);

	// Auto-resize textarea
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height =
				Math.min(textareaRef.current.scrollHeight, 160) + "px";
		}
	}, [query]);

	const addFiles = useCallback((fileList: FileList | File[]) => {
		const newFiles: AttachedFile[] = [];
		for (const file of Array.from(fileList)) {
			if (file.size > 25 * 1024 * 1024) {
				alert(`${file.name} exceeds 25MB limit`);
				continue;
			}
			const type = classifyFile(file) as AttachedFile["type"];
			const attached: AttachedFile = { file, type };

			if (type === "image") {
				attached.preview = URL.createObjectURL(file);
			}
			newFiles.push(attached);
		}
		setAttachedFiles((prev) => [...prev, ...newFiles]);
	}, []);

	const removeFile = (index: number) => {
		setAttachedFiles((prev) => {
			const removed = prev[index];
			if (removed.preview) URL.revokeObjectURL(removed.preview);
			return prev.filter((_, i) => i !== index);
		});
	};

	// Voice recording
	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const recorder = new MediaRecorder(stream);
			audioChunksRef.current = [];

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) audioChunksRef.current.push(e.data);
			};

			recorder.onstop = () => {
				const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
				const file = new File([blob], `voice-${Date.now()}.webm`, {
					type: "audio/webm",
				});
				addFiles([file]);
				stream.getTracks().forEach((t) => t.stop());
			};

			recorder.start();
			mediaRecorderRef.current = recorder;
			setIsRecording(true);
			setRecordingTime(0);
			recordingIntervalRef.current = setInterval(
				() => setRecordingTime((t) => t + 1),
				1000,
			);
		} catch {
			alert("Microphone access denied. Please allow microphone access.");
		}
	};

	const stopRecording = () => {
		mediaRecorderRef.current?.stop();
		setIsRecording(false);
		if (recordingIntervalRef.current) {
			clearInterval(recordingIntervalRef.current);
			recordingIntervalRef.current = null;
		}
	};

	// Drag and drop
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};
	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	};
	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
	};

	const handleAsk = async (e: React.FormEvent) => {
		e.preventDefault();
		if ((!query.trim() && attachedFiles.length === 0) || !user) return;

		const userMessage = query.trim();
		const currentFiles = [...attachedFiles];
		setQuery("");
		setAttachedFiles([]);

		// Reset textarea height
		if (textareaRef.current) textareaRef.current.style.height = "auto";

		// Build conversation history (skip initial greeting, last 10 messages, truncated)
		const history = messages
			.slice(1) // skip the initial AI greeting
			.slice(-10) // last 10 messages
			.map((m) => ({
				role: m.role === "ai" ? "assistant" : "user",
				content: m.content.substring(0, 3000),
			}));

		setMessages((prev) => [
			...prev,
			{
				role: "user",
				content: userMessage || "(attached files)",
				attachments: currentFiles.map((f) => ({
					name: f.file.name,
					type: f.type,
				})),
			},
		]);
		setIsLoading(true);

		try {
			let data;

			if (currentFiles.length > 0) {
				// Multimodal request with files
				const formData = new FormData();
				formData.append("user_id", user.id);
				formData.append("question", userMessage);
				formData.append("history", JSON.stringify(history));
				for (const af of currentFiles) {
					formData.append("files", af.file);
				}

				const res = await fetch(
					`${process.env.NEXT_PUBLIC_API_URL}/ask/multimodal`,
					{ method: "POST", body: formData },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				data = await res.json();
			} else {
				// Text-only request
				const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ask/`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						user_id: user.id,
						question: userMessage,
						history,
					}),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				data = await res.json();
			}

			setMessages((prev) => [
				...prev,
				{ role: "ai", content: data.answer, sources: data.sources },
			]);
		} catch (error) {
			console.error("Error asking question:", error);
			setMessages((prev) => [
				...prev,
				{
					role: "ai",
					content:
						"Sorry, I encountered an error. Please check the backend is running.",
				},
			]);
		} finally {
			setIsLoading(false);
			// Clean up image previews
			currentFiles.forEach((f) => {
				if (f.preview) URL.revokeObjectURL(f.preview);
			});
		}
	};

	if (!isLoaded) return null;

	return (
		<div
			className="flex flex-col min-h-screen bg-zinc-50 dark:bg-black"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Drag overlay */}
			{isDragging && (
				<div className="fixed inset-0 z-50 bg-blue-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
					<div className="bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-2xl border-2 border-dashed border-blue-500">
						<p className="text-lg font-medium text-blue-600 dark:text-blue-400">
							Drop files here to attach
						</p>
						<p className="text-sm text-zinc-500 mt-1">
							Images, PDFs, Word docs, audio, video
						</p>
					</div>
				</div>
			)}

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
								{msg.role === "user" ? (
									<div>
										{msg.content !== "(attached files)" && (
											<p className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
												{msg.content}
											</p>
										)}
										{/* Show attached file badges */}
										{msg.attachments && msg.attachments.length > 0 && (
											<div className="flex flex-wrap gap-1.5 mt-2">
												{msg.attachments.map((att, i) => (
													<span
														key={i}
														className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 dark:bg-black/20 text-xs"
													>
														{getFileIcon(att.type)}
														<span className="max-w-30 truncate">
															{att.name}
														</span>
													</span>
												))}
											</div>
										)}
									</div>
								) : (
									<div className="text-sm sm:text-base text-zinc-800 dark:text-zinc-200">
										<ReactMarkdown
											remarkPlugins={[remarkGfm, remarkMath]}
											rehypePlugins={[
												[rehypeKatex, { throwOnError: false, strict: false }],
											]}
											components={markdownComponents}
										>
											{msg.content}
										</ReactMarkdown>
									</div>
								)}

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
								{attachedFiles.length > 0
									? "Processing files and searching your database..."
									: "Searching your database and thinking..."}
							</div>
						</div>
					)}
					<div ref={chatEndRef} />
				</div>

				{/* Input Area */}
				<div className="pt-4 shrink-0 mt-auto bg-zinc-50 dark:bg-black">
					{/* File previews */}
					{attachedFiles.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-3 px-1">
							{attachedFiles.map((af, index) => (
								<div
									key={index}
									className="relative group flex items-center gap-2 bg-white dark:bg-zinc-900 border rounded-lg px-3 py-2 text-xs shadow-sm"
								>
									{af.preview ? (
										<Image
											src={af.preview}
											alt={af.file.name}
											width={40}
											height={40}
											className="h-10 w-10 rounded object-cover"
											unoptimized
										/>
									) : (
										<div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
											{getFileIcon(af.type)}
										</div>
									)}
									<div className="max-w-25">
										<p className="font-medium truncate">{af.file.name}</p>
										<p className="text-zinc-400">
											{(af.file.size / 1024).toFixed(0)}KB
										</p>
									</div>
									<button
										onClick={() => removeFile(index)}
										className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}

					<form onSubmit={handleAsk} className="relative">
						<div className="flex items-end gap-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition">
							{/* Attach button */}
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={isLoading}
								className="p-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition disabled:opacity-50"
								title="Attach files"
							>
								<Paperclip className="h-5 w-5" />
							</button>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								accept={Object.keys(ACCEPTED_TYPES).join(",")}
								onChange={(e) => {
									if (e.target.files) addFiles(e.target.files);
									e.target.value = "";
								}}
								className="hidden"
							/>

							{/* Text input */}
							<textarea
								ref={textareaRef}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleAsk(e);
									}
								}}
								placeholder={
									attachedFiles.length > 0
										? "Ask about the attached files..."
										: "Ask a question about your papers..."
								}
								rows={1}
								disabled={isLoading}
								className="flex-1 py-3 bg-transparent border-0 resize-none focus:outline-none text-sm sm:text-base placeholder:text-zinc-400 disabled:opacity-50 max-h-40"
							/>

							{/* Voice record button */}
							{!isRecording ? (
								<button
									type="button"
									onClick={startRecording}
									disabled={isLoading}
									className="p-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition disabled:opacity-50"
									title="Record voice"
								>
									<Mic className="h-5 w-5" />
								</button>
							) : (
								<button
									type="button"
									onClick={stopRecording}
									className="p-3 text-red-500 animate-pulse"
									title="Stop recording"
								>
									<Square className="h-5 w-5 fill-current" />
									<span className="sr-only">Recording: {recordingTime}s</span>
								</button>
							)}

							{/* Send button */}
							<Button
								type="submit"
								size="icon"
								disabled={
									(!query.trim() && attachedFiles.length === 0) || isLoading
								}
								className="m-1.5 h-9 w-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shrink-0"
							>
								<Send className="h-4 w-4" />
							</Button>
						</div>

						{/* Recording indicator */}
						{isRecording && (
							<div className="absolute -top-8 left-0 right-0 flex items-center justify-center">
								<span className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs rounded-full border border-red-200 dark:border-red-800">
									<span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
									Recording... {recordingTime}s
								</span>
							</div>
						)}
					</form>

					<p className="text-center text-xs text-zinc-400 mt-3">
						Attach images, PDFs, docs, audio, or video. AI can make mistakes.
					</p>
				</div>
			</main>
		</div>
	);
}
