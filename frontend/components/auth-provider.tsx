"use client";

import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";
import { createClient } from "@/utils/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthContextValue {
	user: User | null;
	isLoaded: boolean;
}

const AuthContext = createContext<AuthContextValue>({
	user: null,
	isLoaded: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [isLoaded, setIsLoaded] = useState(false);
	const supabase = createClient();

	useEffect(() => {
		supabase.auth.getUser().then(({ data }) => {
			setUser(data.user);
			setIsLoaded(true);
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			setUser(session?.user ?? null);
			setIsLoaded(true);
		});

		return () => subscription.unsubscribe();
	}, [supabase.auth]);

	return (
		<AuthContext.Provider value={{ user, isLoaded }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	return useContext(AuthContext);
}
