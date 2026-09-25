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

- `Ial2ClaimTokenShape` checks field shapes and formats only. It rejects `email_verified` and `phone_number_verified`, because the spec says they SHALL NOT be populated.
- `ial2ClaimTokenSchema(opts)` also enforces the spec's SHALL rules:
  - `aud` must be (or contain) the app's Client ID
  - `exp` must be after `iat` and no later than `iat + 300`

  It also checks that the token hasn't expired and that `auth_time` isn't after `iat`. It doesn't verify JWT signatures, so run it on the payload after you've verified the token.
- `Ial2ClaimToken` / `Ial2ClaimTokenInput` are the parsed and wire types, inferred from the schema.
- `toFhirPatient(claims, { includeSsn? })` maps the claims to a FHIR R4 `Patient`:
  - `iss` + `sub` become the primary identifier
  - historical names, phones and addresses become entries with `use: "old"`
  - `address.street_address` is split on newlines into `Address.line`
  - the SSN is left out unless you ask for it, and `legal_id` isn't mapped

## Conventions

- `exp`, `iat` and `auth_time` are OIDC NumericDate values (seconds since the epoch).
- Fields the spec marks "Required if present" are optional in the schema, because a validator can't tell whether the CSP holds the value.
- `address` is the OIDC address object. The spec lists `street_address`, `locality`, `region`, `postal_code` and `country`, all required. OIDC's `formatted` isn't listed, so it's dropped.
- `legal_id` is `{ legal_id_issuer, id_number }`, e.g. `{ "legal_id_issuer": "TX", "id_number": "123456780" }`.
- `identity_assurance_level` was struck from the draft. It's replaced by `token_policy`, which must be `{ trust_framework: "nist_800_63a", assurance_level: "ial2" | "ial3" }`.

## Open questions in the draft

1. The spec doesn't define a structure for `historical_name`. This package uses `{ given_name?, middle_name?, family_name? }` with at least one part present.
2. The spec doesn't say what shape `historical_address` entries have. This package uses the same shape as `address`.
3. `legal_id` is described as "documents" (plural), but the spec shows one object. This package accepts one object or an array of them.
4. `ssn_itin` is described as "Social security number", but its name includes ITIN. This package accepts any 9-digit number.
5. `gender` ("as recorded at birth") is closer to US Core `birthsex` than to `Patient.gender`.

## License

[MIT](LICENSE)
