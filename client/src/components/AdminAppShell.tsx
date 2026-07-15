import { Outlet } from "react-router-dom";
import { AdminToastProvider } from "@/components/AdminToastProvider";

export function AdminAppShell() {
  return (
    <AdminToastProvider>
      <Outlet />
    </AdminToastProvider>
  );
}
