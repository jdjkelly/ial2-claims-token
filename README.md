# ial2-claims-token

TypeScript types and [Zod](https://zod.dev) schemas for the **IAL2 Claim Token** (Section E of the draft TEFCA identity spec), plus an example mapping to a FHIR R4 `Patient`.

> The spec is a draft under discussion. Fields marked "For discussion" are optional and tagged `@experimental`.

## Usage

```ts
import { jwtVerify } from "jose";
import { ial2ClaimTokenSchema, toFhirPatient } from "ial2-claims-token";

const { payload } = await jwtVerify(jwt, jwks, { issuer: CSP_ISSUER });

const claims = ial2ClaimTokenSchema({ clientId: MY_CLIENT_ID }).parse(payload);
const patient = toFhirPatient(claims);
```

## What's in it

- `Ial2ClaimTokenShape` checks field shapes and formats only.
- `ial2ClaimTokenSchema(opts)` also enforces the spec's SHALL rules:
  - `aud` must be (or contain) the app's Client ID
  - `exp` must be after `iat` and no later than `iat + 300`

  It also checks that the token hasn't expired and that `auth_time` isn't after `iat`. It doesn't verify JWT signatures, so run it on the payload after you've verified the token.
- `Ial2ClaimToken` / `Ial2ClaimTokenInput` are the parsed and wire types, inferred from the schema.
- `toFhirPatient(claims, { includeSsn? })` maps the claims to a FHIR R4 `Patient`:
  - `iss` + `sub` become the primary identifier
  - historical names, phones and addresses become entries with `use: "old"`
  - the SSN is left out unless you ask for it

## Conventions

- `exp`, `iat` and `auth_time` are OIDC NumericDate values (seconds since the epoch).
- Fields the spec marks "Required if present" are optional in the schema, because a validator can't tell whether the CSP holds the value.
- `identity_assurance_level` was struck from the draft. It's replaced by `token_policy`, which must be `{ trust_framework: "nist_800_63a", assurance_level: "ial2" | "ial3" }`.

## Open questions in the draft

1. Both `address_line1` and `address_line2` are listed as the alias "/ street_address". In OIDC that's one multi-line string, so it can't stand for both. This package uses flat `address_line1` / `address_line2` fields, with `full_address` for OIDC's `formatted`.
2. The spec uses `last_name` alongside OIDC's `given_name`. Standard OIDC uses `family_name`.
3. The spec doesn't define structures for `name_historical`, `address_historical` or `legal_id_issuer`. The shapes here are proposals.
4. `ssn_itin` and `itin` overlap.
5. `gender` ("as recorded at birth") is closer to US Core `birthsex` than to `Patient.gender`.
