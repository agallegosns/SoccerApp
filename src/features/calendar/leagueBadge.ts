/** Sigla corta de una competición para su insignia («LaLiga» → «LL», «Champions League» → «UCL»). Sólo decorativa. */
const KNOWN: readonly (readonly [RegExp, string])[] = [
  [/champions/i, 'UCL'],
  [/europa/i, 'UEL'],
  [/conference/i, 'UECL'],
  [/laliga|la liga|primera/i, 'LL'],
  [/premier/i, 'PL'],
  [/bundesliga/i, 'BL'],
  [/serie a/i, 'SA'],
  [/ligue 1/i, 'L1'],
];

export function leagueBadge(name: string): string {
  const known = KNOWN.find(([re]) => re.test(name));
  if (known !== undefined) return known[1];
  const initials = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return (initials === '' ? name.slice(0, 2).toUpperCase() : initials).slice(0, 3);
}
