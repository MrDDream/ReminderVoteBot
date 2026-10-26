import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJson, writeJsonAtomic, CorruptedDataError } from '../src/jsonFile.js';

function tempFile() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvb-'));
	return path.join(dir, 'data.json');
}

test('writeJsonAtomic writes the data and keeps the previous version as .bak', () => {
	const file = tempFile();
	writeJsonAtomic(file, [1]);
	writeJsonAtomic(file, [1, 2]);
	assert.deepEqual(readJson(file), [1, 2]);
	assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), [1]);
	assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('readJson returns undefined for a missing file', () => {
	assert.equal(readJson(tempFile()), undefined);
});

test('readJson restores from .bak when the file is corrupted', () => {
	const file = tempFile();
	writeJsonAtomic(file, ['old']);
	writeJsonAtomic(file, ['new']);
	fs.writeFileSync(file, '["trunc', 'utf8');
	assert.deepEqual(readJson(file), ['old']);
	assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), ['old']);
	assert.ok(fs.readdirSync(path.dirname(file)).some(name => name.includes('.corrupt-')));
});

test('readJson throws instead of returning empty data when nothing is recoverable', () => {
	const file = tempFile();
	fs.writeFileSync(file, '{oops', 'utf8');
	assert.throws(() => readJson(file), CorruptedDataError);
});
