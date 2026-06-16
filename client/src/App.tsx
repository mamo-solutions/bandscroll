import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAdminAuth } from "./components/RequireAdminAuth";
import { PublicHome } from "./pages/PublicHome";
import { SessionViewer } from "./pages/SessionViewer";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminSessionControl } from "./pages/AdminSessionControl";

export default function App() {
  return (
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
              <AdminDashboard />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/session/:id"
          element={
            <RequireAdminAuth>
              <AdminSessionControl />
            </RequireAdminAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
