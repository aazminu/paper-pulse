"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

export default function UnauthorizedPage() {
	const { user, isLoaded } = useAuth();

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black px-4">
			<div className="flex flex-col items-center gap-6 text-center max-w-md">
				<div className="flex items-center justify-center h-20 w-20 rounded-full bg-amber-50 dark:bg-amber-950/30">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="h-8 w-8 text-amber-500"
					>
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
				</div>
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
						Access denied
					</h1>
					<p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
						{isLoaded && !user
							? "You need to sign in to access this page."
							: "You don't have permission to view this page."}
					</p>
				</div>
				<div className="flex gap-3">
					{isLoaded && !user ? (
						<Link
							href="/sign-in"
							className="inline-flex h-10 items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
						>
							Sign In
						</Link>
					) : (
						<Link
							href="/feed"
							className="inline-flex h-10 items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
						>
							Go to Feed
						</Link>
					)}
					<Link
						href="/"
						className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 px-6 text-sm font-medium text-black dark:text-white transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
					>
						Back to Home
					</Link>
				</div>
			</div>
		</div>
	);
}
