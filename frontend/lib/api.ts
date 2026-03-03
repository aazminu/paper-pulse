import { createClient } from "@/utils/supabase/client";

/**
 * Authenticated fetch wrapper. Gets the current Supabase session token
 * and injects it as a Bearer Authorization header on every request.
 *
 * Drop-in replacement for `fetch()` in client components.
 */
export async function authFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const supabase = createClient();
	const {
		data: { session },
	} = await supabase.auth.getSession();

	const headers = new Headers(init?.headers);

	if (session?.access_token) {
		headers.set("Authorization", `Bearer ${session.access_token}`);
	}

	return fetch(input, { ...init, headers });
}
