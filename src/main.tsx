/**
 * App entry. React 19 createRoot + react-router v8 createBrowserRouter.
 * Routes are code-split via React.lazy; the Layout wraps them in <Suspense>,
 * so the loading fallback lives in the shell rather than per-route.
 */

import { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import Layout from "./components/Layout";
import "./index.css";

const Dashboard = lazy(() => import("./routes/Dashboard"));
const Models = lazy(() => import("./routes/Models"));
const Projects = lazy(() => import("./routes/Projects"));
const Sessions = lazy(() => import("./routes/Sessions"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "models", element: <Models /> },
      { path: "projects", element: <Projects /> },
      { path: "sessions", element: <Sessions /> },
    ],
  },
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
