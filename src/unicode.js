// Unicode normalization for MATCHING and LOOKUP — never for the bytes we return.
//
// Measured on Windows/NTFS 2026-09-14 (devlog/_plan/260914_path-matching-unicode):
// the NFC and NFD spellings of one Korean name are two SEPARATE directory
// entries, realpath() of the unused spelling throws ENOENT, and
// `nfd.includes(nfc)` is false for the same visible name. macOS is the opposite
// case: APFS lookup is normalization-insensitive, so the guest string that works
// there fails here. Neither platform is wrong; the comparison was.
//
// Two jobs that must not be confused:
//   nfc()                   — fold both sides of a COMPARISON (filters, hash keys).
//   normalizationVariants() — candidate spellings for a filesystem LOOKUP, so the
//                             OS decides which one exists. What it returns is then
//                             realpath'd, which is what lets containment checks
//                             stay byte-exact.
//
// NFC, never NFKC: compatibility folding maps U+FB03 to "ffi" and would make two
// genuinely different names compare equal. NFC is also not injective — U+212B
// (ANGSTROM SIGN) and U+00C5 both compose to U+00C5 — which is precisely why it
// must never decide root containment. See src/paths.js.

const NON_ASCII = /[^\u0000-\u007F]/;

/** True when the string contains anything normalization could change. */
export function hasNonAscii(s) {
  return typeof s === 'string' && NON_ASCII.test(s);
}

/** Canonical composed form, with an ASCII fast path so hot loops pay nothing. */
export function nfc(s) {
  if (!hasNonAscii(s)) return s;
  return s.normalize('NFC');
}

/**
 * Case-sensitive substring test that ignores normalization-form differences.
 * The caller keeps the ORIGINAL haystack: this decides MATCHING, not identity.
 * The fold is skipped only when both sides are ASCII, where it cannot change
 * the answer — a non-ASCII haystack is folded even for an ASCII needle, because
 * composition can remove an ASCII base character from a decomposed sequence.
 */
export function includesText(haystack, needle) {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return false;
  if (haystack.includes(needle)) return true;
  if (!hasNonAscii(haystack) && !hasNonAscii(needle)) return false;
  return haystack.normalize('NFC').includes(needle.normalize('NFC'));
}

/**
 * The other spellings of `s` worth trying against a filesystem, excluding `s`
 * itself and any duplicate. Empty for ASCII or for a string already stable under
 * both forms, so the caller's fallback path is untouched in the common case.
 */
export function normalizationVariants(s) {
  if (!hasNonAscii(s)) return [];
  const out = [];
  for (const form of ['NFC', 'NFD']) {
    const variant = s.normalize(form);
    if (variant !== s && !out.includes(variant)) out.push(variant);
  }
  return out;
}

