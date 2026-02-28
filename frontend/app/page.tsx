import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Home() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
			<main className="flex w-full max-w-3xl flex-col items-center gap-8 text-center px-6 sm:px-16">
				<h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50 sm:text-6xl">
					PaperPulse
				</h1>
				<p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
					Your personal research assistant that reads ArXiv so you don&apos;t
					have to. Get daily, tailored summaries and AI answers from the latest
					papers.
				</p>

				<div className="flex flex-col gap-4 text-base font-medium sm:flex-row items-center mt-4">
					<SignedOut>
						<Link
							href="/sign-in"
							className="flex h-12 w-full sm:w-auto items-center justify-center rounded-full border border-solid border-black/[.08] px-8 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
						>
							Sign In
						</Link>
						<Link
							href="/sign-up"
							className="flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-foreground px-8 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
						>
							Get Started
						</Link>
					</SignedOut>

					<SignedIn>
						<Link
							href="/feed"
							className="flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-foreground px-8 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
						>
							Go to my Feed
						</Link>
						<div className="mt-4 sm:mt-0 sm:ml-4">
							<UserButton />
						</div>
					</SignedIn>
				</div>
			</main>
		</div>
	);
}
