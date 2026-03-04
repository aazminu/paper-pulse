import Link from "next/link";

interface LogoProps {
	size?: "sm" | "md" | "lg" | "xl";
	showText?: boolean;
	href?: string;
	className?: string;
}

function LogoIcon({ className = "h-7 w-7" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden="true"
		>
			{/* Rounded document shape */}
			<rect
				x="4"
				y="2"
				width="24"
				height="28"
				rx="4"
				className="fill-indigo-600 dark:fill-indigo-500"
			/>
			{/* Document lines */}
			<rect x="9" y="8" width="14" height="2" rx="1" fill="white" opacity="0.9" />
			<rect x="9" y="13" width="10" height="2" rx="1" fill="white" opacity="0.6" />
			<rect x="9" y="18" width="12" height="2" rx="1" fill="white" opacity="0.6" />
			{/* Pulse line */}
			<path
				d="M9 25 L13 25 L15 21 L17 27 L19 23 L21 25 L23 25"
				stroke="white"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>
		</svg>
	);
}

const sizeClasses = {
	sm: { icon: "h-5 w-5", text: "text-base" },
	md: { icon: "h-7 w-7", text: "text-xl" },
	lg: { icon: "h-9 w-9", text: "text-2xl" },
	xl: { icon: "h-12 w-12", text: "text-4xl sm:text-5xl" },
};

export default function Logo({
	size = "md",
	showText = true,
	href,
	className = "",
}: LogoProps) {
	const s = sizeClasses[size];

	const content = (
		<span
			className={`inline-flex items-center gap-2 select-none ${className}`}
		>
			<LogoIcon className={s.icon} />
			{showText && (
				<span
					className={`${s.text} font-bold tracking-tight text-zinc-900 dark:text-zinc-50`}
				>
					Paper
					<span className="text-indigo-600 dark:text-indigo-400">Pulse</span>
				</span>
			)}
		</span>
	);

	if (href) {
		return (
			<Link href={href} className="hover:opacity-90 transition-opacity">
				{content}
			</Link>
		);
	}

	return content;
}

export { LogoIcon };
