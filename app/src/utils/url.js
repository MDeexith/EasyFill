// Turns whatever the user typed into something a WebView can actually load.
//
// The URL bar doubles as a search box: "db dev" is a query, "db.dev" is a
// host. Blindly prefixing https:// on a query produced "https://db dev",
// which the WebView percent-encoded into a bogus hostname (ERR_NAME_NOT_RESOLVED).

const SEARCH_URL = 'https://www.google.com/search?q=';

// Scheme we're willing to hand to the WebView as-is.
const HAS_SCHEME_RE = /^https?:\/\//i;

// host[:port][/path…] — a dotted name with a plausible TLD, or localhost.
const LOOKS_LIKE_HOST_RE =
  /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#]\S*)?$/i;
// Bare IPv4, optionally with port/path.
const LOOKS_LIKE_IP_RE =
  /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#]\S*)?$/;

// Trailing segments that look like a TLD but never are — "node.js" and
// "resume.pdf" are searches, not hosts. Any TLD not listed here is allowed
// through, since a career site on an unusual TLD must still open.
const NOT_A_TLD =
  /\.(?:js|jsx|ts|tsx|py|rb|go|java|json|ya?ml|md|txt|html?|css|sh|log|png|jpe?g|gif|svg|pdf|zip|tar|gz|exe|dmg|docx?|xlsx?|pptx?|csv)$/i;

export function isProbablyUrl(input) {
  const s = (input || '').trim();
  if (!s || /\s/.test(s)) return false;   // any whitespace ⇒ it's a query
  if (HAS_SCHEME_RE.test(s)) return true;

  // "localhost:3001" reads as a scheme but is a host with a port, so the
  // host patterns decide; anything they reject falls through to search.
  const hostPart = s.split(/[/?#]/)[0];
  if (LOOKS_LIKE_IP_RE.test(s)) return true;
  if (LOOKS_LIKE_HOST_RE.test(s) && !NOT_A_TLD.test(hostPart)) return true;

  return false;
}

// Returns a loadable https:// URL — the input itself when it's a URL,
// otherwise a web search for it.
export function toNavigableUrl(input) {
  const s = (input || '').trim();
  if (!s) return '';
  if (HAS_SCHEME_RE.test(s)) return s;
  if (isProbablyUrl(s)) return `https://${s}`;
  // Anything else — including other schemes like javascript: or mailto: — is
  // handed to the search engine rather than loaded.
  return SEARCH_URL + encodeURIComponent(s);
}
