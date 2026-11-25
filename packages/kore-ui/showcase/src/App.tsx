import { AuthPage } from "./pages/AuthPage";
import { FilesPage } from "./pages/FilesPage";
import { Gallery } from "./pages/Gallery";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { useRoute } from "./route";

export function App() {
  const route = useRoute();
  const [page, variant] = route.split("/");
  switch (page) {
    case "app":
      return <FilesPage />;
    case "users":
      return <UsersPage />;
    case "settings":
      return <SettingsPage />;
    case "auth":
      return <AuthPage variant={variant} />;
    default:
      return <Gallery />;
  }
}
