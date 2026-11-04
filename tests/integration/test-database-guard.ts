/**
 * Os testes de integração APAGAM todas as tabelas do banco de testes
 * (TRUNCATE). Esta trava impede que uma configuração errada aponte esse
 * processo para um banco de desenvolvimento ou, pior, de produção.
 */
export function assertDisposableTestDatabase(url: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Testes de integração não rodam com NODE_ENV=production.");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL inválida.");
  }
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Recusado: o banco de testes "${databaseName}" não tem "test" no nome. Os testes apagam todos os dados do banco; use um banco descartável (ex.: crm_test).`,
    );
  }
}
