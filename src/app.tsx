import { AccountMenu } from "./components/account-menu";
import { Footer } from "./components/footer";
import { Header } from "./components/header";
import { ThemeToggle } from "./components/theme-toggle";
import type { AppContext } from "./lib/context";
import { Landing } from "./screens/landing";
import { NotFound } from "./screens/not-found";
import { Tool } from "./screens/tool";
import { Viewer } from "./screens/viewer";
import { Backdrop } from "./ui/backdrop";

export function App({ ctx }: { ctx: AppContext }) {
  const signedIn = Boolean(ctx.email);
  return (
    <>
      <Backdrop />
      <Header showSwitcher={ctx.footerLinks} signedIn={signedIn}>
        {ctx.page === "tool" && ctx.email ? (
          <AccountMenu email={ctx.email} accountUrl={ctx.accountUrl} />
        ) : ctx.page === "landing" ? (
          <a href="/api/auth/login" className="btn btn-secondary btn-sm">
            Sign in
          </a>
        ) : null}
        <ThemeToggle />
      </Header>
      {ctx.page === "viewer" ? (
        <Viewer />
      ) : ctx.page === "notfound" ? (
        <NotFound />
      ) : ctx.page === "tool" ? (
        <Tool />
      ) : (
        <Landing enrollUrl={ctx.enrollUrl} sessionUrl={ctx.sessionUrl} />
      )}
      <Footer showLinks={ctx.footerLinks} />
    </>
  );
}
