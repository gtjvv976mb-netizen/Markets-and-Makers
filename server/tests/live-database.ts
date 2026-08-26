/**
 * Whether the destructive suites may run — and a hard stop when they are pointed at a
 * database they must never touch.
 *
 * Every live suite in here empties the tables it uses: player, business, item_balance,
 * currency_account, currency_ledger, market_listing, auth_session. The only condition for
 * that was `Boolean(process.env.DATABASE_URL)`, which does not ask WHICH database. On
 * Render that variable is the production database, wired in by `fromDatabase` in
 * render.yaml — so `npm test` there would have deleted every player, every business, every
 * balance and the whole ledger.
 *
 * That is not hypothetical. Adding `npm test` to the Render build is the obvious way to
 * make tests gate a deploy, and it was about to be done in this repo for exactly that
 * reason. The guard costs nothing and removes the possibility.
 *
 * Refusing loudly rather than skipping quietly is deliberate: a silent skip would hide
 * that the suite never ran, which is its own way to lose.
 */

const url = process.env.DATABASE_URL;

/** Local databases, and any database whose name says it is for testing. */
function safeToEmpty(connection: string): boolean {
  try {
    const parsed = new URL(connection);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const name = parsed.pathname.replace(/^\//, "").toLowerCase();
    return name.includes("test");
  } catch {
    // Not a URL we can read. Assume the worst.
    return false;
  }
}

export const live: boolean = (() => {
  if (!url) return false;
  if (process.env.MM_ALLOW_DESTRUCTIVE_TESTS === "1") return true;
  if (safeToEmpty(url)) return true;
  throw new Error(
    "Refusing to run the destructive test suites against this DATABASE_URL.\n"
    + "These tests EMPTY player, business, item_balance, currency_account, currency_ledger\n"
    + "and market_listing. Point DATABASE_URL at a local database or one whose name contains\n"
    + "'test', or set MM_ALLOW_DESTRUCTIVE_TESTS=1 if you are certain this database is\n"
    + "disposable. Never set that on Render: DATABASE_URL there is the live realm.",
  );
})();
