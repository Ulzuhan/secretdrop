import { AccountMenu } from "./components/account-menu";
import { Footer } from "./components/footer";
import { Header } from "./components/header";
import type { AppContext } from "./lib/context";
import { Landing } from "./screens/landing";
import { Tool } from "./screens/tool";
import { Viewer } from "./screens/viewer";
import { Backdrop } from "./ui/backdrop";

export function App({ ctx }: { ctx: AppContext }) {
  return (
    <>
      <Backdrop />
      <Header>
        {ctx.page === "tool" && ctx.email ? (
          <AccountMenu email={ctx.email} accountUrl={ctx.accountUrl} />
        ) : ctx.page === "landing" ? (
          <a href="/api/auth/login" className="btn btn-secondary btn-sm">
            Sign in
          </a>
        ) : null}
      </Header>
      {ctx.page === "viewer" ? <Viewer /> : ctx.page === "tool" ? <Tool /> : <Landing enrollUrl={ctx.enrollUrl} />}
      <Footer showLinks={ctx.footerLinks} />
    </>
  );
}
