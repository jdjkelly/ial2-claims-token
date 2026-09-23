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

/** ITINs always start with 9 (IRS format 9XX-XX-XXXX). */
const Itin = SsnOrItin.refine((s) => s.startsWith("9"), "ITIN must begin with 9");

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export const TokenPolicySchema = z.strictObject({
  trust_framework: z.literal("nist_800_63a"),
  assurance_level: z.enum(["ial2", "ial3"]),
});
export type TokenPolicy = z.infer<typeof TokenPolicySchema>;

/** Prior or alternate *legal* name (not aliases, nicknames, or preferred names). */
export const HistoricalNameSchema = z.object({
  given_name: z.string().min(1).optional(),
  middle_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  name_full: z.string().min(1),
});
export type HistoricalName = z.infer<typeof HistoricalNameSchema>;

/** Same shape as the flat top-level address claims. */
export const PostalAddressSchema = z.object({
  address_line1: z.string().min(1),
  address_line2: z.string().min(1).optional(),
  locality: z.string().min(1),
  region: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(2),
  full_address: z.string().min(1),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;

/** @experimental For discussion. Shape is a proposal; the draft only says "issuer". */
export const LegalIdSchema = z.object({
  document_type: z.union([
    z.enum(["drivers_license", "state_id", "passport", "passport_card"]),
    z.string().min(1),
  ]),
  /** Issuing authority, e.g. "US-CA", "USA" (ISO 3166). */
  issuer: z.string().min(1),
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
  middle_name: z.string().min(1).optional(),
  last_name: z.string().min(1),
  /** First + middle + last concatenated, or the string from the legal document. */
  name_full: z.string().min(1),
  name_historical: z.array(HistoricalNameSchema).optional(),
});

const DemographicClaims = z.object({
  birthdate: FullDate,
  /** Legal sex or gender as recorded at birth. Optional. */
  gender: z.string().min(1).optional(),
});

const ContactClaims = z.object({
  /** Verified email. */
  email: z.email(),
  /** Verified primary phone. */
  phone_number: Phone,
  phone_number_historical: z.array(Phone).optional(),
});

const AddressClaims = PostalAddressSchema.extend({
  /** Prior addresses. Required if present and validated by the CSP. */
  address_historical: z.array(PostalAddressSchema).optional(),
});

const DiscussionClaims = z.object({
  /** @experimental Full SSN or ITIN (9 digits). */
  ssn_itin: SsnOrItin.optional(),
  /** @experimental Last 4 of SSN/ITIN. */
  ssn_itin_short: z.string().regex(/^\d{4}$/).optional(),
  /** @experimental CSP-specific per-person identifier. */
  uuid: z.string().min(1).optional(),
  /** @experimental ITIN, for individuals without an SSN. */
  itin: Itin.optional(),
  /** @experimental Government-issued legal ID document(s). */
  legal_id_issuer: z.union([LegalIdSchema, z.array(LegalIdSchema)]).optional(),
});

// ---------------------------------------------------------------------------
// Full token
// ---------------------------------------------------------------------------

/** Structural schema only: shapes and formats, no cross-field or time checks. */
export const Ial2ClaimTokenShape = OidcClaims.extend(NameClaims.shape)
  .extend(DemographicClaims.shape)
  .extend(ContactClaims.shape)
  .extend(AddressClaims.shape)
  .extend(DiscussionClaims.shape);

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
    text: a.full_address,
    line: [a.address_line1, a.address_line2].filter((l): l is string => !!l),
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
      text: t.name_full,
      family: t.last_name,
      given: givens(t.given_name, t.middle_name),
    },
    ...(t.name_historical ?? []).map(
      (h): HumanName => ({
        use: "old",
        text: h.name_full,
        family: h.last_name,
        given: givens(h.given_name, h.middle_name),
      }),
    ),
  ];

  const telecom: ContactPoint[] = [
    { system: "phone", value: t.phone_number, rank: 1 },
    { system: "email", value: t.email },
    ...(t.phone_number_historical ?? []).map((p): ContactPoint => ({ system: "phone", value: p, use: "old" })),
  ];

  const address: Address[] = [
    toFhirAddress(t, "home"),
    ...(t.address_historical ?? []).map((a) => toFhirAddress(a, "old")),
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
