import { test } from "node:test";
import assert from "node:assert/strict";
import { KeywordMatcher, type Keyword } from "../src/matcher/matcher";
import { parseKeywordFile } from "../src/matcher/keywordManager";
import { highlightKeywords } from "../src/utils/text";

function kw(id: number, phrase: string, enabled = true): Keyword {
  return { id, phrase, enabled };
}

test("substring match is case-insensitive and Unicode-aware", () => {
  const m = new KeywordMatcher();
  m.setMode("substring");
  m.setKeywords([kw(1, "Airdrop"), kw(2, "DeFi"), kw(3, "Токен")]);

  const result = m.match("Большой AIRDROP для DeFi — новый ТОКЕН запущен");
  assert.deepEqual(
    result.matched.map((k) => k.phrase),
    ["Airdrop", "DeFi", "Токен"]
  );
  assert.equal(result.excluded, false);
});

test("multi-word phrase matches as a substring", () => {
  const m = new KeywordMatcher();
  m.setMode("substring");
  m.setKeywords([kw(1, "token launch")]);

  assert.equal(m.match("A new token launch is coming").matched.length, 1);
  assert.equal(m.match("nothing relevant here").matched.length, 0);
});

test("exact mode matches the whole text only", () => {
  const m = new KeywordMatcher();
  m.setMode("exact");
  m.setKeywords([kw(1, "airdrop")]);

  assert.equal(m.match("airdrop").matched.length, 1);
  assert.equal(m.match("big airdrop now").matched.length, 0);
});

test("regex mode matches, and invalid regexes never throw", () => {
  const m = new KeywordMatcher();
  m.setMode("regex");
  m.setKeywords([kw(1, "TGE|airdrop", true), kw(2, "([", true)]); // second one is invalid

  const result = m.match("the TGE is coming");
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].phrase, "TGE|airdrop");

  // The invalid regex simply never matches, without crashing.
  assert.equal(m.match("abc ([ def").matched.length, 0);
});

test("disabled keywords do not match", () => {
  const m = new KeywordMatcher();
  m.setMode("substring");
  m.setKeywords([kw(1, "airdrop", false)]);

  assert.equal(m.match("airdrop").matched.length, 0);
});

test("exclude words mark a message as excluded", () => {
  const m = new KeywordMatcher();
  m.setMode("substring");
  m.setKeywords([kw(1, "airdrop")]);
  m.setExcludeWords(["scam"]);

  const result = m.match("this airdrop is a scam");
  assert.equal(result.matched.length, 1);
  assert.equal(result.excluded, true);

  assert.equal(m.match("this airdrop is legit").excluded, false);
});

test("parseKeywordFile handles comments, blank lines and disabled entries", () => {
  const entries = parseKeywordFile("# comment\n\nairdrop\n- disabled one\n  Aave  \n");
  assert.deepEqual(entries, [
    { phrase: "airdrop", enabled: true },
    { phrase: "disabled one", enabled: false },
    { phrase: "Aave", enabled: true },
  ]);
});

test("highlightKeywords bolds keyword occurrences in the message text (case-insensitive, HTML-safe)", () => {
  assert.equal(
    highlightKeywords("finex это укмукк, и FInEx опять", ["finex"]),
    "<b>finex</b> это укмукк, и <b>FInEx</b> опять"
  );
  assert.equal(
    highlightKeywords("цена < 10 и a&b", ["a&b"]),
    "цена &lt; 10 и <b>a&amp;b</b>"
  );
  assert.equal(highlightKeywords("обычный текст", []), "обычный текст");
});
