import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  User, BookOpen, Clock,
  Target, FileUser, Settings as SettingsIcon,
  LogOut, Menu, X, ChevronLeft, ChevronRight, FolderOpen, MessagesSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import useAuth from "../hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Logo from "./Logo";
import { AppearanceMenu } from './AppearanceMenu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/mock-interview", label: "开始面试", icon: MessagesSquare },
  { path: "/history", label: "复盘与重练", icon: Clock },
  { path: "/personal-agent", label: "资料与学习", icon: FolderOpen },
  { path: "/resume-manager", label: "我的简历", icon: FileUser },
  { path: "/topic-drill", label: "专项练习", icon: Target },
  { path: "/profile", label: "能力记录", icon: User },
  { path: "/knowledge", label: "备面知识库", icon: BookOpen },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  const open = openPath === location.pathname;

  useEffect(() => { localStorage.setItem("sidebar-collapsed", String(collapsed)); }, [collapsed]);

  useEffect(() => {
    const closeDesktopOverlay = () => { if (window.innerWidth >= 768) setOpenPath(null); };
    window.addEventListener("resize", closeDesktopOverlay);
    return () => window.removeEventListener("resize", closeDesktopOverlay);
  }, []);

  const isActive = (path: string) => {
    if (path === "/mock-interview" && location.pathname.startsWith("/interview/")) return true;
    if (path === "/history" && location.pathname.startsWith("/review/")) return true;
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const navItem = ({ path, label, icon: Icon }: NavItem, compact: boolean) => {
    const active = isActive(path);
    const btn = (
      <Link
        to={path}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpenPath(null)}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-3 rounded-lg text-[13px] transition-colors text-left group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-primary/12 text-primary font-medium"
            : "text-dim hover:text-text hover:bg-hover",
          compact && "justify-center px-0"
        )}
      >
        <Icon size={18} className={cn("shrink-0", active ? "text-primary" : "text-dim group-hover:text-primary")} />
        {!compact && <span className="truncate">{label}</span>}
      </Link>
    );

    if (compact) {
      return (
        <Tooltip key={path} delayDuration={0}>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
        </Tooltip>
      );
    }
    return <div key={path}>{btn}</div>;
  };

  const sidebar = (mobile = false) => {
    const compact = collapsed && !mobile;
    return (
    <aside className={cn(
      "flex flex-col h-full border-r border-sidebar-border bg-sidebar transition-all duration-300",
      compact ? "w-[68px]" : "w-[224px]"
    )}>
      <div className={cn("flex items-center shrink-0 py-5", compact ? "justify-center px-4" : "px-5 gap-2.5")}>
        <Logo className="h-9 w-9 rounded-lg" />
        {!compact && <span className="text-base font-display font-semibold text-sidebar-foreground">面试练习室<span className="mt-1 block text-[10px] font-normal text-dim">我的个人训练空间</span></span>}
        {mobile && <Dialog.Close asChild><Button variant="ghost" size="icon" className="ml-auto h-7 w-7" aria-label="关闭导航"><X size={17} /></Button></Dialog.Close>}
      </div>

      {!compact && <p className="px-6 pb-1 pt-5 text-[11px] tracking-wider text-dim">我的训练</p>}

      <TooltipProvider delayDuration={0}>
        <nav aria-label={mobile ? "移动导航" : "主要导航"} className={cn("flex-1 flex flex-col gap-1 overflow-y-auto py-3", compact ? "px-2" : "px-3")}>
          {NAV_ITEMS.map((item) => navItem(item, compact))}
          <div className="mt-auto pt-3">{navItem({ path: "/settings", label: "模型与设置", icon: SettingsIcon }, compact)}</div>
        </nav>

        <Separator />

        <div className={cn("py-2 space-y-0.5", compact ? "px-2" : "px-3")}>
          <AppearanceMenu collapsed={compact} />

          {user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  aria-label="退出登录"
                  className={cn(
                    "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] text-dim hover:text-red hover:bg-red/8 transition-all",
                    compact && "justify-center"
                  )}
                >
                  <LogOut size={18} />
                  {!compact && <span className="truncate">{user.name || user.email}</span>}
                </button>
              </TooltipTrigger>
              {compact && <TooltipContent side="right" sideOffset={8}>退出登录</TooltipContent>}
            </Tooltip>
          )}

          {!mobile && <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCollapsed(c => !c)}
                aria-label={compact ? "展开侧栏" : "收起侧栏"}
                className={cn(
                  "flex items-center gap-2.5 w-full py-2 rounded-lg text-[13px] text-dim hover:text-text hover:bg-hover transition-all mt-1",
                  compact && "justify-center"
                )}
              >
                {compact ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                {!compact && "收起侧栏"}
              </button>
            </TooltipTrigger>
            {compact && <TooltipContent side="right" sideOffset={8}>展开侧栏</TooltipContent>}
          </Tooltip>}
        </div>
      </TooltipProvider>
    </aside>
  );
  };

  return (
    <Dialog.Root open={open} onOpenChange={(value) => setOpenPath(value ? location.pathname : null)}>
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-border shrink-0">
        <Link to="/mock-interview?mode=live" className="flex items-center gap-2.5" onClick={() => setOpenPath(null)}>
          <Logo className="h-7 w-7 rounded-lg" />
          <span className="text-base font-display font-bold text-text">面试练习室</span>
        </Link>
        <div className="flex items-center gap-1"><AppearanceMenu collapsed /><Dialog.Trigger asChild><Button variant="ghost" size="icon" aria-label="打开导航"><Menu size={18} /></Button></Dialog.Trigger></div>
      </div>

      <div className="hidden md:flex shrink-0">{sidebar()}</div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 outline-none md:hidden">
          <Dialog.Title className="sr-only">面试练习室导航</Dialog.Title>
          <Dialog.Description className="sr-only">开始面试、准备资料或打开复盘记录。</Dialog.Description>
          {sidebar(true)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
