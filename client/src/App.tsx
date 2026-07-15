import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AdminAppShell } from "./components/AdminAppShell";
import { HeaderSlotProvider } from "./components/HeaderSlot";
import { RequireAdminAuth } from "./components/RequireAdminAuth";
import { PublicHome } from "./pages/PublicHome";
import { SessionViewer } from "./pages/SessionViewer";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminAiSettings } from "./pages/AdminAiSettings";
import { AdminSessionControl } from "./pages/AdminSessionControl";

export default function App() {
  return (
    <HeaderSlotProvider>
      <Routes>
      {/* Standalone, full-screen immersive reader (own chrome). */}
      <Route path="/session/:code" element={<SessionViewer />} />

      <Route element={<Layout />}>
        <Route path="/" element={<PublicHome />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdminAuth>
              <AdminAppShell />
            </RequireAdminAuth>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="ai" element={<AdminAiSettings />} />
          <Route path="session/:id" element={<AdminSessionControl />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </HeaderSlotProvider>
  );
}
