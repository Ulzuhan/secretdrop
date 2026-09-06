/**
 * El punto de entrada. Lo que decide qué se pinta lo pone el servidor en el
 * nodo raíz: si hay sesión, quién es, y qué pantalla toca.
 *
 * El servidor manda porque es quien tiene la cookie. Que el navegador dedujera
 * «hay sesión» por su cuenta sería inventarse una respuesta que sólo el
 * servidor puede dar.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KaiCorpHeader } from "./components/kaicorp-header";
import { KaiCorpFooter } from "./components/kaicorp-footer";
import { KaiCorpAccountMenu } from "./components/kaicorp-account-menu";
import { Landing } from "./components/landing";
import { Tool } from "./components/tool";
import ViewSecretPage from "./components/viewer";
import "./globals.css";

const raiz = document.getElementById("app");
if (!raiz) throw new Error("falta el nodo raíz");

const pantalla = raiz.dataset.page ?? "landing";
const email = raiz.dataset.email || "";
const alta = raiz.dataset.enrollUrl || null;
const cuenta = raiz.dataset.accountUrl || null;

function Pagina() {
  if (pantalla === "viewer") return <ViewSecretPage />;
  if (pantalla === "tool") return <Tool />;
  return <Landing enrollUrl={alta} />;
}

createRoot(raiz).render(
  <StrictMode>
    <KaiCorpHeader app="SecretDrop">
      {email ? <KaiCorpAccountMenu email={email} accountUrl={cuenta} /> : null}
    </KaiCorpHeader>
    <Pagina />
    <KaiCorpFooter current="secretdrop" />
  </StrictMode>
);
