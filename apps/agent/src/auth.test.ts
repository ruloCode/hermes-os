import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedUser, parseAllowedUsers } from "./auth.js";

test("parseAllowedUsers normaliza espacios, mayúsculas y vacíos", () => {
  assert.deepEqual(parseAllowedUsers(" ABC-1 , Dueño@Mail.com ,, "), ["abc-1", "dueño@mail.com"]);
  assert.deepEqual(parseAllowedUsers(""), []);
});

test("lista vacía: ningún usuario entra aunque su JWT sea válido", () => {
  assert.equal(isAllowedUser({ id: "abc-1", email: "a@b.co" }, []), false);
});

test("entra por id o por email, sin importar mayúsculas", () => {
  const allowed = parseAllowedUsers("abc-1, owner@mail.com");
  assert.equal(isAllowedUser({ id: "ABC-1" }, allowed), true);
  assert.equal(isAllowedUser({ id: "otro", email: "Owner@Mail.com" }, allowed), true);
});

test("un usuario registrado por su cuenta no entra", () => {
  const allowed = parseAllowedUsers("owner@mail.com");
  assert.equal(isAllowedUser({ id: "intruso", email: "intruso@mail.com" }, allowed), false);
  assert.equal(isAllowedUser({ id: "intruso", email: null }, allowed), false);
});
