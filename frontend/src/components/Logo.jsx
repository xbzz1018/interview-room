import { cn } from "@/lib/utils";
import { BookOpenCheck } from "lucide-react";

export default function Logo({ className = "" }) {
  return (
    <span
      role="img"
      aria-label="面试练习室"
      className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground", className)}
    >
      <BookOpenCheck className="h-[62%] w-[62%]" strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}
