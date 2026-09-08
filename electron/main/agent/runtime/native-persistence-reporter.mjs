/** Coalesce provider-owned persistence checks. A native turn receipt is not sufficient. */
export function createNativePersistenceReporter({ verify, report, isClosed = () => false }) {
  let flight = null;
  let confirmed = false;
  return {
    confirm() {
      if (confirmed || flight || isClosed()) return flight ?? Promise.resolve();
      flight = Promise.resolve().then(verify).then((identity) => {
        if (!identity || isClosed()) return;
        confirmed = true;
        report(identity);
      }).catch(() => { /* Unknown persistence remains unverified; discovery can confirm later. */ })
        .finally(() => { flight = null; });
      return flight;
    },
  };
}
