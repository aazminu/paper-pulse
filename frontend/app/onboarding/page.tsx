"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const AVAILABLE_DOMAINS = [
	// Core Sciences
	{ id: "cs", label: "Computer Science", category: "Core Sciences" },
	{ id: "math", label: "Mathematics", category: "Core Sciences" },
	{ id: "physics", label: "Physics", category: "Core Sciences" },
	{ id: "stat", label: "Statistics", category: "Core Sciences" },
	{ id: "chem", label: "Chemistry", category: "Core Sciences" },

	// Life & Health Sciences
	{ id: "q-bio", label: "Quantitative Biology", category: "Life & Health" },
	{ id: "bio", label: "Biology", category: "Life & Health" },
	{ id: "med", label: "Medicine", category: "Life & Health" },
	{ id: "psych", label: "Psychology", category: "Life & Health" },
	{ id: "agri", label: "Agricultural Sciences", category: "Life & Health" },

	// Engineering & Applied
	{ id: "eess", label: "Electrical Engineering", category: "Engineering" },
	{ id: "mat-sci", label: "Materials Science", category: "Engineering" },
	{ id: "env", label: "Environmental Science", category: "Engineering" },

	// Social Sciences & Humanities
	{ id: "econ", label: "Economics", category: "Social Sciences" },
	{ id: "q-fin", label: "Quantitative Finance", category: "Social Sciences" },
	{ id: "soc", label: "Sociology", category: "Social Sciences" },
	{ id: "poli-sci", label: "Political Science", category: "Social Sciences" },
	{ id: "ling", label: "Linguistics", category: "Social Sciences" },
	{ id: "phil", label: "Philosophy", category: "Social Sciences" },
	{ id: "educ", label: "Education", category: "Social Sciences" },
	{ id: "law", label: "Law", category: "Social Sciences" },
	{ id: "bus", label: "Business", category: "Social Sciences" },

	// Physics Specializations
	{
		id: "astro-ph",
		label: "Astrophysics",
		category: "Physics Specializations",
	},
	{
		id: "cond-mat",
		label: "Condensed Matter",
		category: "Physics Specializations",
	},
	{
		id: "hep-th",
		label: "High Energy Physics (Theory)",
		category: "Physics Specializations",
	},
	{
		id: "quant-ph",
		label: "Quantum Physics",
		category: "Physics Specializations",
	},
	{
		id: "gr-qc",
		label: "General Relativity",
		category: "Physics Specializations",
	},
];

// Group domains by category for cleaner UI
const DOMAIN_CATEGORIES = AVAILABLE_DOMAINS.reduce(
	(acc, domain) => {
		if (!acc[domain.category]) acc[domain.category] = [];
		acc[domain.category].push(domain);
		return acc;
	},
	{} as Record<string, typeof AVAILABLE_DOMAINS>,
);

export default function OnboardingPage() {
	const { user, isLoaded } = useUser();
	const router = useRouter();

	const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
	const [interestText, setInterestText] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleDomainToggle = (domainId: string) => {
		setSelectedDomains((prev) =>
			prev.includes(domainId)
				? prev.filter((id) => id !== domainId)
				: [...prev, domainId],
		);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!user || selectedDomains.length === 0) return;

		setIsSubmitting(true);

		try {
			// Send the data to your FastAPI backend
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL}/users/`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: user.id,
						email: user.primaryEmailAddress?.emailAddress || "",
						domains: selectedDomains,
						interest_text: interestText,
					}),
				},
			);

			if (response.ok) {
				// Redirect to the feed once the backend saves the user and generates the embedding
				router.push("/feed");
			} else {
				const errorData = await response.json();
				console.error("Failed to save user:", errorData);
				alert("Something went wrong saving your profile.");
			}
		} catch (error) {
			console.error("Error submitting onboarding:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (!isLoaded) return null; // Prevent hydration flickers while Clerk loads

	return (
		<div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
			<Card className="w-full max-w-lg">
				<CardHeader>
					<CardTitle className="text-2xl">Welcome to PaperPulse</CardTitle>
					<CardDescription>
						Let&apos;s tailor your daily research digest. We pull from ArXiv,
						Semantic Scholar, PubMed &amp; OpenAlex to give you the broadest
						coverage.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-6">
						{/* Domain Selection */}
						<div className="space-y-3">
							<Label className="text-base">Select your domains</Label>
							<div className="space-y-4 max-h-72 overflow-y-auto pr-2">
								{Object.entries(DOMAIN_CATEGORIES).map(
									([category, domains]) => (
										<div key={category}>
											<p className="text-xs font-semibold uppercase text-zinc-400 mb-2 tracking-wider">
												{category}
											</p>
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
												{domains.map((domain) => (
													<div
														key={domain.id}
														className="flex items-center space-x-2"
													>
														<Checkbox
															id={domain.id}
															checked={selectedDomains.includes(domain.id)}
															onCheckedChange={() =>
																handleDomainToggle(domain.id)
															}
														/>
														<label
															htmlFor={domain.id}
															className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
														>
															{domain.label}
														</label>
													</div>
												))}
											</div>
										</div>
									),
								)}
							</div>
						</div>

						{/* Specific Interests */}
						<div className="space-y-3">
							<Label htmlFor="interests" className="text-base">
								Specific Interests (Optional)
							</Label>
							<Textarea
								id="interests"
								placeholder="e.g., I care about LLM efficiency, LoRA, and quantization techniques."
								value={interestText}
								onChange={(e) => setInterestText(e.target.value)}
								className="min-h-25"
							/>
							<p className="text-xs text-zinc-500">
								We&apos;ll use this to semantically rank your daily papers.
							</p>
						</div>

						<Button
							type="submit"
							className="w-full"
							disabled={selectedDomains.length === 0 || isSubmitting}
						>
							{isSubmitting ? "Generating Profile..." : "Complete Setup"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
