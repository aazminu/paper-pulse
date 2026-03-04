"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Menu, X } from "lucide-react";
import Logo from "@/components/logo";
import UserMenu from "@/components/user-menu";

const NAV_LINKS = [
	{ href: "/feed", label: "Feed" },
	{ href: "/saved", label: "Saved" },
	{ href: "/ask", label: "Ask AI" },
	{ href: "/graph", label: "Graph" },
];

interface NavbarProps {
	/** Extra elements to render on the right side (before UserMenu) */
	rightContent?: React.ReactNode;
	/** Extra elements to render on the left side (before Logo) */
	leftContent?: React.ReactNode;
}

export default function Navbar({ rightContent, leftContent }: NavbarProps) {
	const pathname = usePathname();
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	useEffect(() => {
		const id = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 sm:px-6 py-3 flex justify-between items-center sticky top-0 z-40 shrink-0 backdrop-blur-sm">
			<div className="flex items-center gap-3 sm:gap-5">
				{leftContent}
				<Logo size="sm" href="/feed" />

				{/* Desktop nav */}
				<nav className="hidden sm:flex items-center gap-1 ml-1">
					{NAV_LINKS.map((link) => {
						const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
						return (
							<Link
								key={link.href}
								href={link.href}
								className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
									isActive
										? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40"
										: "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
								}`}
							>
								{link.label}
							</Link>
						);
					})}
				</nav>
			</div>

			<div className="flex items-center gap-2">
				{rightContent}

				{/* Theme toggle */}
				{mounted && (
					<button
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
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

				{/* Mobile menu toggle */}
				<button
					onClick={() => setMobileOpen(!mobileOpen)}
					className="flex sm:hidden h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
					title="Menu"
				>
					{mobileOpen ? (
						<X className="h-4 w-4" />
					) : (
						<Menu className="h-4 w-4" />
					)}
				</button>

				<UserMenu />
			</div>

			{/* Mobile nav overlay */}
			{mobileOpen && (
				<div className="absolute top-full left-0 right-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg sm:hidden z-50">
					<nav className="flex flex-col p-2">
						{NAV_LINKS.map((link) => {
							const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
							return (
								<Link
									key={link.href}
									href={link.href}
									onClick={() => setMobileOpen(false)}
									className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
										isActive
											? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40"
											: "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
									}`}
								>
									{link.label}
								</Link>
							);
						})}
					</nav>
				</div>
			)}
		</header>
	);
}
