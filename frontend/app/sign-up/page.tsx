"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/logo";

function GoogleIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				fill="#EA4335"
			/>
		</svg>
	);
}

function GitHubIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
			<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
		</svg>
	);
}

export default function SignUpPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		const supabase = createClient();
		const { error: authError } = await supabase.auth.signUp({
			email,
			password,
		});

		if (authError) {
			setError(authError.message);
			setLoading(false);
			return;
		}

		router.push("/onboarding");
		router.refresh();
	};

	const handleOAuth = async (provider: "google" | "github") => {
		const supabase = createClient();
		await supabase.auth.signInWithOAuth({
			provider,
			options: {
				redirectTo: `${window.location.origin}/auth/callback`,
			},
		});
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950 px-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="flex flex-col items-center gap-3 text-center">
					<Logo size="lg" href="/" />
					<div className="mt-1">
						<h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
							Create your account
						</h1>
						<p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
							Sign up to get your personalized research digest.
						</p>
					</div>
				</div>

				<div className="space-y-3">
					<Button
						type="button"
						variant="outline"
						className="w-full h-10"
						onClick={() => handleOAuth("google")}
					>
						<GoogleIcon />
						Continue with Google
					</Button>
					<Button
						type="button"
						variant="outline"
						className="w-full h-10"
						onClick={() => handleOAuth("github")}
					>
						<GitHubIcon />
						Continue with GitHub
					</Button>
				</div>

				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-white px-2 text-zinc-400 dark:bg-zinc-950 dark:text-zinc-500">
							or continue with email
						</span>
					</div>
				</div>

				<form onSubmit={handleSignUp} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							placeholder="you@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							placeholder="At least 6 characters"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={6}
						/>
					</div>

					{error && (
						<p className="text-sm text-red-500 dark:text-red-400">{error}</p>
					)}

					<Button type="submit" className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white" disabled={loading}>
						{loading ? "Creating account..." : "Sign Up"}
					</Button>
				</form>

				<p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
					Already have an account?{" "}
					<Link
						href="/sign-in"
						className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
					>
						Sign in
					</Link>
				</p>
			</div>
		</div>
	);
}
