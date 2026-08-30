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
 *
 * A NOTE ON THE URL YOU CHOOSE LOCALLY, because it costs hours otherwise. Prefer the Unix
 * socket:
 *
 *     DATABASE_URL="postgresql:///mm_test?host=/tmp"
 *
 * Over TCP (`postgres://you@127.0.0.1:5432/mm_test`) these suites open enough short-lived
 * connections that macOS runs out of ephemeral ports after a few full runs — 8,600+ sockets
 * in TIME_WAIT, and then random tests fail with
 * "connect EADDRNOTAVAIL 127.0.0.1:5432 - Local (0.0.0.0:0)". That is the LOCAL socket
 * failing to bind; it has nothing to do with Postgres, and it looks exactly like
 * order-dependent flakiness. Measured on the same machine, same commit: three runs over TCP
 * gave 309, 309, then 19 failures; three over the socket gave 309, 309, 309.
 *
 * The guard below accepts the socket form — an empty hostname with a database name
 * containing "test" passes the second condition.
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
