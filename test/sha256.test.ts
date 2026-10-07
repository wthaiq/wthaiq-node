import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { hmacSha256, sha256, timingSafeEqualString, toHex } from '../src/core/sha256.js';
import { sha256Hex, timingSafeEqualHex, uuidV4 } from '../src/core/util.js';

const enc = new TextEncoder();

describe('portable SHA-256 / HMAC-SHA256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    assert.equal(
      toHex(sha256(new Uint8Array())),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      toHex(sha256(enc.encode('abc'))),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    assert.equal(
      toHex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches the RFC 4231 HMAC test cases', () => {
    const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
    assert.equal(
      toHex(hmacSha256(hex('0b'.repeat(20)), enc.encode('Hi There'))),
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    assert.equal(
      toHex(hmacSha256(enc.encode('Jefe'), enc.encode('what do ya want for nothing?'))),
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    assert.equal(
      toHex(
        hmacSha256(
          hex('aa'.repeat(131)),
          enc.encode('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    );
  });

  it('matches node:crypto for every length around the block boundaries and for large inputs', () => {
    for (let length = 0; length <= 300; length++) {
      const data = randomBytes(length);
      const key = randomBytes(length % 97);
      assert.equal(
        toHex(sha256(data)),
        createHash('sha256').update(data).digest('hex'),
        `sha256 length ${length}`,
      );
      assert.equal(
        toHex(hmacSha256(key, data)),
        createHmac('sha256', key).update(data).digest('hex'),
        `hmac length ${length}`,
      );
    }
    const big = randomBytes(1024 * 1024 + 7);
    assert.equal(toHex(sha256(big)), createHash('sha256').update(big).digest('hex'));
  });

  it('hashes with Web Crypto or the portable fallback identically', async () => {
    const data = randomBytes(1000);
    const expected = createHash('sha256').update(data).digest('hex');
    assert.equal(await sha256Hex(data), expected);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      assert.equal(await sha256Hex(data), expected);
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('generates UUID v4 values with or without Web Crypto (Node.js 18 has no global crypto)', async () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(await uuidV4(), pattern);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: (array: Uint8Array) => array.fill(0xff) },
        configurable: true,
        writable: true,
      });
      assert.equal(await uuidV4(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
      const values = new Set([await uuidV4(), await uuidV4()]);
      assert.equal(values.size, 2);
      for (const value of values) assert.match(value, pattern);
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('compares strings without early exit', () => {
    assert.equal(timingSafeEqualString('abc', 'abc'), true);
    assert.equal(timingSafeEqualString('abc', 'abd'), false);
    assert.equal(timingSafeEqualString('abc', 'abcd'), false);
    assert.equal(timingSafeEqualString('', ''), true);
    assert.equal(timingSafeEqualHex('ABCDEF', ' abcdef '), true);
  });
});
