import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xmlText } from '../src/pages/PdfToWord/engine/xmlText.ts';

test('removes PDF control codes forbidden in XML 1.0', () => {
  const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  assert.equal(xmlText(controls), '\t\n\r');
  assert.equal(xmlText('Текст\u0005\u0006\u0007\u0013 2026'), 'Текст 2026');
});
test('preserves normal text and valid supplementary characters', () => {
  const text = 'Приложение № 1\t2026\nСтрока\r<>&" 🎉 𐀀';
  assert.equal(xmlText(text), text);
});
test('removes lone surrogates and XML noncharacters', () => {
  assert.equal(xmlText('a\ud800b\udfffc\ufffed\uffff'), 'abcd');
});
