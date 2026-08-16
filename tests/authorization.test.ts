import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { anon, organization, server, sql, user } from "./helpers/harness.js";

/**
 * Authorization lives in `organization_members`, never on the user.
 *
 * Every case here was a real hole at some point: a role gate that admitted
 * strangers and refused owners, address-keyed reads with no owner check, and a
 * public route that returned an entire staff roster.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

describe("registration cannot grant authority", () => {
  it("ignores a role supplied in the request body", async () => {
    const mallory = await user("Mallory");

    const [column] = await sql`
      select count(*)::int as n from information_schema.columns
      where table_name = 'users' and column_name = 'role'`;

    assert.equal(column.n, 0, "users.role must not exist to be escalated into");

    const me = await mallory.call("/auth/me");
    assert.equal(me.body.data.user.role, "user");
  });
});

describe("organization routes", () => {
  it("admit a signer of that organization", async () => {
    const owner = await user("Owner");
    const org = await organization({ owner: owner.address });

    for (const path of [
      `/organizations/${org.id}`,
      `/organizations/${org.id}/employees`,
      `/payroll/organizations/${org.id}/batches`,
      `/proposals/organizations/${org.id}`,
    ]) {
      assert.equal((await owner.call(path)).status, 200, path);
    }
  });

  it("refuse a stranger", async () => {
    const owner = await user("Owner");
    const stranger = await user("Stranger");
    const org = await organization({ owner: owner.address });

    for (const path of [
      `/organizations/${org.id}`,
      `/organizations/${org.id}/employees`,
      `/payroll/organizations/${org.id}/batches`,
      `/proposals/organizations/${org.id}`,
    ]) {
      assert.equal((await stranger.call(path)).status, 403, path);
    }
  });

  it("refuse a signer of a different organization", async () => {
    const owner = await user("Owner");
    const rival = await user("Rival");
    const org = await organization({ owner: owner.address });
    await organization({ owner: rival.address });

    const res = await rival.call(`/organizations/${org.id}/employees`);
    assert.equal(res.status, 403);
  });

  it("keep a missing batch indistinguishable from a forbidden one", async () => {
    const stranger = await user("Stranger");
    const res = await stranger.call("/payroll/batches/definitely-not-a-batch");
    assert.equal(res.status, 403, "404 here would confirm which batch names exist");
  });
});

describe("address-keyed reads", () => {
  it("require a session", async () => {
    const victim = await user("Victim");

    for (const path of [
      `/transactions/${victim.address}`,
      `/transactions/${victim.address}/summary`,
      `/transactions/${victim.address}/chart`,
      `/wallet/${victim.address}/balance`,
      `/balances/${victim.address}`,
    ]) {
      assert.equal((await anon(path)).status, 401, path);
    }
  });

  it("allow your own address", async () => {
    const victim = await user("Victim");

    for (const path of [
      `/transactions/${victim.address}`,
      `/organizations/signer/${victim.address}`,
    ]) {
      assert.equal((await victim.call(path)).status, 200, path);
    }

    // The balance routes read the token contract, and these tests deliberately
    // have no chain to read. What is asserted is that the gate opened, which is
    // the only part of them this file is about.
    for (const path of [
      `/wallet/${victim.address}/balance`,
      `/balances/${victim.address}`,
    ]) {
      assert.notEqual((await victim.call(path)).status, 403, path);
    }
  });

  it("refuse someone else's address", async () => {
    const victim = await user("Victim");
    const stranger = await user("Stranger");

    for (const path of [
      `/transactions/${victim.address}`,
      `/balances/${victim.address}`,
      `/organizations/signer/${victim.address}`,
      `/organizations/creator/${victim.address}`,
    ]) {
      assert.equal((await stranger.call(path)).status, 403, path);
    }
  });

  it("let a signer read the treasury but not an employee", async () => {
    const owner = await user("Owner");
    const employee = await user("Employee");
    const org = await organization({
      owner: owner.address,
      employees: [{ address: employee.address }],
    });

    assert.equal((await owner.call(`/transactions/${org.treasury}`)).status, 200);
    assert.equal(
      (await employee.call(`/transactions/${org.treasury}`)).status,
      403,
      "the treasury carries every colleague's pay and bank details"
    );
    assert.equal((await employee.call(`/transactions/${employee.address}`)).status, 200);
  });
});

describe("what is public", () => {
  it("tells an anonymous caller only whether a wallet is registered", async () => {
    const owner = await user("Owner");
    await organization({ owner: owner.address });

    const res = await anon(`/auth/check/${owner.address}`);

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.data), ["isRegistered"]);
    assert.equal(res.body.data.isRegistered, true);
  });

  it("hides people and paperwork behind the slug route", async () => {
    const owner = await user("Owner");
    const stranger = await user("Stranger");
    const employee = await user("Employee");
    const org = await organization({
      owner: owner.address,
      employees: [{ address: employee.address }],
    });

    for (const res of [await anon(`/organizations/slug/${org.slug}`),
                       await stranger.call(`/organizations/slug/${org.slug}`)]) {
      assert.equal(res.status, 200);
      for (const key of ["employees", "signers", "businessEmail",
                         "registrationNumber", "taxIdentificationNumber"]) {
        assert.equal(res.body.data[key], undefined, `${key} must not be public`);
      }
    }

    const asSigner = await owner.call(`/organizations/slug/${org.slug}`);
    assert.ok(Array.isArray(asSigner.body.data.employees), "signers still get the roster");
  });

  it("does not enumerate organizations", async () => {
    const owner = await user("Owner");
    const stranger = await user("Stranger");
    await organization({ owner: owner.address });

    const listed = await stranger.call("/organizations");
    const rows = listed.body.data?.organizations ?? listed.body.data ?? [];

    assert.equal(rows.length, 0, "a full slug list makes the slug route enumerable");
  });
});

describe("directory lookups", () => {
  it("stay authenticated and rate limited", async () => {
    const looker = await user("Looker");
    const target = await user("Target");

    assert.equal((await anon(`/users/search/${target.address}`)).status, 401);

    let throttled = 0;
    for (let i = 0; i < 25; i++) {
      const res = await looker.call(`/users/search/nobody${i}`);
      if (res.status === 429) throttled++;
    }

    assert.ok(throttled > 0, "20 a minute is what stops username guessing");
  });
});

describe("employment is capped at one organization", () => {
  it("rejects a second active employer", async () => {
    const ownerA = await user("OwnerA");
    const ownerB = await user("OwnerB");
    const worker = ethers.Wallet.createRandom().address.toLowerCase();

    await organization({ owner: ownerA.address, employees: [{ address: worker }] });
    const orgB = await organization({ owner: ownerB.address });

    await assert.rejects(
      sql`insert into organization_members (organization_id, address, name, role)
          values (${orgB.id}, ${worker}, 'Worker', 'employee')`,
      /duplicate key|unique/i,
      "the cap must be a database constraint, not a service check"
    );
  });

  it("leaves signing uncapped", async () => {
    const signer = await user("Signer");
    const other = await user("Other");

    const a = await organization({ owner: other.address, signers: [signer.address] });
    const b = await organization({ owner: other.address, signers: [signer.address] });

    assert.equal((await signer.call(`/organizations/${a.id}`)).status, 200);
    assert.equal((await signer.call(`/organizations/${b.id}`)).status, 200);
  });
});
