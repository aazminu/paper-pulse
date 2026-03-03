"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";

interface PageLoaderProps {
	message?: string;
}

export function PageLoader({ message = "Loading..." }: PageLoaderProps) {
	return (
		<div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-50 dark:bg-black">
			<div className="flex flex-col items-center gap-4">
				<div className="relative h-10 w-10">
					<div className="absolute inset-0 rounded-full border-2 border-zinc-200 dark:border-zinc-800" />
					<div className="absolute inset-0 rounded-full border-2 border-transparent border-t-black dark:border-t-white animate-spin" />
				</div>
				<p className="text-sm text-zinc-500 dark:text-zinc-400 animate-pulse">
					{message}
				</p>
			</div>
		</div>
	);
}

export function RedirectLoader({
	to,
	message,
}: {
	to: string;
	message?: string;
}) {
	const router = useRouter();

	useEffect(() => {
		router.push(to);
	}, [router, to]);

	return <PageLoader message={message ?? "Redirecting..."} />;
}

export function useAuthGuard(): {
	ready: boolean;
	user: ReturnType<typeof useAuth>["user"];
} {
	const { user, isLoaded } = useAuth();
	const router = useRouter();

	useEffect(() => {
		if (isLoaded && !user) {
			router.push("/sign-in");
		}
	}, [isLoaded, user, router]);

	return { ready: isLoaded && !!user, user };
}
