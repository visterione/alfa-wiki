// ═══════════════════════════════════════
// NAME MATCHING UTILITIES
// Ported verbatim from referral-bonuses.html
// ═══════════════════════════════════════

export function rbNormalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function rbParseFullName(fullName) {
  // "Надирашвили Манана Автандиловна" → { last, fi, mi }
  const parts = String(fullName || '').trim().split(/\s+/);
  return {
    last: (parts[0] || '').toLowerCase(),
    fi:   (parts[1] || '')[0]?.toLowerCase() || '',
    mi:   (parts[2] || '')[0]?.toLowerCase() || '',
  };
}

export function rbParseAbbrevName(abbrev) {
  // "Надирашвили М. А." / "Надирашвили М.А." / "Надирашвили М А" → { last, fi, mi }
  const s = String(abbrev || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const parts = s.split(' ').filter(Boolean);
  return {
    last: parts[0] || '',
    fi:   parts[1]?.[0] || '',
    mi:   parts[2]?.[0] || '',
  };
}

export function rbNamesMatch(fullName, excelName) {
  const full = rbParseFullName(fullName);
  const abbr = rbParseAbbrevName(excelName);
  if (!full.last || !abbr.last) return false;
  if (full.last !== abbr.last) return false;
  // Инициалы: если оба присутствуют — должны совпасть
  if (full.fi && abbr.fi && full.fi !== abbr.fi) return false;
  if (full.mi && abbr.mi && full.mi !== abbr.mi) return false;
  return true;
}
