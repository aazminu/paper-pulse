import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
	const { searchParams, origin } = new URL(request.url);
	const code = searchParams.get("code");
	const next = searchParams.get("next");

	if (code) {
		const supabase = await createClient();
		const { error } = await supabase.auth.exchangeCodeForSession(code);

		if (!error) {
			const forwardedHost = request.headers.get("x-forwarded-host");
			const isLocalEnv = process.env.NODE_ENV === "development";
			const baseUrl = isLocalEnv
				? origin
				: forwardedHost
					? `https://${forwardedHost}`
					: origin;

			if (next) {
				return NextResponse.redirect(`${baseUrl}${next}`);
			}

			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (user) {
				try {
					const apiUrl =
						process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
					const {
						data: { session },
					} = await supabase.auth.getSession();
					const res = await fetch(`${apiUrl}/users/${user.id}`, {
						headers: session?.access_token
							? { Authorization: `Bearer ${session.access_token}` }
							: {},
					});
					if (res.ok) {
						return NextResponse.redirect(`${baseUrl}/feed`);
					}
				} catch {}
			}

			return NextResponse.redirect(`${baseUrl}/onboarding`);
		}
	}

	return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
