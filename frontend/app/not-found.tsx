import Link from "next/link";

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black px-4">
			<div className="flex flex-col items-center gap-6 text-center max-w-md">
				<div className="flex items-center justify-center h-20 w-20 rounded-full bg-zinc-100 dark:bg-zinc-900">
					<span className="text-3xl font-bold text-zinc-400 dark:text-zinc-500">
						404
					</span>
				</div>
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
						Page not found
					</h1>
					<p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
						The page you&apos;re looking for doesn&apos;t exist or has been
						moved.
					</p>
				</div>
				<Link
					href="/"
					className="inline-flex h-10 items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
				>
					Back to Home
				</Link>
			</div>
		</div>
	);
}
