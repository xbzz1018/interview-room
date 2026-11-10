import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ChevronRight, PanelLeft } from 'lucide-react';
import { AppearanceMenu } from './components/AppearanceMenu';
import { AuthProvider } from "./contexts/AuthContext";
import { TaskStatusProvider } from "./contexts/TaskStatusContext";
import useAuth from "./hooks/useAuth";
import Sidebar from "./components/Sidebar";
import TaskNotification from "./components/TaskNotification";
import ErrorBoundary from "./components/ErrorBoundary";
import PersonalWelcome from "./pages/PersonalWelcome";
import Login from "./pages/Login";
import Interview from "./pages/Interview";
import Review from "./pages/Review";
import History from "./pages/History";
import Profile from "./pages/Profile";
import Knowledge from "./pages/Knowledge";
import TopicDetail from "./pages/TopicDetail";
import Graph from "./pages/Graph";
import RecordingAnalysis from "./pages/RecordingAnalysis";
import Copilot from "./pages/Copilot";
import TopicDrill from "./pages/TopicDrill";
import MockInterview from "./pages/MockInterview";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import NotFound from "./pages/NotFound";
import PersonalAgent from "./pages/PersonalAgent";
import SessionRecovery from "./components/SessionRecovery";

// 简历模块体量大(编辑器 + 9 套模板),按需加载避免拖慢首屏
const ResumeManager = lazy(() => import("./pages/ResumeManager"));
const ResumeEditor = lazy(() => import("./pages/ResumeEditor"));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (!token) return <Navigate to="/" replace />;
  return children;
}

// Gate the app behind first-run provider setup: a user with no LLM/Embedding
// configured can't do anything useful, so funnel them through onboarding first.
function ProviderGate({ children }: { children: ReactNode }) {
  const { needsOnboarding } = useAuth();
  if (needsOnboarding) return <Onboarding />;
  return children;
}

function PublicHome() {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (token) return <Navigate to="/mock-interview?mode=live" replace />;
  return <PersonalWelcome />;
}

function AuthPage() {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (token) return <Navigate to="/" replace />;
  return <Login />;
}

function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const pageTitle = pathname.startsWith('/review/') ? '逐题复盘' : pathname.startsWith('/interview/') ? '模拟面试' : ({ '/mock-interview': '开始面试', '/history': '复盘与重练', '/personal-agent': '资料与学习', '/resume-manager': '我的简历', '/topic-drill': '专项练习', '/profile': '能力记录', '/settings': '模型与设置' } as Record<string, string>)[pathname] || '我的训练';
  return (
    <div className="personal-shell flex flex-col md:flex-row h-screen bg-background">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="personal-topbar hidden shrink-0 items-center justify-between gap-4 border-b border-border px-7 md:flex">
          <div className="flex items-center gap-3 text-xs text-dim"><PanelLeft size={16} aria-hidden="true" /><span>我的练习空间</span><ChevronRight size={13} aria-hidden="true" /><span>{pageTitle}</span></div>
          <AppearanceMenu />
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { verificationError } = useAuth();
  if (verificationError) return <SessionRecovery />;
  return (
    <Routes>
      <Route path="/" element={<PublicHome />} />
      <Route path="/login" element={<AuthPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <ProviderGate>
            <AppShell>
              <Routes>
                <Route path="/interview/:sessionId" element={<Interview />} />
                <Route path="/review/:sessionId" element={<Review />} />
                <Route path="/history" element={<History />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/personal-agent" element={<PersonalAgent />} />
                <Route path="/profile/topic/:topic" element={<TopicDetail />} />
                <Route path="/knowledge" element={<Knowledge />} />
                <Route path="/graph" element={<Graph />} />
                <Route path="/recording" element={<RecordingAnalysis />} />
                <Route path="/mock-interview" element={<MockInterview />} />
                <Route
                  path="/job-prep"
                  element={<Navigate to="/mock-interview?mode=targeted" replace />}
                />
                <Route path="/copilot" element={<Copilot />} />
                <Route path="/topic-drill" element={<TopicDrill />} />
                <Route
                  path="/resume-interview"
                  element={<Navigate to="/mock-interview?mode=live" replace />}
                />
                <Route
                  path="/resume-manager"
                  element={
                    <Suspense fallback={null}>
                      <ResumeManager />
                    </Suspense>
                  }
                />
                <Route
                  path="/resume-manager/:id"
                  element={
                    <Suspense fallback={null}>
                      <ResumeEditor />
                    </Suspense>
                  }
                />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppShell>
            </ProviderGate>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <TaskStatusProvider>
          <ErrorBoundary>
            <AppRoutes />
            <TaskNotification />
          </ErrorBoundary>
        </TaskStatusProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
