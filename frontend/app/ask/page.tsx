"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
Send,
Bot,
User as UserIcon,
BookOpen,
Paperclip,
Mic,
Square,
X,
FileText,
Image as ImageIcon,
Film,
Music,
Eye,
Maximize2,
ChevronLeft,
ChevronRight,
Plus,
Star,
Trash2,
MessageSquare,
PanelLeftClose,
PanelLeft,
MoreHorizontal,
Pencil,
} from "lucide-react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Source {
arxiv_id: string;
title: string;
abstract: string;
}

interface AttachedFile {
file: File;
preview?: string;
type: "image" | "pdf" | "word" | "audio" | "video" | "text";
textContent?: string;
}

interface PreviewFile {
name: string;
type: string;
previewUrl?: string;
textContent?: string;
}

interface Message {
role: "user" | "ai";
content: string;
sources?: Source[];
attachments?: PreviewFile[];
}

interface Chat {
id: string;
user_id: string;
title: string;
starred: boolean;
created_at: string;
updated_at: string;
}

/* ── Markdown renderers ───────────────────────────────────────────────── */

const markdownComponents: Components = {
p: ({ children }) => (
<p className="mb-3 leading-relaxed last:mb-0">{children}</p>
),
h2: ({ children }) => (
<h2 className="text-lg font-bold mt-6 mb-3 pb-1 border-b border-zinc-200 dark:border-zinc-700">
{children}
</h2>
),
h3: ({ children }) => (
<h3 className="text-base font-semibold mt-5 mb-2 text-zinc-900 dark:text-zinc-100">
{children}
</h3>
),
h4: ({ children }) => (
<h4 className="text-sm font-semibold mt-4 mb-1.5 text-zinc-800 dark:text-zinc-200">
{children}
</h4>
),
ul: ({ children }) => (
<ul className="my-3 pl-5 space-y-2 list-disc">{children}</ul>
),
ol: ({ children }) => (
<ol className="my-3 pl-5 space-y-2 list-decimal">{children}</ol>
),
li: ({ children }) => (
<li className="leading-relaxed pl-1 [&>p]:inline [&>p]:mb-0">
{children}
</li>
),
blockquote: ({ children }) => (
<blockquote className="my-4 pl-4 border-l-2 border-blue-400 dark:border-blue-600 text-zinc-600 dark:text-zinc-400 italic">
{children}
</blockquote>
),
hr: () => <hr className="my-5 border-zinc-200 dark:border-zinc-700" />,
pre: ({ children }) => (
<pre className="my-4 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto text-sm">
{children}
</pre>
),
code: ({ children, className }) => {
const isBlock = className?.includes("language-");
if (isBlock) return <code className={className}>{children}</code>;
return (
<code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 rounded text-sm">
{children}
</code>
);
},
strong: ({ children }) => (
<strong className="font-semibold text-zinc-900 dark:text-zinc-100">
{children}
</strong>
),
em: ({ children }) => (
<em className="italic text-zinc-700 dark:text-zinc-300">{children}</em>
),
a: ({ href, children }) => (
<a
href={href}
target="_blank"
rel="noopener noreferrer"
className="text-blue-600 dark:text-blue-400 hover:underline"
>
{children}
</a>
),
};

/* ── File helpers ─────────────────────────────────────────────────────── */

const ACCEPTED_TYPES: Record<string, string> = {
"image/png": "image",
"image/jpeg": "image",
"image/gif": "image",
"image/webp": "image",
"application/pdf": "pdf",
"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
"word",
"application/msword": "word",
"audio/mpeg": "audio",
"audio/mp3": "audio",
"audio/wav": "audio",
"audio/x-wav": "audio",
"audio/m4a": "audio",
"audio/mp4": "audio",
"audio/webm": "audio",
"audio/ogg": "audio",
"video/mp4": "video",
"video/quicktime": "video",
"video/webm": "video",
"video/x-matroska": "video",
"text/plain": "text",
"text/csv": "text",
"text/markdown": "text",
"application/json": "text",
};

function getFileIcon(type: string) {
switch (type) {
case "image":
return <ImageIcon className="h-4 w-4" />;
case "pdf":
case "word":
case "text":
return <FileText className="h-4 w-4" />;
case "audio":
return <Music className="h-4 w-4" />;
case "video":
return <Film className="h-4 w-4" />;
default:
return <FileText className="h-4 w-4" />;
}
}

function classifyFile(file: File): string {
return ACCEPTED_TYPES[file.type] || "text";
}

/* ── Preview Modal ─────────────────────────────────────────────────────── */

function PreviewModal({
files,
initialIndex,
onClose,
}: {
files: PreviewFile[];
initialIndex: number;
onClose: () => void;
}) {
const [index, setIndex] = useState(initialIndex);
const file = files[index];

useEffect(() => {
const handleKey = (e: KeyboardEvent) => {
if (e.key === "Escape") onClose();
if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
if (e.key === "ArrowRight" && index < files.length - 1)
setIndex((i) => i + 1);
};
window.addEventListener("keydown", handleKey);
return () => window.removeEventListener("keydown", handleKey);
}, [index, files.length, onClose]);

const renderPreview = () => {
if (!file) return null;

if (file.type === "image" && file.previewUrl) {
return (
// eslint-disable-next-line @next/next/no-img-element
<img
src={file.previewUrl}
alt={file.name}
className="max-h-[80vh] max-w-full object-contain rounded-lg"
/>
);
}
if (file.type === "pdf" && file.previewUrl) {
return (
<iframe
src={file.previewUrl}
title={file.name}
className="w-full h-[80vh] rounded-lg border-0"
/>
);
}
if (file.type === "video" && file.previewUrl) {
return (
<video
src={file.previewUrl}
controls
className="max-h-[80vh] max-w-full rounded-lg"
/>
);
}
if (file.type === "audio" && file.previewUrl) {
return (
<div className="flex flex-col items-center gap-6 p-8">
<div className="h-32 w-32 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
<Music className="h-16 w-16 text-zinc-400" />
</div>
<p className="text-sm text-zinc-500 font-medium">{file.name}</p>
<audio src={file.previewUrl} controls className="w-full max-w-md" />
</div>
);
}
if ((file.type === "text" || file.type === "word") && file.textContent) {
return (
<div className="w-full max-w-3xl max-h-[80vh] overflow-auto bg-white dark:bg-zinc-900 rounded-lg p-6 border">
<pre className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200 font-mono">
{file.textContent}
</pre>
</div>
);
}
return (
<div className="flex flex-col items-center gap-4 p-8 text-zinc-400">
<FileText className="h-20 w-20" />
<p className="text-sm font-medium">{file.name}</p>
<p className="text-xs">Preview not available for this file type</p>
</div>
);
};

return (
<div
className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
onClick={(e) => {
if (e.target === e.currentTarget) onClose();
}}
>
<div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
<p className="text-white text-sm font-medium truncate max-w-[60%]">
{file?.name}
{files.length > 1 && (
<span className="text-white/60 ml-2">
({index + 1} / {files.length})
</span>
)}
</p>
<button
onClick={onClose}
className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
>
<X className="h-5 w-5" />
</button>
</div>

{files.length > 1 && index > 0 && (
<button
onClick={() => setIndex((i) => i - 1)}
className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition z-10"
>
<ChevronLeft className="h-6 w-6" />
</button>
)}
{files.length > 1 && index < files.length - 1 && (
<button
onClick={() => setIndex((i) => i + 1)}
className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition z-10"
>
<ChevronRight className="h-6 w-6" />
</button>
)}

<div className="flex items-center justify-center">{renderPreview()}</div>
</div>
);
}

/* ── Relative time helper ────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
const now = Date.now();
const then = new Date(dateStr).getTime();
const diff = now - then;
const mins = Math.floor(diff / 60000);
if (mins < 1) return "just now";
if (mins < 60) return `${mins}m ago`;
const hours = Math.floor(mins / 60);
if (hours < 24) return `${hours}h ago`;
const days = Math.floor(hours / 24);
if (days < 7) return `${days}d ago`;
return new Date(dateStr).toLocaleDateString();
}

/* ── Chat list item component ────────────────────────────────────────── */

function ChatItem({
chat,
isActive,
isEditing,
editTitle,
menuOpen,
onSelect,
onMenuToggle,
onStar,
onDelete,
onStartEdit,
onEditChange,
onEditConfirm,
onEditCancel,
menuRef,
}: {
chat: Chat;
isActive: boolean;
isEditing: boolean;
editTitle: string;
menuOpen: boolean;
onSelect: () => void;
onMenuToggle: () => void;
onStar: () => void;
onDelete: () => void;
onStartEdit: () => void;
onEditChange: (v: string) => void;
onEditConfirm: () => void;
onEditCancel: () => void;
menuRef: React.RefObject<HTMLDivElement | null>;
}) {
return (
<div className="relative group">
<button
onClick={onSelect}
className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 transition ${
isActive
? "bg-zinc-100 dark:bg-zinc-900 font-medium"
: "hover:bg-zinc-50 dark:hover:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400"
}`}
>
<MessageSquare className="h-4 w-4 shrink-0 opacity-50" />
<span className="flex-1 min-w-0">
{isEditing ? (
<input
value={editTitle}
onChange={(e) => onEditChange(e.target.value)}
onKeyDown={(e) => {
if (e.key === "Enter") onEditConfirm();
if (e.key === "Escape") onEditCancel();
}}
onClick={(e) => e.stopPropagation()}
className="w-full bg-transparent border-b border-blue-500 outline-none text-sm"
autoFocus
/>
) : (
<>
<span className="block truncate">{chat.title}</span>
<span className="block text-[10px] text-zinc-400 font-normal">{relativeTime(chat.updated_at)}</span>
</>
)}
</span>
{chat.starred && !isEditing && (
<Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 shrink-0" />
)}
</button>

{/* Action buttons */}
{!isEditing && (
<div
className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
>
<button
onClick={(e) => {
e.stopPropagation();
onMenuToggle();
}}
className="h-7 w-7 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500"
>
<MoreHorizontal className="h-4 w-4" />
</button>
</div>
)}

{/* Context menu */}
{menuOpen && (
<div
ref={menuRef}
className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 border rounded-lg shadow-lg py-1 w-40"
>
<button
onClick={(e) => {
e.stopPropagation();
onStar();
onMenuToggle();
}}
className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2"
>
<Star
className={`h-4 w-4 ${chat.starred ? "text-yellow-500 fill-yellow-500" : ""}`}
/>
{chat.starred ? "Unstar" : "Star"}
</button>
<button
onClick={(e) => {
e.stopPropagation();
onStartEdit();
}}
className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2"
>
<Pencil className="h-4 w-4" />
Rename
</button>
<button
onClick={(e) => {
e.stopPropagation();
onDelete();
onMenuToggle();
}}
className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 text-red-600 dark:text-red-400"
>
<Trash2 className="h-4 w-4" />
Delete
</button>
</div>
)}
</div>
);
}

/* ── Input bar (shared between empty state & active chat) ────────────── */

function InputBar({
query,
setQuery,
isLoading,
isRecording,
recordingTime,
attachedFiles,
textareaRef,
fileInputRef,
onSubmit,
addFiles,
removeFile,
openPreview,
startRecording,
stopRecording,
}: {
query: string;
setQuery: (v: string) => void;
isLoading: boolean;
isRecording: boolean;
recordingTime: number;
attachedFiles: AttachedFile[];
textareaRef: React.RefObject<HTMLTextAreaElement | null>;
fileInputRef: React.RefObject<HTMLInputElement | null>;
onSubmit: (e: React.FormEvent) => void;
addFiles: (f: FileList | File[]) => void;
removeFile: (i: number) => void;
openPreview: (files: PreviewFile[], i: number) => void;
startRecording: () => void;
stopRecording: () => void;
}) {
return (
<>
{attachedFiles.length > 0 && (
<div className="flex flex-wrap gap-2 mb-3 px-1">
{attachedFiles.map((af, index) => (
<div
key={index}
className="relative group flex items-center gap-2 bg-white dark:bg-zinc-900 border rounded-lg px-3 py-2 text-xs shadow-sm cursor-pointer hover:border-blue-400 transition"
onClick={() =>
openPreview(
attachedFiles.map((f) => ({
name: f.file.name,
type: f.type,
previewUrl: f.preview,
textContent: f.textContent,
})),
index,
)
}
>
{af.preview && af.type === "image" ? (
<Image
src={af.preview}
alt={af.file.name}
width={40}
height={40}
className="h-10 w-10 rounded object-cover"
unoptimized
/>
) : (
<div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
{getFileIcon(af.type)}
</div>
)}
<div className="max-w-25">
<p className="font-medium truncate">{af.file.name}</p>
<p className="text-zinc-400">
{(af.file.size / 1024).toFixed(0)}KB
</p>
</div>
<Maximize2 className="h-3.5 w-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
<button
onClick={(e) => {
e.stopPropagation();
removeFile(index);
}}
className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
>
<X className="h-3 w-3" />
</button>
</div>
))}
</div>
)}

<form onSubmit={onSubmit} className="relative">
<div className="flex items-end gap-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition">
<button
type="button"
onClick={() => fileInputRef.current?.click()}
disabled={isLoading}
className="p-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition disabled:opacity-50"
title="Attach files"
>
<Paperclip className="h-5 w-5" />
</button>
<input
ref={fileInputRef}
type="file"
multiple
accept={Object.keys(ACCEPTED_TYPES).join(",")}
onChange={(e) => {
if (e.target.files) addFiles(e.target.files);
e.target.value = "";
}}
className="hidden"
/>
<textarea
ref={textareaRef}
value={query}
onChange={(e) => setQuery(e.target.value)}
onKeyDown={(e) => {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
onSubmit(e);
}
}}
placeholder={
attachedFiles.length > 0
? "Ask about the attached files..."
: "Ask a question about your papers..."
}
rows={1}
disabled={isLoading}
className="flex-1 py-3 bg-transparent border-0 resize-none focus:outline-none text-sm sm:text-base placeholder:text-zinc-400 disabled:opacity-50 max-h-40"
/>
{!isRecording ? (
<button
type="button"
onClick={startRecording}
disabled={isLoading}
className="p-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition disabled:opacity-50"
title="Record voice"
>
<Mic className="h-5 w-5" />
</button>
) : (
<button
type="button"
onClick={stopRecording}
className="p-3 text-red-500 animate-pulse"
title="Stop recording"
>
<Square className="h-5 w-5 fill-current" />
<span className="sr-only">Recording: {recordingTime}s</span>
</button>
)}
<Button
type="submit"
size="icon"
disabled={
(!query.trim() && attachedFiles.length === 0) || isLoading
}
className="m-1.5 h-9 w-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shrink-0"
>
<Send className="h-4 w-4" />
</Button>
</div>
{isRecording && (
<div className="absolute -top-8 left-0 right-0 flex items-center justify-center">
<span className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs rounded-full border border-red-200 dark:border-red-800">
<span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
Recording... {recordingTime}s
</span>
</div>
)}
</form>
<p className="text-center text-xs text-zinc-400 mt-3">
Attach images, PDFs, docs, audio, or video. AI can make mistakes.
</p>
</>
);
}

/* ── Main component ───────────────────────────────────────────────────── */

export default function AskPage() {
const { user, isLoaded } = useUser();

// Chat list
const [chats, setChats] = useState<Chat[]>([]);
const [activeChatId, setActiveChatId] = useState<string | null>(null);
const [sidebarOpen, setSidebarOpen] = useState(true);
const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
const [editingChatId, setEditingChatId] = useState<string | null>(null);
const [editTitle, setEditTitle] = useState("");

// Messages
const [query, setQuery] = useState("");
const [messages, setMessages] = useState<Message[]>([]);
const [isLoading, setIsLoading] = useState(false);

// Attachments
const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
const [isDragging, setIsDragging] = useState(false);

// Voice recording
const [isRecording, setIsRecording] = useState(false);
const [recordingTime, setRecordingTime] = useState(0);

// Preview modal
const [previewModal, setPreviewModal] = useState<{
files: PreviewFile[];
index: number;
} | null>(null);

// Refs
const fileInputRef = useRef<HTMLInputElement>(null);
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const audioChunksRef = useRef<Blob[]>([]);
const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
const textareaRef = useRef<HTMLTextAreaElement>(null);
const chatEndRef = useRef<HTMLDivElement>(null);
const chatMenuRef = useRef<HTMLDivElement>(null);

const API = process.env.NEXT_PUBLIC_API_URL;

/* ── Load chats on mount ─────────────────────────────────────────── */
useEffect(() => {
if (!user) return;
fetchChats();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user]);

const fetchChats = async () => {
if (!user) return;
try {
const res = await fetch(`${API}/chats/?user_id=${user.id}`);
if (!res.ok) return;
const data: Chat[] = await res.json();
setChats(data);
} catch (e) {
console.error("Failed to fetch chats:", e);
}
};

/* ── Load messages when active chat changes ──────────────────────── */
useEffect(() => {
if (!activeChatId) {
setMessages([]);
return;
}
loadChatMessages(activeChatId);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeChatId]);

const loadChatMessages = async (chatId: string) => {
try {
const res = await fetch(`${API}/chats/${chatId}`);
if (!res.ok) return;
const data = await res.json();
const dbMessages: Message[] = (data.messages || []).map(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(m: any) => ({
role: m.role as "user" | "ai",
content: m.content,
sources:
typeof m.sources === "string"
? JSON.parse(m.sources)
: m.sources || [],
attachments:
typeof m.attachments === "string"
? JSON.parse(m.attachments)
: m.attachments || [],
}),
);
setMessages(dbMessages);
} catch (e) {
console.error("Failed to load chat messages:", e);
}
};

/* ── Create new chat ─────────────────────────────────────────────── */
const createNewChat = async () => {
if (!user) return;
try {
const res = await fetch(`${API}/chats/`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ user_id: user.id }),
});
if (!res.ok) return;
const chat: Chat = await res.json();
setChats((prev) => [chat, ...prev]);
setActiveChatId(chat.id);
setMessages([]);
} catch (e) {
console.error("Failed to create chat:", e);
}
};

/* ── Save a message to DB ────────────────────────────────────────── */
const saveMessage = async (
chatId: string,
role: string,
content: string,
sources: Source[] = [],
attachments: PreviewFile[] = [],
) => {
try {
const res = await fetch(`${API}/chats/${chatId}/messages`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ role, content, sources, attachments }),
});
if (!res.ok) return null;
const data = await res.json();
if (data.generated_title) {
setChats((prev) =>
prev.map((c) =>
c.id === chatId ? { ...c, title: data.generated_title } : c,
),
);
}
return data;
} catch (e) {
console.error("Failed to save message:", e);
return null;
}
};

/* ── Delete chat ─────────────────────────────────────────────────── */
const deleteChat = async (chatId: string) => {
try {
await fetch(`${API}/chats/${chatId}`, { method: "DELETE" });
setChats((prev) => prev.filter((c) => c.id !== chatId));
if (activeChatId === chatId) {
setActiveChatId(null);
setMessages([]);
}
} catch (e) {
console.error("Failed to delete chat:", e);
}
};

/* ── Toggle star ─────────────────────────────────────────────────── */
const toggleStar = async (chatId: string) => {
const chat = chats.find((c) => c.id === chatId);
if (!chat) return;
const newStarred = !chat.starred;
setChats((prev) =>
prev.map((c) => (c.id === chatId ? { ...c, starred: newStarred } : c)),
);
try {
await fetch(`${API}/chats/${chatId}`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ starred: newStarred }),
});
} catch (e) {
setChats((prev) =>
prev.map((c) =>
c.id === chatId ? { ...c, starred: !newStarred } : c,
),
);
console.error("Failed to toggle star:", e);
}
};

/* ── Rename chat ─────────────────────────────────────────────────── */
const renameChat = async (chatId: string, newTitle: string) => {
if (!newTitle.trim()) return;
setChats((prev) =>
prev.map((c) =>
c.id === chatId ? { ...c, title: newTitle.trim() } : c,
),
);
setEditingChatId(null);
try {
await fetch(`${API}/chats/${chatId}`, {
method: "PATCH",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ title: newTitle.trim() }),
});
} catch (e) {
console.error("Failed to rename chat:", e);
}
};

/* ── Close context menu on outside click ─────────────────────────── */
useEffect(() => {
const handleClick = (e: MouseEvent) => {
if (
chatMenuRef.current &&
!chatMenuRef.current.contains(e.target as Node)
) {
setChatMenuOpen(null);
}
};
if (chatMenuOpen) {
document.addEventListener("mousedown", handleClick);
return () => document.removeEventListener("mousedown", handleClick);
}
}, [chatMenuOpen]);

/* ── Auto-scroll ─────────────────────────────────────────────────── */
useEffect(() => {
chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [messages, isLoading]);

/* ── Auto-resize textarea ────────────────────────────────────────── */
useEffect(() => {
if (textareaRef.current) {
textareaRef.current.style.height = "auto";
textareaRef.current.style.height =
Math.min(textareaRef.current.scrollHeight, 160) + "px";
}
}, [query]);

/* ── File handling ───────────────────────────────────────────────── */

const addFiles = useCallback((fileList: FileList | File[]) => {
const newFiles: AttachedFile[] = [];
for (const file of Array.from(fileList)) {
if (file.size > 25 * 1024 * 1024) {
alert(`${file.name} exceeds 25MB limit`);
continue;
}
const type = classifyFile(file) as AttachedFile["type"];
const attached: AttachedFile = { file, type };

if (
type === "image" ||
type === "pdf" ||
type === "video" ||
type === "audio"
) {
attached.preview = URL.createObjectURL(file);
}
if (type === "text") {
file.text().then((text) => {
setAttachedFiles((prev) =>
prev.map((af) =>
af.file === file
? { ...af, textContent: text.substring(0, 50000) }
: af,
),
);
});
}
newFiles.push(attached);
}
setAttachedFiles((prev) => [...prev, ...newFiles]);
}, []);

const removeFile = (index: number) => {
setAttachedFiles((prev) => {
const removed = prev[index];
if (removed.preview) URL.revokeObjectURL(removed.preview);
return prev.filter((_, i) => i !== index);
});
};

const openPreview = (files: PreviewFile[], index: number) => {
setPreviewModal({ files, index });
};

/* ── Voice recording ─────────────────────────────────────────────── */

const startRecording = async () => {
try {
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream);
audioChunksRef.current = [];

recorder.ondataavailable = (e) => {
if (e.data.size > 0) audioChunksRef.current.push(e.data);
};
recorder.onstop = () => {
const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
const file = new File([blob], `voice-${Date.now()}.webm`, {
type: "audio/webm",
});
addFiles([file]);
stream.getTracks().forEach((t) => t.stop());
};

recorder.start();
mediaRecorderRef.current = recorder;
setIsRecording(true);
setRecordingTime(0);
recordingIntervalRef.current = setInterval(
() => setRecordingTime((t) => t + 1),
1000,
);
} catch {
alert("Microphone access denied. Please allow microphone access.");
}
};

const stopRecording = () => {
mediaRecorderRef.current?.stop();
setIsRecording(false);
if (recordingIntervalRef.current) {
clearInterval(recordingIntervalRef.current);
recordingIntervalRef.current = null;
}
};

/* ── Drag and drop ───────────────────────────────────────────────── */

const handleDragOver = (e: React.DragEvent) => {
e.preventDefault();
setIsDragging(true);
};
const handleDragLeave = (e: React.DragEvent) => {
e.preventDefault();
setIsDragging(false);
};
const handleDrop = (e: React.DragEvent) => {
e.preventDefault();
setIsDragging(false);
if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
};

/* ── Ask handler ─────────────────────────────────────────────────── */

const handleAsk = async (e: React.FormEvent) => {
e.preventDefault();
if ((!query.trim() && attachedFiles.length === 0) || !user) return;

const userMessage = query.trim();
const currentFiles = [...attachedFiles];
setQuery("");
setAttachedFiles([]);
if (textareaRef.current) textareaRef.current.style.height = "auto";

// Auto-create a chat if none is active
let chatId = activeChatId;
if (!chatId) {
try {
const res = await fetch(`${API}/chats/`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ user_id: user.id }),
});
if (!res.ok) return;
const chat: Chat = await res.json();
chatId = chat.id;
setChats((prev) => [chat, ...prev]);
setActiveChatId(chatId);
} catch (err) {
console.error("Failed to create chat:", err);
return;
}
}

// Build conversation history
const history = messages.slice(-10).map((m) => ({
role: m.role === "ai" ? "assistant" : "user",
content: m.content.substring(0, 3000),
}));

const userAttachments: PreviewFile[] = currentFiles.map((f) => ({
name: f.file.name,
type: f.type,
previewUrl: f.preview,
textContent: f.textContent,
}));

const userMsg: Message = {
role: "user",
content: userMessage || "(attached files)",
attachments: userAttachments,
};

setMessages((prev) => [...prev, userMsg]);
setIsLoading(true);

// Save user message to DB
const saveUserPromise = saveMessage(
chatId,
"user",
userMessage || "(attached files)",
[],
userAttachments.map((a) => ({ name: a.name, type: a.type })),
);

try {
let data;

if (currentFiles.length > 0) {
const formData = new FormData();
formData.append("user_id", user.id);
formData.append("question", userMessage);
formData.append("history", JSON.stringify(history));
for (const af of currentFiles) {
formData.append("files", af.file);
}
const res = await fetch(`${API}/ask/multimodal`, {
method: "POST",
body: formData,
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
data = await res.json();
} else {
const res = await fetch(`${API}/ask/`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
user_id: user.id,
question: userMessage,
history,
}),
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
data = await res.json();
}

const aiMsg: Message = {
role: "ai",
content: data.answer,
sources: data.sources,
};
setMessages((prev) => [...prev, aiMsg]);

// Wait for user message save (may have generated title)
await saveUserPromise;

// Save AI response to DB
await saveMessage(chatId, "ai", data.answer, data.sources || []);

// Bump chat to top
setChats((prev) => {
const updated = prev.map((c) =>
c.id === chatId
? { ...c, updated_at: new Date().toISOString() }
: c,
);
updated.sort((a, b) => {
if (a.starred !== b.starred) return a.starred ? -1 : 1;
return (
new Date(b.updated_at).getTime() -
new Date(a.updated_at).getTime()
);
});
return updated;
});
} catch (error) {
console.error("Error asking question:", error);
setMessages((prev) => [
...prev,
{
role: "ai",
content:
"Sorry, I encountered an error. Please check the backend is running.",
},
]);
} finally {
setIsLoading(false);
}
};

if (!isLoaded) return null;

/* ── Grouped chats for sidebar ───────────────────────────────────── */
const starredChats = chats.filter((c) => c.starred);
const recentChats = chats.filter((c) => !c.starred);
const isEmptyState = !activeChatId && messages.length === 0;

return (
<div
className="flex flex-col h-screen bg-zinc-50 dark:bg-black"
onDragOver={handleDragOver}
onDragLeave={handleDragLeave}
onDrop={handleDrop}
>
{/* Drag overlay */}
{isDragging && (
<div className="fixed inset-0 z-50 bg-blue-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
<div className="bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-2xl border-2 border-dashed border-blue-500">
<p className="text-lg font-medium text-blue-600 dark:text-blue-400">
Drop files here to attach
</p>
<p className="text-sm text-zinc-500 mt-1">
Images, PDFs, Word docs, audio, video
</p>
</div>
</div>
)}

{/* Navigation Header */}
<header className="border-b bg-white dark:bg-zinc-950 px-4 sm:px-6 py-4 flex justify-between items-center sticky top-0 z-10 shrink-0">
<div className="flex items-center gap-3 sm:gap-6">
<button
onClick={() => setSidebarOpen((o) => !o)}
className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
>
{sidebarOpen ? (
<PanelLeftClose className="h-5 w-5" />
) : (
<PanelLeft className="h-5 w-5" />
)}
</button>
<h1 className="text-xl font-bold tracking-tight">PaperPulse</h1>
<nav className="hidden sm:flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
<Link
href="/feed"
className="hover:text-black dark:hover:text-white transition"
>
Daily Feed
</Link>
<Link href="/ask" className="text-black dark:text-white">
Ask AI
</Link>
</nav>
</div>
<UserButton />
</header>

{/* Body: sidebar + chat */}
<div className="flex grow overflow-hidden">
{/* ── Sidebar ──────────────────────────────────────────────── */}
{sidebarOpen && (
<aside className="w-72 shrink-0 border-r bg-white dark:bg-zinc-950 flex flex-col overflow-hidden">
<div className="p-3">
<button
onClick={createNewChat}
className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition text-sm font-medium"
>
<Plus className="h-4 w-4" />
New Chat
</button>
</div>

<div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
{starredChats.length > 0 && (
<>
<p className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
Starred
</p>
{starredChats.map((chat) => (
<ChatItem
key={chat.id}
chat={chat}
isActive={chat.id === activeChatId}
isEditing={editingChatId === chat.id}
editTitle={editTitle}
menuOpen={chatMenuOpen === chat.id}
onSelect={() => {
setActiveChatId(chat.id);
setChatMenuOpen(null);
}}
onMenuToggle={() =>
setChatMenuOpen(
chatMenuOpen === chat.id ? null : chat.id,
)
}
onStar={() => toggleStar(chat.id)}
onDelete={() => deleteChat(chat.id)}
onStartEdit={() => {
setEditingChatId(chat.id);
setEditTitle(chat.title);
setChatMenuOpen(null);
}}
onEditChange={setEditTitle}
onEditConfirm={() => renameChat(chat.id, editTitle)}
onEditCancel={() => setEditingChatId(null)}
menuRef={chatMenuRef}
/>
))}
</>
)}

{recentChats.length > 0 && (
<>
<p className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
Recent
</p>
{recentChats.map((chat) => (
<ChatItem
key={chat.id}
chat={chat}
isActive={chat.id === activeChatId}
isEditing={editingChatId === chat.id}
editTitle={editTitle}
menuOpen={chatMenuOpen === chat.id}
onSelect={() => {
setActiveChatId(chat.id);
setChatMenuOpen(null);
}}
onMenuToggle={() =>
setChatMenuOpen(
chatMenuOpen === chat.id ? null : chat.id,
)
}
onStar={() => toggleStar(chat.id)}
onDelete={() => deleteChat(chat.id)}
onStartEdit={() => {
setEditingChatId(chat.id);
setEditTitle(chat.title);
setChatMenuOpen(null);
}}
onEditChange={setEditTitle}
onEditConfirm={() => renameChat(chat.id, editTitle)}
onEditCancel={() => setEditingChatId(null)}
menuRef={chatMenuRef}
/>
))}
</>
)}

{chats.length === 0 && (
<div className="text-center py-12 text-zinc-400">
<MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
<p className="text-sm">No chats yet</p>
<p className="text-xs mt-1">Start a conversation below</p>
</div>
)}
</div>
</aside>
)}

{/* ── Chat area ────────────────────────────────────────────── */}
<main className="flex-1 flex flex-col overflow-hidden">
{isEmptyState ? (
<div className="flex-1 flex flex-col items-center justify-center p-6">
<div className="h-16 w-16 rounded-2xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mb-6">
<Bot className="h-9 w-9 text-blue-600 dark:text-blue-400" />
</div>
<h2 className="text-2xl font-bold mb-2">
How can I help you today?
</h2>
<p className="text-zinc-500 text-sm max-w-md text-center mb-8">
Ask me anything about your papers, or attach images, PDFs,
audio, video, and documents for me to analyze.
</p>
<div className="w-full max-w-2xl">
<InputBar
query={query}
setQuery={setQuery}
isLoading={isLoading}
isRecording={isRecording}
recordingTime={recordingTime}
attachedFiles={attachedFiles}
textareaRef={textareaRef}
fileInputRef={fileInputRef}
onSubmit={handleAsk}
addFiles={addFiles}
removeFile={removeFile}
openPreview={openPreview}
startRecording={startRecording}
stopRecording={stopRecording}
/>
</div>
</div>
) : (
<>
{/* Messages */}
<div className="grow overflow-y-auto p-4 sm:p-6">
<div className="max-w-4xl mx-auto space-y-6 pb-6">
{messages.map((msg, index) => (
<div
key={index}
className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
>
{msg.role === "ai" && (
<div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0 mt-1">
<Bot className="h-5 w-5 text-blue-600 dark:text-blue-400" />
</div>
)}

<div
className={`max-w-[85%] rounded-2xl p-4 ${
msg.role === "user"
? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black rounded-tr-sm"
: "bg-white dark:bg-zinc-900 border shadow-sm rounded-tl-sm text-zinc-800 dark:text-zinc-200"
}`}
>
{msg.role === "user" ? (
<div>
{msg.content !== "(attached files)" && (
<p className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
{msg.content}
</p>
)}
{msg.attachments &&
msg.attachments.length > 0 && (
<div className="flex flex-wrap gap-1.5 mt-2">
{msg.attachments.map((att, i) => (
<button
key={i}
onClick={() =>
openPreview(msg.attachments!, i)
}
className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 dark:bg-black/20 text-xs hover:bg-white/30 dark:hover:bg-black/30 transition cursor-pointer"
>
{getFileIcon(att.type)}
<span className="max-w-30 truncate">
{att.name}
</span>
<Eye className="h-3 w-3 opacity-60" />
</button>
))}
</div>
)}
</div>
) : (
<div className="text-sm sm:text-base text-zinc-800 dark:text-zinc-200">
<ReactMarkdown
remarkPlugins={[remarkGfm, remarkMath]}
rehypePlugins={[
[
rehypeKatex,
{ throwOnError: false, strict: false },
],
]}
components={markdownComponents}
>
{msg.content}
</ReactMarkdown>
</div>
)}

{msg.sources && msg.sources.length > 0 && (
<div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
<p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
Sources Referenced
</p>
{msg.sources.map((source, idx) => (
<div
key={idx}
className="flex gap-2 items-start bg-zinc-50 dark:bg-zinc-950 p-2 rounded-md border text-xs"
>
<BookOpen className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
<div>
<p className="font-medium line-clamp-1">
{source.title}
</p>
<a
href={`https://arxiv.org/abs/${source.arxiv_id}`}
target="_blank"
rel="noopener noreferrer"
className="text-blue-600 hover:underline mt-1 inline-block"
>
arxiv.org/abs/{source.arxiv_id}
</a>
</div>
</div>
))}
</div>
)}
</div>

{msg.role === "user" && (
<div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-1">
<UserIcon className="h-5 w-5 text-zinc-500" />
</div>
)}
</div>
))}

{isLoading && (
<div className="flex gap-4 justify-start">
<div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0 mt-1">
<Bot className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
</div>
<div className="bg-white dark:bg-zinc-900 border shadow-sm rounded-2xl rounded-tl-sm p-4 text-zinc-500 text-sm">
Searching your database and thinking...
</div>
</div>
)}
<div ref={chatEndRef} />
</div>
</div>

{/* Input area */}
<div className="shrink-0 border-t bg-zinc-50 dark:bg-black p-4">
<div className="max-w-4xl mx-auto">
<InputBar
query={query}
setQuery={setQuery}
isLoading={isLoading}
isRecording={isRecording}
recordingTime={recordingTime}
attachedFiles={attachedFiles}
textareaRef={textareaRef}
fileInputRef={fileInputRef}
onSubmit={handleAsk}
addFiles={addFiles}
removeFile={removeFile}
openPreview={openPreview}
startRecording={startRecording}
stopRecording={stopRecording}
/>
</div>
</div>
</>
)}
</main>
</div>

{/* Preview Modal */}
{previewModal && (
<PreviewModal
files={previewModal.files}
initialIndex={previewModal.index}
onClose={() => setPreviewModal(null)}
/>
)}
</div>
);
}
