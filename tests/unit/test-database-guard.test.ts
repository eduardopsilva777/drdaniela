import { describe, expect, it } from "vitest";

import { assertDisposableTestDatabase } from "../integration/test-database-guard";

describe("trava do banco de testes (os testes apagam todos os dados)", () => {
  it("aceita apenas bancos com 'test' no nome", () => {
    expect(() => assertDisposableTestDatabase("postgresql://crm:x@localhost:5432/crm_test?schema=public")).not.toThrow();
    expect(() => assertDisposableTestDatabase("postgresql://crm:x@localhost:5432/TEST_clinica")).not.toThrow();
    expect(() => assertDisposableTestDatabase("postgresql://crm:x@localhost:5432/crm_dev")).toThrow(/não tem "test"/);
    expect(() => assertDisposableTestDatabase("postgresql://crm:x@db.prod:5432/crm")).toThrow(/não tem "test"/);
    expect(() => assertDisposableTestDatabase("isso não é uma url")).toThrow(/inválida/);
  });
});
