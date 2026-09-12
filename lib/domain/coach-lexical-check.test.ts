import { checkProhibitedLexicon, PROHIBITED_LEXICON } from './coach-lexical-check';

// Phase 5, Step 5. This is a narrow, closed-list backstop, not a semantic classifier -- these
// tests pin exactly that scope: every listed entry is caught, case does not matter, ordinary safe
// text passes, and one deliberate paraphrase is pinned as passing, to prove the residual risk
// rather than merely assert it.
//
// "building", "steady", and "quiet" were removed from PROHIBITED_LEXICON after the corrected 3a.2
// rerun found 22 of 23 lexical rejections were conservative false positives, 20 of them "steady"
// alone -- see the module's own header comment for the full evidence. This file no longer expects
// those three to reject; it pins the opposite (ordinary sentences using them now pass).

describe('checkProhibitedLexicon -- every remaining closed-list entry is caught', () => {
  it.each(PROHIBITED_LEXICON)('flags text containing "%s"', (phrase) => {
    const text = `This sentence contains the word ${phrase} somewhere in it.`;
    const result = checkProhibitedLexicon(text);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.matchedPhrases).toContain(phrase);
  });
});

describe('checkProhibitedLexicon -- "building", "steady", and "quiet" are no longer on the list', () => {
  it('does not flag "Building this habit into your routine..." -- the exact sentence the first check wrongly rejected', () => {
    const result = checkProhibitedLexicon('Building this habit into your routine can help.');
    expect(result).toEqual({ valid: true });
  });

  it('does not flag an ordinary use of "steady"', () => {
    const result = checkProhibitedLexicon('You have kept a steady pace with this one.');
    expect(result).toEqual({ valid: true });
  });

  it('does not flag an ordinary use of "quiet"', () => {
    const result = checkProhibitedLexicon('Choosing a quiet moment each day can make this easier.');
    expect(result).toEqual({ valid: true });
  });

  it('confirms none of the three removed words are on the closed list at all', () => {
    expect(PROHIBITED_LEXICON).not.toContain('building');
    expect(PROHIBITED_LEXICON).not.toContain('steady');
    expect(PROHIBITED_LEXICON).not.toContain('quiet');
  });
});

describe('checkProhibitedLexicon -- case-insensitivity', () => {
  it.each([
    ['Streak', 'streak'],
    ['GETTING BACK ON TRACK', 'getting back on track'],
    ['Rebuilding', 'rebuilding'],
    ["Don't", "don't"],
    ['POSITIVE_RECENT_COMPARISON', 'positive_recent_comparison'],
  ])('matches "%s" against the lowercase list entry "%s" regardless of case', (variant, expected) => {
    const result = checkProhibitedLexicon(`Text with ${variant} in it.`);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.matchedPhrases).toContain(expected);
  });
});

describe('checkProhibitedLexicon -- word-boundary anchoring', () => {
  it('does not flag "streak" merely because it is a substring of "streaking"', () => {
    // Regression pin for the anchoring behaviour described in the module header -- there is no
    // word boundary between "streak" and "ing", so \bstreak\b must not match inside "streaking".
    const result = checkProhibitedLexicon('You are streaking ahead this week.');
    expect(result).toEqual({ valid: true });
  });

  it('still flags "streak" itself as a whole word', () => {
    const result = checkProhibitedLexicon('Do not think about your streak.');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.matchedPhrases).toContain('streak');
  });

  it('known, accepted false-positive on a remaining entry: an ordinary use of "recovering" still triggers', () => {
    // Documents that the trade-off named in the module header still applies to every remaining
    // entry, not only the three that were removed -- this check cannot distinguish an ordinary
    // use of a listed word from a genuine leak of that literal value.
    const result = checkProhibitedLexicon('The garden is recovering nicely after the storm.');
    expect(result.valid).toBe(false);
  });
});

describe('checkProhibitedLexicon -- safe text passes', () => {
  it('passes ordinary rule-compliant coaching text with none of the listed phrases', () => {
    const result = checkProhibitedLexicon(
      'You have completed this habit consistently in the recent period, at 65%. Keeping the same time and place each day can make it easier to continue.',
    );
    expect(result).toEqual({ valid: true });
  });
});

describe('checkProhibitedLexicon -- known accepted residual: paraphrases are invisible by design', () => {
  it('a loss-framed paraphrase using none of the closed-list literal strings passes silently', () => {
    // "Pick up where you left off" means the same thing as "get back on track" but shares no
    // literal string with any PROHIBITED_LEXICON entry. This is not a bug to fix here -- it is the
    // named, accepted scope boundary of a closed-list lexical check (docs/phase-5-plan.md section
    // 10): no stemming, no fuzzy matching, no synonym expansion, no semantic interpretation.
    const result = checkProhibitedLexicon('Pick up where you left off whenever you are ready.');
    expect(result).toEqual({ valid: true });
  });
});
