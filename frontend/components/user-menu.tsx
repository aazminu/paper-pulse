"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { LogOut } from "lucide-react";

export default function UserMenu() {
	const { user } = useAuth();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	const handleSignOut = async () => {
		const supabase = createClient();
		await supabase.auth.signOut();
		router.push("/");
	};

	if (!user) return null;

	const initials = (user.email ?? "U")[0].toUpperCase();

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={() => setOpen(!open)}
				className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-sm font-semibold text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900 transition-colors"
			>
				{initials}
			</button>

			{open && (
				<div className="absolute right-0 mt-2 w-56 rounded-lg border border-zinc-200 bg-white shadow-lg dark:bg-zinc-900 dark:border-zinc-800 z-50 overflow-hidden">
					<div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
						<p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
							{user.email}
						</p>
					</div>
					<button
						onClick={handleSignOut}
						className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
					>
						<LogOut className="h-4 w-4" />
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}
