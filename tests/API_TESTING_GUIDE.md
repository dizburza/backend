# Testing the Dizburza API

There are two things here. `npm test` is the automated suite; `api-tests.http`
is for poking at the API by hand.

```bash
createdb dizburza_test
TEST_DATABASE_URL=postgresql://localhost:5432/dizburza_test npm run test:setup
TEST_DATABASE_URL=postgresql://localhost:5432/dizburza_test npm test
```

It runs against a real Postgres, because most of what it asserts is enforced by
the schema rather than by service code.

`api-tests.http` in this folder is the runnable-by-hand version. Open it in VS Code with
the REST Client extension and click "Send Request" above any block. This file
explains the parts a request list cannot.

## Getting a session

Auth is an httpOnly session cookie, not a bearer token. The token is not in any
response body, so there is nothing to copy into a variable.

That leaves one step no HTTP client can do: signing. The login endpoint wants a
secp256k1 signature over a nonce the server issued.

```bash
cd backend
# .env needs:
#   USER_PRIVATE_KEY=0x...
#   USER_ADDRESS=0x...
#   API_URL=http://localhost:5000
npm run generateSignature
```

It fetches the challenge, signs it and prints the signature. Paste that into the
register or login request in `api-tests.http`.

After that, REST Client keeps cookies between requests, so everything below the
login block is authenticated with no extra headers. If a request 401s, check
`rest-client.rememberCookiesForSubsequentRequests` is on. It is by default.

The nonce is consumed on use, so re-run the script per login, not per request.

`Authorization: Bearer <jwt>` still works, and the auth middleware keeps that
path deliberately for scripts with no cookie jar. You just cannot obtain the
token from an HTTP response any more.

## Things that will trip you up

**The auth rate limiter.** Five *failed* attempts per 15 minutes per IP, and a
bad signature counts. Lock yourself out and the fix is restarting the API, since
without `REDIS_URL` the counters live in process memory.

**SSE is not testable here.** `GET /events/stream` holds the connection open
forever, so REST Client hangs waiting for a response that never completes:

```bash
curl -N -b "dz_session=<cookie>" \
  "http://localhost:5000/api/events/stream?addresses=0xYOUR_ADDRESS"
```

You may only subscribe to your own wallet and the treasuries of organizations
you belong to. Anything else is filtered out, and a request with nothing
subscribable left returns 400.

**CSRF only fires when it can see an origin.** The guard checks `Origin` or
`Referer` when present and ignores the request when neither is, which is why
ordinary REST Client calls pass and a browser on another site does not. Add an
`Origin` header by hand to exercise the 403.

**Amounts are human values, everywhere you send them.** Salaries, batch
recipient amounts and proposal amounts are all scaled server side by the token's
decimals. Sending pre-scaled base units silently overpays by a factor of
10^decimals. Reading is the mirror image: `salaryFormatted` and
`totalAmountFormatted` come back ready to render, so the client never needs to
know the precision. Get decimals from `GET /token` if you are building a
contract call, and never hardcode 6.

**Ids are UUIDs.** Organizations, proposals and employees. Batches are addressed
by `batchName` instead.

## Authorization is per organization

Organization, payroll and proposal routes check that you are an active signer or
owner **of the organization in the path**, via `organization_members`. Signing
in is not enough, and neither is signing for some other organization.

Routes keyed by a wallet address (`/transactions/:address`, `/wallet/:address/*`,
`/balances/:address`, `/organizations/signer/:address`, `/organizations/creator/:address`)
allow your own address and the treasuries of organizations you sign for. Passing
someone else's is 403, and passing any address without a session is 401. These
were unauthenticated, and the transaction row carries bank details, memos and
the counterparty's name, none of which is on chain.

Expect 403 rather than 404 when you are not a member, including for an
organization or batch that does not exist. Batch names are guessable, so
confirming one exists would itself be a disclosure.

This used to read a global `users.role` column instead, which was not membership
at all: a genuine owner got 403 on their own organization, while anyone who
passed `"role": "admin"` at registration got 200 on everyone else's employee
list, salaries and wallet addresses included. Registration no longer accepts
`role`, and `requireRole` is gone from these routes.

## A working order

1. `GET /health`, then `GET /token` to confirm the payroll token resolved. If
   this fails, the RPC is unreachable and nothing that formats an amount will
   work.
2. `npm run generateSignature`, then register or log in.
3. `GET /auth/me` to prove the cookie is being sent.
4. Balances and transactions for your own address.
5. Create an organization. Check the identifiers first: registration numbers and
   TINs are unique platform-wide, and the check runs again immediately before
   deployment because a deploy cannot be undone if the record is then rejected.
6. Add employees, then batches, then proposals.

Steps 5 and 6 need you to be a signer of that organization, which creating it makes you.

## Endpoint reference

Everything is under `/api`. Authenticated unless noted.

### Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | |
| GET | `/token` | Payroll token address, symbol, decimals, logo |
| GET | `/auth/check/:address` | `isRegistered` only, nothing else |
| GET | `/auth/message/:address` | Sign-in challenge |
| GET | `/organizations/slug/:slug` | Name and address only without a session |
| POST | `/webhooks/alchemy` | Signature-verified, not called by hand |

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Signs you in. Rate limited |
| POST | `/auth/login` | Needs a fresh nonce. Rate limited |
| POST | `/auth/logout` | Clears the cookie |
| GET | `/auth/me` | Profile, role, organization, memberships |

### Wallet and transactions

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/balances/:address` | Own or a treasury you sign for |
| GET | `/wallet/:address/balance` | |
| GET | `/wallet/:address/summary` | |
| GET | `/transactions/:address` | `page`, `limit` (max 100) |
| GET | `/transactions/:address/summary` | |
| GET | `/transactions/:address/chart` | `period` |
| POST | `/transactions/watch` | Hash only |
| POST | `/transactions/record` | Hash plus memo and category |

### Organizations

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/organizations` | |
| GET | `/organizations` | Yours, not the platform |
| GET | `/organizations/identifiers/available` | `registrationNumber`, `taxIdentificationNumber` |
| GET | `/organizations/signer/:address` | Own address only, may be several |
| GET | `/organizations/creator/:address` | Own address only |
| GET | `/organizations/:id` | members only |
| POST | `/organizations/:id/employees` | members only |
| GET | `/organizations/:id/employees` | members only |
| PATCH | `/organizations/:id/employees/:username` | members only |
| DELETE | `/organizations/:id/employees/:username` | members only, soft |
| GET | `/organizations/:id/employees/template` | members only |
| POST | `/organizations/:id/employees/bulk` | members only |

### Payroll

All members only. These record what the contract did; they are not the authority.

| Method | Path |
| --- | --- |
| POST | `/payroll/batches` |
| GET | `/payroll/organizations/:id/batches` |
| GET | `/payroll/batches/:batchName` |
| POST | `/payroll/batches/:batchName/approve` |
| POST | `/payroll/batches/:batchName/revoke` |
| POST | `/payroll/batches/:batchName/execute` |
| POST | `/payroll/batches/:batchName/cancel` |

### Proposals

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/proposals` | Signers only |
| GET | `/proposals/organizations/:organizationId` | Signers only, `status` filter |
| GET | `/proposals/:id` | Signers only, with votes and pending signers |
| POST | `/proposals/:id/votes` | `for` or `against`, once per signer |
| POST | `/proposals/:id/cancel` | Raiser only, while open |

### Users

Exact match only. There is no prefix search and no suggestion endpoint, by
design. All rate limited to 20 a minute keyed by session.

| Method | Path |
| --- | --- |
| GET | `/users/resolve/:username` |
| GET | `/users/search/:username` |
| GET | `/users/search-address/:address` |
| POST | `/users/batch-lookup` |

### Realtime

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/events/stream?addresses=` | SSE, use curl |

## Status codes you should expect

| Code | Meaning here |
| --- | --- |
| 400 | Validation, or no subscribable address on the stream |
| 401 | No session, or an expired one |
| 403 | Not a signer of that organization, or the CSRF origin check |
| 409 | A uniqueness rule: second employer for one person, duplicate vote, registration number or TIN already taken |
| 429 | Rate limited |

409 is the interesting one. Those rules are database constraints rather than
service checks, so a concurrent request cannot slip past them, and
`isUniqueViolation` turns the violation into a 409 rather than a 500.

## Removed endpoints

If you are working from an older copy:

* `GET /users/suggest` and `POST /users/resolve-addresses` are gone. They let
  anyone walk the user base two characters at a time and come away with real
  names and wallet addresses.
* Bearer tokens in login responses are gone. The session is a cookie.
* Mongo ids are gone. Everything is UUIDs.
