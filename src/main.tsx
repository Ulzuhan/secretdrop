/**
 * El punto de entrada. Qué se pinta lo decide el servidor en el nodo raíz: si
 * hay sesión, quién es y qué pantalla toca. Aquí sólo se lee y se monta.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { readContext } from "./lib/context";
import "./styles/index.css";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app root");

createRoot(root).render(
  <StrictMode>
    <App ctx={readContext(root)} />
  </StrictMode>,
);
