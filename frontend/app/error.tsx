"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Unhandled error:", error);
	}, [error]);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black px-4">
			<div className="flex flex-col items-center gap-6 text-center max-w-md">
				<div className="flex items-center justify-center h-20 w-20 rounded-full bg-red-50 dark:bg-red-950/30">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="h-8 w-8 text-red-500"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
				</div>
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
						Something went wrong
					</h1>
					<p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
						An unexpected error occurred. Please try again or return to the home
						page.
					</p>
				</div>
				<div className="flex gap-3">
					<button
						onClick={reset}
						className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 px-6 text-sm font-medium text-black dark:text-white transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
					>
						Try Again
					</button>
					<Link
						href="/"
						className="inline-flex h-10 items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
					>
						Back to Home
					</Link>
				</div>
			</div>
		</div>
	);
}
