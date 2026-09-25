/**
 * IAL2 Claim Token (Section E), as TypeScript types + Zod schemas,
 * plus an example mapping to a FHIR R4 Patient.
 *
 * Conventions:
 * - Zod is the source of truth; TS types come from z.infer.
 * - Time claims (exp, iat, auth_time) are OIDC NumericDate: seconds since epoch.
 * - "Required if present": optional in the schema. The CSP MUST send the field
 *   if it holds the value, but a validator can't tell when that's the case.
 * - "For discussion" fields are optional and marked @experimental.
 * - "SHALL NOT be populated" fields are rejected if present.
 * - `identity_assurance_level` is struck in the draft, replaced by `token_policy`.
 */
import { z } from "zod";
import type { Patient, HumanName, ContactPoint, Address, Identifier } from "fhir/r4.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** OIDC NumericDate: integer seconds since the Unix epoch. */
const NumericDate = z.number().int().nonnegative();

/** ISO 8601 full-date, YYYY-MM-DD (OIDC `birthdate` format). */
const FullDate = z.iso.date();

/** Phone numbers in E.164, e.g. +14165550123 (OIDC recommends E.164). */
const Phone = z.e164();

/** Nine digits, hyphens optional on input and stripped. */
const SsnOrItin = z
  .string()
  .regex(/^\d{3}-?\d{2}-?\d{4}$/, "Expected 9-digit SSN/ITIN")
  .transform((s) => s.replace(/-/g, ""));

/** For claims the spec says SHALL NOT be populated. */
const NotPopulated = z.never("SHALL NOT be populated").optional();

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export const TokenPolicySchema = z.strictObject({
  trust_framework: z.literal("nist_800_63a"),
  assurance_level: z.enum(["ial2", "ial3"]),
});
export type TokenPolicy = z.infer<typeof TokenPolicySchema>;

/**
 * Prior or alternate *legal* name (not aliases, nicknames, or preferred names).
 * Shape is a proposal; the draft doesn't define one. Any part may be missing
 * (e.g. only a prior family name), but not all of them.
 */
export const HistoricalNameSchema = z
  .object({
    given_name: z.string().min(1).optional(),
    middle_name: z.string().min(1).optional(),
    family_name: z.string().min(1).optional(),
  })
  .refine((n) => n.given_name || n.middle_name || n.family_name, "Expected at least one name part");
export type HistoricalName = z.infer<typeof HistoricalNameSchema>;

/** OIDC `address` claim, with the members the spec lists (no `formatted`). */
export const PostalAddressSchema = z.object({
  /** Full street address. May hold several lines, separated by "\n" (OIDC). */
  street_address: z.string().min(1),
  /** City or locality. */
  locality: z.string().min(1),
  /** State, province, or region. */
  region: z.string().min(1),
  /** ZIP or postal code. */
  postal_code: z.string().min(1),
  country: z.string().min(2),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

/** @experimental For discussion. Government-issued legal ID, e.g. a driver's license or passport. */
export const LegalIdSchema = z.object({
  /** Issuing authority, e.g. "TX". */
  legal_id_issuer: z.string().min(1),
  /** Document number. */
  id_number: z.string().min(1),
});
export type LegalId = z.infer<typeof LegalIdSchema>;

// ---------------------------------------------------------------------------
// Claim groups (kept separate so they compose and read like the table)
// ---------------------------------------------------------------------------

const OidcClaims = z.object({
  /** Issuer identifier. Case-sensitive https URL. */
  iss: z.url({ protocol: /^https$/ }),
  /** Subject identifier, unique within the issuer. */
  sub: z.string().min(1).max(255),
  /** Intended audience. SHALL be the app's Client ID (NPD ID, Medicare App Library client id, …). */
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]),
  /** Expiration. SHALL NOT be > iat + 300. */
  exp: NumericDate,
  /** Issued-at. */
  iat: NumericDate,
  /** Unique token id, for replay prevention. Required (beyond OIDC). */
  jti: z.string().min(1),
  /** Access token hash. Optional (OIDC). */
  at_hash: z.string().min(1).optional(),
  /** When end-user authentication occurred. Required by this profile (optional in OIDC). */
  auth_time: NumericDate,
  /** Framework + IAL. Replaces the struck `identity_assurance_level`. */
  token_policy: TokenPolicySchema,
});

const NameClaims = z.object({
  /** Given name(s), space-separated if several. Required (TEFCA). */
  given_name: z.string().min(1),
  /** Required if present. */
  middle_name: z.string().min(1).optional(),
  /** Surname(s) / last name(s). */
  family_name: z.string().min(1),
  /** Prior or alternate legal names. Required if present. */
  historical_name: z.array(HistoricalNameSchema).optional(),
});

const DemographicClaims = z.object({
  birthdate: FullDate,
  /** Legal sex or gender as recorded at birth. Optional. */
  gender: z.string().min(1).optional(),
});

const ContactClaims = z.object({
  /** Verified email. */
  email: z.email(),
  /** SHALL NOT be populated. */
  email_verified: NotPopulated,
  /** Verified primary phone. */
  phone_number: Phone,
  /** SHALL NOT be populated. */
  phone_number_verified: NotPopulated,
  /** Previous phone numbers. Optional. */
  historical_phone_number: z.array(Phone).optional(),
});

const AddressClaims = z.object({
  address: PostalAddressSchema,
  /** Prior addresses. Required if present and validated by the CSP. */
  historical_address: z.array(PostalAddressSchema).optional(),
});

const IdentifierClaims = z.object({
  /** Full SSN or ITIN (9 digits). Optional. */
  ssn_itin: SsnOrItin.optional(),
  /** Last 4 of SSN/ITIN. Optional. */
  ssn_itin_short: z.string().regex(/^\d{4}$/).optional(),
  /** @experimental For discussion. CSP-specific per-person identifier. */
  uuid: z.string().min(1).optional(),
  /** @experimental For discussion. Government-issued legal ID document(s). */
  legal_id: z.union([LegalIdSchema, z.array(LegalIdSchema)]).optional(),
});

// ---------------------------------------------------------------------------
// Full token
// ---------------------------------------------------------------------------

/** Structural schema only: shapes and formats, no cross-field or time checks. */
export const Ial2ClaimTokenShape = OidcClaims.extend(NameClaims.shape)
  .extend(DemographicClaims.shape)
  .extend(ContactClaims.shape)
  .extend(AddressClaims.shape)
  .extend(IdentifierClaims.shape);

/** The decoded payload, after validation (SSN hyphens stripped, etc.). */
export type Ial2ClaimToken = z.infer<typeof Ial2ClaimTokenShape>;
/** What a CSP may put on the wire, before transforms. */
export type Ial2ClaimTokenInput = z.input<typeof Ial2ClaimTokenShape>;

export const MAX_TOKEN_LIFETIME_SECONDS = 300;

export interface Ial2ValidationOptions {
  /** Your app's Client ID. `aud` SHALL be (or contain) this. */
  clientId: string;
  /** Expected issuer(s). Omit to accept any https issuer. */
  issuers?: readonly string[];
  /** Current time in seconds. Defaults to Date.now(). Pass `false` to skip time checks. */
  now?: number | false;
  /** Allowed clock skew in seconds. Default 30. */
  clockSkewSeconds?: number;
}

/**
 * Build a validator for one relying party. Adds the "SHALL" rules from the
 * table plus the usual time checks. Run it on the *payload* after verifying
 * the JWT signature (e.g. with `jose.jwtVerify`); it does not check signatures.
 */
export function ial2ClaimTokenSchema(opts: Ial2ValidationOptions) {
  const skew = opts.clockSkewSeconds ?? 30;

  return Ial2ClaimTokenShape.superRefine((t, ctx) => {
    const auds = Array.isArray(t.aud) ? t.aud : [t.aud];
    if (!auds.includes(opts.clientId)) {
      ctx.addIssue({ code: "custom", path: ["aud"], message: `aud must be the app's Client ID (${opts.clientId})` });
    }

    if (opts.issuers && !opts.issuers.includes(t.iss)) {
      ctx.addIssue({ code: "custom", path: ["iss"], message: "Unexpected issuer" });
    }

    if (t.exp <= t.iat) {
      ctx.addIssue({ code: "custom", path: ["exp"], message: "exp must be after iat" });
    }
    if (t.exp > t.iat + MAX_TOKEN_LIFETIME_SECONDS) {
      ctx.addIssue({ code: "custom", path: ["exp"], message: `exp SHALL NOT be > iat + ${MAX_TOKEN_LIFETIME_SECONDS}` });
    }
    if (t.auth_time > t.iat + skew) {
      ctx.addIssue({ code: "custom", path: ["auth_time"], message: "auth_time is after iat" });
    }

    if (opts.now !== false) {
      const now = opts.now ?? Math.floor(Date.now() / 1000);
      if (t.exp + skew < now) ctx.addIssue({ code: "custom", path: ["exp"], message: "Token expired" });
      if (t.iat - skew > now) ctx.addIssue({ code: "custom", path: ["iat"], message: "iat is in the future" });
    }

    if (t.ssn_itin && t.ssn_itin_short && !t.ssn_itin.endsWith(t.ssn_itin_short)) {
      ctx.addIssue({ code: "custom", path: ["ssn_itin_short"], message: "Doesn't match last 4 of ssn_itin" });
    }
  });
}

// ---------------------------------------------------------------------------
// Mapping: claims -> FHIR R4 Patient
// ---------------------------------------------------------------------------

const SSN_SYSTEM = "http://hl7.org/fhir/sid/us-ssn";
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";

function toFhirGender(g: string | undefined): Patient["gender"] {
  if (!g) return undefined;
  switch (g.trim().toLowerCase()) {
    case "male":
    case "m":
      return "male";
    case "female":
    case "f":
      return "female";
    case "unknown":
    case "u":
      return "unknown";
    default:
      return "other";
  }
}

/** "Mary Ann" + "Louise" -> ["Mary", "Ann", "Louise"] */
function givens(given?: string, middle?: string): string[] | undefined {
  const parts = [given, middle].filter(Boolean).flatMap((s) => s!.trim().split(/\s+/));
  return parts.length ? parts : undefined;
}

function toFhirAddress(a: PostalAddress, use: Address["use"]): Address {
  return {
    use,
    type: "physical",
    line: a.street_address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    city: a.locality,
    state: a.region,
    postalCode: a.postal_code,
    country: a.country,
  };
}

/**
 * Map a validated IAL2 claim token to a FHIR R4 Patient (US Core-friendly).
 *
 * - `iss` + `sub` become the primary identifier (the CSP's subject id).
 * - Historical names, phones and addresses map with use = "old".
 * - SSN is included only when `includeSsn` is set; it's rarely something you
 *   want to write into a Patient you'll store or send on.
 */
export function toFhirPatient(
  t: Ial2ClaimToken,
  opts: { id?: string; includeSsn?: boolean } = {},
): Patient {
  const identifier: Identifier[] = [
    { use: "official", system: t.iss, value: t.sub, assigner: { display: t.iss } },
  ];
  if (t.uuid) identifier.push({ use: "secondary", system: `${t.iss}#uuid`, value: t.uuid });
  if (opts.includeSsn && t.ssn_itin) {
    identifier.push({
      use: "official",
      type: { coding: [{ system: V2_0203, code: "SS", display: "Social Security number" }] },
      system: SSN_SYSTEM,
      value: t.ssn_itin,
    });
  }

  const name: HumanName[] = [
    {
      use: "official",
      family: t.family_name,
      given: givens(t.given_name, t.middle_name),
    },
    ...(t.historical_name ?? []).map(
      (h): HumanName => ({
        use: "old",
        family: h.family_name,
        given: givens(h.given_name, h.middle_name),
      }),
    ),
  ];

  const telecom: ContactPoint[] = [
    { system: "phone", value: t.phone_number, rank: 1 },
    { system: "email", value: t.email },
    ...(t.historical_phone_number ?? []).map((p): ContactPoint => ({ system: "phone", value: p, use: "old" })),
  ];

  const address: Address[] = [
    toFhirAddress(t.address, "home"),
    ...(t.historical_address ?? []).map((a) => toFhirAddress(a, "old")),
  ];

  return {
    resourceType: "Patient",
    ...(opts.id && { id: opts.id }),
    meta: {
      source: t.iss,
      lastUpdated: new Date(t.auth_time * 1000).toISOString(),
    },
    identifier,
    active: true,
    name,
    telecom,
    gender: toFhirGender(t.gender),
    birthDate: t.birthdate,
    address,
  };
}
