const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test('microphone WAV has valid mono PCM header and clips samples', async () => {
 const { encodeWav } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/recorder.js')).href);
 const buffer = encodeWav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 48000);
 const view = new DataView(buffer);
 assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 0, 4)), 'RIFF');
 assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 8, 4)), 'WAVE');
 assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(24, true), 48000);
 assert.equal(view.getUint32(40, true), 10); assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(52, true), 32767);
 assert.throws(() => encodeWav(new Float32Array(), 48000), /录音为空/);
 assert.throws(() => encodeWav(new Float32Array([1]), 0), /采样率/);
});
